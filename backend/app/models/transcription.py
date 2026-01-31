"""
VTThought Transcription Models

Pydantic models for transcription and WebSocket messages.
Implements the message protocol from ADR-006 and ADR-007.
"""
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel


# ============================================================================
# WebSocket Message Types (Server -> Client)
# ============================================================================

class InterimMessage(BaseModel):
    """Interim transcription result that may change."""

    type: str = "interim"
    text: str
    is_final: bool
    confidence: float
    changes: list[dict]  # List of TextChange dicts


class StreamingMessage(BaseModel):
    """Streaming LLM cleanup token."""

    type: str = "streaming"
    token: str
    position: int


class VoiceCommandModel(BaseModel):
    """Voice command to execute."""

    action: str  # "enter", "tab", "clear", etc.
    params: dict[str, Any] | None = None
    terminal: bool = False


class FinalMessage(BaseModel):
    """Final transcription result with commands."""

    type: str = "final"
    raw: str
    cleaned: str
    commands: list[dict]


class ErrorMessage(BaseModel):
    """Error message."""

    type: str = "error"
    code: str
    message: str


# Union type for all server messages
ServerMessage = InterimMessage | StreamingMessage | FinalMessage | ErrorMessage


# ============================================================================
# Text Change Models (for interim rewriting)
# ============================================================================

@dataclass
class TextChange:
    """Text edit operation for client-side updates."""

    start: int
    deleteCount: int
    insert: str

    def to_dict(self) -> dict:
        return {
            "start": self.start,
            "deleteCount": self.deleteCount,
            "insert": self.insert,
        }


# ============================================================================
# Voice Command Models (ADR-008)
# ============================================================================

@dataclass
class VoiceCommand:
    """Parsed voice command."""

    action: str
    params: dict[str, Any] | None = None
    terminal: bool = False


class ParsedTranscription(BaseModel):
    """Result of parsing commands from transcription."""

    text: str  # Text to insert (with commands removed)
    commands: list[VoiceCommandModel]
    has_trailing_command: bool


# ============================================================================
# Session Context Models
# ============================================================================

class SessionContext(BaseModel):
    """Session context for transcription cleanup."""

    current_file: str | None = None
    recent_actions: list[str] = []
    open_files: list[str] = []
    git_branch: str | None = None
    user_id: str | None = None


# Re-export CleanupContext for convenience
# This is defined in llm.py but we reference it here
class CleanupContext(BaseModel):
    """Context passed to LLM for transcription cleanup."""

    raw_transcription: str
    user_vocabulary: list[str] = []
    learned_corrections: dict[str, str] = {}
    current_file: str | None = None
    recent_actions: list[str] = []
    open_files: list[str] = []
    git_branch: str | None = None
    cleanup_level: str = "moderate"
    preserve_casing: bool = True


# ============================================================================
# Cleanup Result Models
# ============================================================================

class CleanupResult(BaseModel):
    """Result from LLM cleanup."""

    cleaned_text: str
    raw_text: str
    commands: list[dict] = []


# ============================================================================
# Helper Functions
# ============================================================================

def create_interim_message(
    text: str,
    is_final: bool = False,
    confidence: float = 0.7,
    changes: list[TextChange] | None = None,
) -> InterimMessage:
    """Create an interim transcription message."""
    return InterimMessage(
        type="interim",
        text=text,
        is_final=is_final,
        confidence=confidence,
        changes=[c.to_dict() for c in (changes or [])],
    )


def create_streaming_message(token: str, position: int) -> StreamingMessage:
    """Create a streaming LLM token message."""
    return StreamingMessage(
        type="streaming",
        token=token,
        position=position,
    )


def create_final_message(
    raw: str,
    cleaned: str,
    commands: list[dict] | None = None,
) -> FinalMessage:
    """Create a final transcription message."""
    return FinalMessage(
        type="final",
        raw=raw,
        cleaned=cleaned,
        commands=commands or [],
    )


def create_error_message(code: str, message: str) -> ErrorMessage:
    """Create an error message."""
    return ErrorMessage(
        type="error",
        code=code,
        message=message,
    )
