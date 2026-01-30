"""
VTThought API Routes

WebSocket and HTTP endpoints for the VTThought backend.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.models import HealthResponse

# Initialize router
router = APIRouter()

# Store active WebSocket connections
active_connections: list[WebSocket] = []


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

    Accepts binary audio frames from the VS Code extension.
    Processes audio through STT and returns transcribed text.

    TODO: Implement full audio streaming (ADR-004)
    TODO: Integrate faster-whisper (ADR-005)
    TODO: Add LLM post-processing (ADR-006)
    """
    settings = get_settings()

    await websocket.accept()
    active_connections.append(websocket)

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

        # Keep connection alive and handle incoming messages
        while True:
            # Receive message (could be text or binary audio data)
            try:
                message = await websocket.receive()

                if "text" in message:
                    # Handle text messages (control signals)
                    data = message["text"]
                    await handle_text_message(websocket, data)

                elif "bytes" in message:
                    # Handle binary audio data
                    audio_data = message["bytes"]
                    await handle_audio_data(websocket, audio_data)

            except WebSocketDisconnect:
                break

    except Exception as e:
        # Send error message to client
        try:
            await websocket.send_json({
                "type": "error",
                "data": {
                    "message": str(e)
                }
            })
        except Exception:
            pass  # Connection already closed

    finally:
        # Cleanup
        if websocket in active_connections:
            active_connections.remove(websocket)


async def handle_text_message(websocket: WebSocket, data: str) -> None:
    """
    Handle text WebSocket messages.

    Currently supports:
    - "ping": Respond with "pong" for heartbeat
    - "start": Signal start of recording
    - "stop": Signal end of recording
    """
    import json

    try:
        message = json.loads(data)
        msg_type = message.get("type")

        if msg_type == "ping":
            await websocket.send_json({"type": "pong"})
        elif msg_type == "start":
            await websocket.send_json({
                "type": "recording_started",
                "data": {"timestamp": "now"}
            })
        elif msg_type == "stop":
            await websocket.send_json({
                "type": "recording_stopped",
                "data": {"timestamp": "now"}
            })
        else:
            await websocket.send_json({
                "type": "error",
                "data": {"message": f"Unknown message type: {msg_type}"}
            })

    except json.JSONDecodeError:
        await websocket.send_json({
            "type": "error",
            "data": {"message": "Invalid JSON message"}
        })


async def handle_audio_data(websocket: WebSocket, audio_data: bytes) -> None:
    """
    Handle binary audio data from WebSocket.

    TODO: Implement STT processing (ADR-005)
    TODO: Implement LLM post-processing (ADR-006)
    """
    # Stub: Acknowledge receipt of audio data
    # In production, this will:
    # 1. Buffer audio chunks
    # 2. Process with faster-whisper
    # 3. Post-process with LLM
    # 4. Send transcribed text back

    pass
