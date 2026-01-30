"""
User data models for VTThought personalization (ADR-011).

Defines UserPreferences, vocabulary entries, and style preferences.
"""
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class CleanupLevel(str, Enum):
    """Level of LLM cleanup aggressiveness."""
    MINIMAL = "minimal"      # Only remove um/uh
    MODERATE = "moderate"    # Remove fillers, fix basic grammar
    AGGRESSIVE = "aggressive"  # Full rewrite for clarity


class HotkeyMode(str, Enum):
    """Hotkey activation mode."""
    PUSH_TO_TALK = "push_to_talk"  # Hold to record
    TOGGLE = "toggle"              # Press to start/stop


@dataclass
class UserPreferences:
    """User preferences for speech recognition and processing."""
    language: str = "en"
    whisper_model: str = "large-v3"
    enable_llm_cleanup: bool = True
    cleanup_level: CleanupLevel = CleanupLevel.MODERATE
    enable_voice_commands: bool = True
    hotkey_mode: HotkeyMode = HotkeyMode.PUSH_TO_TALK

    # Advanced settings
    vad_sensitivity: float = 0.5  # Voice activity detection threshold
    silence_duration_ms: int = 1000  # How long silence before stop
    max_recording_seconds: int = 60  # Maximum recording length

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "language": self.language,
            "whisper_model": self.whisper_model,
            "enable_llm_cleanup": self.enable_llm_cleanup,
            "cleanup_level": self.cleanup_level.value,
            "enable_voice_commands": self.enable_voice_commands,
            "hotkey_mode": self.hotkey_mode.value,
            "vad_sensitivity": self.vad_sensitivity,
            "silence_duration_ms": self.silence_duration_ms,
            "max_recording_seconds": self.max_recording_seconds,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "UserPreferences":
        """Create from dictionary, using defaults for missing values."""
        return cls(
            language=data.get("language", "en"),
            whisper_model=data.get("whisper_model", "large-v3"),
            enable_llm_cleanup=data.get("enable_llm_cleanup", True),
            cleanup_level=CleanupLevel(data.get("cleanup_level", "moderate")),
            enable_voice_commands=data.get("enable_voice_commands", True),
            hotkey_mode=HotkeyMode(data.get("hotkey_mode", "push_to_talk")),
            vad_sensitivity=data.get("vad_sensitivity", 0.5),
            silence_duration_ms=data.get("silence_duration_ms", 1000),
            max_recording_seconds=data.get("max_recording_seconds", 60),
        )


@dataclass
class VocabularyEntry:
    """A single vocabulary entry with optional pronunciation hint."""
    word: str
    pronunciation_hint: Optional[str] = None
    category: str = "general"  # technical, name, project, acronym, custom
    boost: float = 1.0


@dataclass
class CorrectionEntry:
    """A learned correction for misheard words."""
    spoken: str           # What Whisper outputs
    corrected: str        # What it should be
    auto_learned: bool    # Was this learned from user correction?
    occurrences: int = 0  # How many times this correction was applied


@dataclass
class CustomVoiceCommand:
    """A user-defined voice command."""
    triggers: list[str]       # Phrases that trigger this command
    action: str              # VS Code command or custom action
    params: Optional[dict]   # Parameters for the action
    enabled: bool = True


@dataclass
class StylePreference:
    """A learned style preference from user edits."""
    category: str           # "punctuation", "capitalization", "number_format", etc.
    preference: str         # "oxford_comma", "em_dash", "word_case", etc.
    pattern: Optional[str]  # What we output (for word-specific prefs)
    replacement: Optional[str]  # What user changed it to
    occurrences: int        # How many times user made this change
    confidence: float       # 0.0-1.0, increases with occurrences


# Vocabulary categories with examples
VOCABULARY_CATEGORIES = {
    "technical": {
        "description": "Programming terms, frameworks, tools",
        "examples": ["TypeScript", "Kubernetes", "PostgreSQL", "FastAPI"]
    },
    "project": {
        "description": "Project-specific terms",
        "examples": ["voicecode", "clawdbot", "ardenone-cluster"]
    },
    "names": {
        "description": "People and company names",
        "examples": ["Anthropic", "Claude", "OpenAI"]
    },
    "acronyms": {
        "description": "Abbreviations and acronyms",
        "examples": ["API", "SDK", "CLI", "JWT", "OAuth", "LLM"]
    },
    "custom": {
        "description": "User-defined terms",
        "examples": []
    }
}
