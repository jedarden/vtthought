"""
VTThought API Routes

WebSocket and HTTP endpoints for the VTThought backend.
Implements the full streaming pipeline (ADR-005, ADR-006, ADR-007, ADR-008).
"""
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.models import HealthResponse
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

# Store active WebSocket connections
active_connections: list[WebSocket] = []


@dataclass
class SessionState:
    """Session state for each WebSocket connection."""

    is_recording: bool = False
    audio_buffer: bytearray = field(default_factory=bytearray)
    last_partial: str = ""


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


@router.websocket("/ws/audio")
async def websocket_audio_stream(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for audio streaming.

    Implements the full streaming pipeline:
    1. Receive binary audio chunks from extension
    2. Stream interim STT results (partial transcription)
    3. On silence: finalize STT, stream LLM cleanup tokens
    4. Send final result with voice commands

    Protocol (ADR-006):
    - Server -> Client: interim, streaming, final, error messages
    - Client -> Server: binary audio, control messages (start/stop/ping)
    """
    settings = get_settings()

    await websocket.accept()
    active_connections.append(websocket)

    # Initialize streaming STT and cleaner for this connection
    streaming_stt = get_streaming_stt()
    cleaner = get_cleaner()

    # Session state
    session = SessionState()

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
) -> None:
    """
    Handle text WebSocket messages.

    Supports:
    - "ping": Heartbeat
    - "start": Start recording session
    - "stop": End recording session and finalize
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

                # Stream LLM cleanup
                ctx = CleanupContext(raw_transcription=final_result.text)
                position = 0
                cleaned_tokens = []

                async for token in cleaner.cleanup_stream(ctx):
                    cleaned_tokens.append(token)
                    await websocket.send_json(
                        create_streaming_message(token, position).model_dump()
                    )
                    position += len(token)

                cleaned_text = "".join(cleaned_tokens).strip()

                # Parse voice commands (ADR-008)
                text_with_commands, commands = parse_voice_commands(cleaned_text)

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
    """
    if not session.is_recording:
        return

    try:
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
