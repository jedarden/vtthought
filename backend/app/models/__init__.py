"""
VTThought Data Models

Pydantic models for request/response validation.
"""
from typing import List

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    version: str
    environment: str


class VersionInfo(BaseModel):
    """Version and compatibility information (ADR-024)."""

    backend_version: str  # "1.0.0"
    api_versions: List[str]  # ["v1", "v2"]
    protocol_versions: List[str]  # ["1.0", "1.1"]
    min_extension_version: str  # "1.0.0" - minimum compatible extension
    features: List[str]  # ["streaming", "vocabulary", "voice_commands"]


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
