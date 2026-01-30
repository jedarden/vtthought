"""
VTThought API Routes

WebSocket and HTTP endpoints for the VTThought backend.
Implements the full streaming pipeline (ADR-005, ADR-006, ADR-007, ADR-008).
Includes authentication endpoints (ADR-002).
Includes user personalization endpoints (ADR-011).
"""
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import JSONResponse

from app.api import auth as auth_api
from app.api import user as user_api
from app.auth import validate_extension_token, get_default_user
from app.config import get_settings
from app.models import HealthResponse, VersionInfo
from app.models.transcription import (
    create_error_message,
    create_final_message,
    create_interim_message,
    create_streaming_message,
)
from app.services.commands import parse_voice_commands
from app.services.llm import CleanupContext, get_cleaner
from app.services.stt import get_streaming_stt

logger = logging.getLogger(__name__)

# Initialize router
router = APIRouter()

# Include auth routes
router.include_router(auth_api.auth_router, prefix="/auth", tags=["authentication"])

# Include OAuth routes (ADR-002)
from app.api import oauth as oauth_api
router.include_router(oauth_api.oauth_router, prefix="/auth", tags=["oauth"])

# Include user personalization routes (ADR-011)
router.include_router(user_api.router, prefix="/user", tags=["user"])

# Store active WebSocket connections
active_connections: list[WebSocket] = []


