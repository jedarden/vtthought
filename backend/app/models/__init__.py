"""
VTThought Data Models

Pydantic models for request/response validation.
"""
from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    version: str
    environment: str


class TranscriptionRequest(BaseModel):
    """Request for text transcription (LLM post-processing)."""

    text: str
    user_id: str | None = None
    context: str | None = None


class TranscriptionResponse(BaseModel):
    """Response from transcription/LLM processing."""

    original_text: str
    processed_text: str
    language: str | None = None
    confidence: float | None = None


class WebSocketMessage(BaseModel):
    """WebSocket message wrapper."""

    type: str  # "audio", "control", "error"
    data: dict | bytes