@dataclass
class SessionState:
    """Session state for each WebSocket connection.

    Performance optimizations:
    - Pre-fetched user context (cached at connection time)
    - Cached cleanup prompt (reused across transcriptions)
    - Bounded buffer with max size to prevent memory issues
    """

    is_recording: bool = False
    audio_buffer: bytearray = field(default_factory=bytearray)
    last_partial: str = ""

    # Performance: Pre-fetched user context (avoid blocking DB queries during transcription)
    user_context: dict = field(default_factory=dict)

    # Performance: Cached cleanup prompt (rebuild only if user preferences change)
    cleanup_prompt: Optional[str] = None

    # Performance: Max buffer size (5 minutes at 16kHz mono PCM16 = ~9.6MB)
    MAX_BUFFER_SIZE: int = 16000 * 60 * 5 * 2  # samples * seconds * minutes * bytes_per_sample


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Health check endpoint.

    Returns the current status of the backend service.
    Used by VS Code extension to verify connectivity.
    """
    settings = get_settings()
    return HealthResponse(
        status="healthy",
        version=settings.app_version,
        environment=settings.environment,
    )


# Version configuration (ADR-024)
# This defines the current API version and compatibility matrix
CURRENT_VERSION = VersionInfo(
    backend_version="0.1.0",  # Matches app_version in config.py
    api_versions=["v1"],
    protocol_versions=["1.0"],
    min_extension_version="0.1.0",
    features=[
        "streaming",  # Streaming STT with interim results
        "vocabulary",  # User-specific vocabulary (ADR-011)
        "voice_commands",  # Voice command parsing (ADR-008)
        "style_learning",  # Style preference learning (ADR-011)
        "oauth",  # Google OAuth authentication (ADR-002)
        "corrections",  # Learned corrections (ADR-011)
        "multi_user",  # Multi-user support with SQLite
    ],
)


@router.get("/version", response_model=VersionInfo)
async def get_version() -> VersionInfo:
    """
    Version and compatibility endpoint (ADR-024).

    Returns backend version, supported API versions, and feature list.
    Used by VS Code extension for:
    - Compatibility checking
    - Feature detection (graceful degradation)
    - Version display in UI

    The extension should check:
    1. Extension version >= min_extension_version
    2. Required API version is in api_versions
    3. Required protocol version is in protocol_versions
    4. Features are available before using them
    """
    return CURRENT_VERSION


@router.websocket("/ws/audio")
async def websocket_audio_stream(
    websocket: WebSocket,
    token: Optional[str] = Query(None, description="Extension authentication token")
) -> None:
    """
    WebSocket endpoint for audio streaming with token authentication (ADR-002).

    Implements the full streaming pipeline:
    1. Validate extension token (optional in single-user mode)
    2. Receive binary audio chunks from extension
    3. Stream interim STT results (partial transcription)
    4. On silence: finalize STT, stream LLM cleanup tokens
    5. Send final result with voice commands

    Protocol (ADR-006):
    - Server -> Client: interim, streaming, final, error messages
    - Client -> Server: binary audio, control messages (start/stop/ping)

    Authentication:
    - In multi-user mode: token query parameter is required
    - In single-user mode: authentication is skipped
    """
    settings = get_settings()

    # Determine if single-user mode (development without Google OAuth configured)
    single_user_mode = settings.environment == "development" and not settings.google_client_id

    # Authenticate connection
    user = None
    if single_user_mode:
        # Single-user mode: use default user
        user = await get_default_user()
        logger.info("WebSocket connection in single-user mode")
    else:
        # Multi-user mode: validate token
        if not token:
            await websocket.close(code=4001, reason="Missing authentication token")
            return

        user = await validate_extension_token(token)
        if not user:
            await websocket.close(code=4001, reason="Invalid authentication token")
            return

        logger.info(f"WebSocket connection authenticated for user: {user.email}")

    await websocket.accept()
    active_connections.append(websocket)

    # Initialize streaming STT and cleaner for this connection
    streaming_stt = get_streaming_stt()
    cleaner = get_cleaner()

    # Session state
    session = SessionState()

    # Performance: Pre-fetch user context to avoid blocking queries during transcription
    if user:
        from app.services.vocabulary import get_user_vocabulary
        from app.services.style import get_style_learner

        user_id = user.id if user else "default"

        # Fetch user vocabulary in background (non-blocking)
        user_vocab = await get_user_vocabulary(user_id)
        vocab_list = [v["word"] for v in await user_vocab.get_all_words()]

        # Fetch user corrections
        corrections_list = await user_vocab.get_all_corrections()
        corrections_dict = {c["spoken"]: c["corrected"] for c in corrections_list}

        # Fetch user style preferences
        style_learner = await get_style_learner(user_id)
        style_prompt = await style_learner.get_style_prompt()

        # Fetch custom voice commands (ADR-011)
        from app.database import UserRepository, get_pooled_connection, return_connection
        db_conn = await get_pooled_connection()
        try:
            user_repo = UserRepository(db_conn, user_id)
            custom_commands = await user_repo.get_custom_commands()
        finally:
            await return_connection(db_conn)

        # Cache in session for reuse
        session.user_context = {
            "vocabulary": vocab_list,
            "corrections": corrections_dict,
            "style_prompt": style_prompt,
            "custom_commands": custom_commands,
        }

        # Performance: Set user vocabulary on streaming STT for personalization (ADR-011)
        streaming_stt.set_user_vocabulary(vocab_list)

        # Pre-build cleanup prompt for reuse
        from app.services.llm import CleanupContext, build_cleanup_prompt
        ctx = CleanupContext(
            raw_transcription="",  # Empty template
            user_vocabulary=vocab_list,
            learned_corrections=corrections_dict,
            cleanup_level="moderate",
        )
        session.cleanup_prompt = build_cleanup_prompt(ctx, style_prompt)

    try:
        # Send welcome message
        await websocket.send_json({
            "type": "connected",
            "data": {
                "message": "Connected to VTThought backend",
                "version": settings.app_version,
                "sample_rate": settings.audio_sample_rate,
                "channels": settings.audio_channels,
            }
        })

        # Main message loop
        while True:
            try:
                message = await websocket.receive()

                if "text" in message:
                    # Handle control messages
                    await handle_text_message(
                        websocket,
                        message["text"],
                        streaming_stt,
                        cleaner,
                        session,
                        user,
                    )

                elif "bytes" in message:
                    # Handle binary audio data
                    await handle_audio_data(
                        websocket,
                        message["bytes"],
                        streaming_stt,
                        session,
                    )

            except WebSocketDisconnect:
                logger.debug("WebSocket disconnected")
                break

    except Exception as e:
        logger.exception("Error in WebSocket handler")
        try:
            await websocket.send_json(
                create_error_message("internal_error", str(e)).model_dump()
            )
        except Exception:
            pass

    finally:
        # Cleanup
        if websocket in active_connections:
            active_connections.remove(websocket)

        streaming_stt.reset()

        # Close LLM connection if supported
        if hasattr(cleaner, "close"):
            await cleaner.close()


async def handle_text_message(
    websocket: WebSocket,
    data: str,
    streaming_stt,
    cleaner,
    session: SessionState,
    user,
) -> None:
    """
    Handle text WebSocket messages.

    Supports:
    - "ping": Heartbeat
    - "start": Start recording session
    - "stop": End recording session and finalize

    Args:
        websocket: WebSocket connection
        data: Message data (JSON string)
        streaming_stt: Streaming STT service
        cleaner: LLM cleaner service
        session: Session state
        user: Authenticated user object (or None in single-user mode)
    """
    try:
        message = json.loads(data)
        msg_type = message.get("type")

        if msg_type == "ping":
            await websocket.send_json({"type": "pong"})

        elif msg_type == "start":
            session.is_recording = True
            streaming_stt.reset()
            await websocket.send_json({
                "type": "recording_started",
                "data": {"timestamp": "now"}
            })

        elif msg_type == "stop":
            session.is_recording = False

            # Finalize transcription
            final_result = await streaming_stt.finalize()

            if final_result:
                # Send final interim with high confidence
                await websocket.send_json(
                    create_interim_message(
                        text=final_result.text,
                        is_final=True,
                        confidence=final_result.confidence,
                        changes=final_result.changes,
                    ).model_dump()
                )

                # Performance: Use pre-fetched user context (no blocking DB queries)
                user_context = session.user_context

                # Build cleanup context with cached user data (ADR-011)
                ctx = CleanupContext(
                    raw_transcription=final_result.text,
                    user_vocabulary=user_context.get("vocabulary", []),
                    learned_corrections=user_context.get("corrections", {}),
                    cleanup_level="moderate",
                )

                position = 0
                cleaned_tokens = []

                # Performance: Use cached cleanup prompt (rebuild only if needed)
                if session.cleanup_prompt:
                    # Replace raw transcription placeholder
                    prompt = session.cleanup_prompt.replace("{raw_transcription}", final_result.text)
                else:
                    # Fallback: build prompt dynamically
                    from app.services.llm import build_cleanup_prompt
                    style_prompt = user_context.get("style_prompt", "")
                    prompt = build_cleanup_prompt(ctx, style_prompt)

                async for token in cleaner.llm.stream(prompt):
                    cleaned_tokens.append(token)
                    await websocket.send_json(
                        create_streaming_message(token, position).model_dump()
                    )
                    position += len(token)

                cleaned_text = "".join(cleaned_tokens).strip()

                # Parse voice commands (ADR-008) with custom commands (ADR-011)
                custom_commands = user_context.get("custom_commands", [])
                text_with_commands, commands = parse_voice_commands(cleaned_text, custom_commands)

                # Send final result
                await websocket.send_json(
                    create_final_message(
                        raw=final_result.text,
                        cleaned=text_with_commands,
                        commands=commands,
                    ).model_dump()
                )

            await websocket.send_json({
                "type": "recording_stopped",
                "data": {"timestamp": "now"}
            })

        else:
            await websocket.send_json(
                create_error_message(
                    "unknown_message_type",
                    f"Unknown message type: {msg_type}"
                ).model_dump()
            )

    except json.JSONDecodeError:
        await websocket.send_json(
            create_error_message("invalid_json", "Invalid JSON message").model_dump()
        )


async def handle_audio_data(
    websocket: WebSocket,
    audio_chunk: bytes,
    streaming_stt,
    session: SessionState,
) -> None:
    """
    Handle binary audio data from WebSocket.

    Processes audio through streaming STT and sends interim results.
    Includes buffer size limit to prevent memory issues.
    """
    if not session.is_recording:
        return

    try:
        # Performance: Enforce buffer size limit (prevent unbounded growth)
        if len(session.audio_buffer) + len(audio_chunk) > session.MAX_BUFFER_SIZE:
            logger.warning(f"Audio buffer exceeds limit, resetting. Current: {len(session.audio_buffer)}")
            session.audio_buffer.clear()
            session.last_partial = ""

        # Stream interim results
        async for interim in streaming_stt.process_chunk(audio_chunk):
            if interim.text and interim.text != session.last_partial:
                await websocket.send_json(
                    create_interim_message(
                        text=interim.text,
                        is_final=interim.is_final,
                        confidence=interim.confidence,
                        changes=interim.changes,
                    ).model_dump()
                )
                session.last_partial = interim.text

    except Exception as e:
        logger.exception("Error processing audio chunk")
        await websocket.send_json(
            create_error_message("audio_processing_error", str(e)).model_dump()
        )
