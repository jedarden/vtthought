"""
VTThought STT Service (ADR-005)

Speech-to-text service using faster-whisper with GPU acceleration.
Supports streaming transcription with interim results.
Integrated with user vocabulary for personalization (ADR-011).
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import TYPE_CHECKING, AsyncIterator, Optional

import numpy as np

if TYPE_CHECKING:
    from faster_whisper import WhisperModel

from app.errors import (
    BackendError,
    ValidationError,
)
from app.services.vocabulary import get_user_vocabulary

logger = logging.getLogger(__name__)


# Technical vocabulary for code-related transcription (default/base prompt)
CODING_PROMPT = """
Technical programming terms: TypeScript, JavaScript, Python, Rust, Go, Java,
React, Vue, Angular, Svelte, FastAPI, Django, Flask, Express, Node.js,
PostgreSQL, MongoDB, Redis, MySQL, SQLite, Docker, Kubernetes, AWS, GCP,
Azure, GitHub, GitLab, Bitbucket, CI/CD, API, REST, GraphQL, WebSocket,
JSON, YAML, TOML, XML, HTML, CSS, HTTP, HTTPS, SSL, TLS, JWT, OAuth,
npm, pip, cargo, brew, apt, yum, Claude, Anthropic, OpenAI, GPT, LLM,
async, await, promise, callback, function, class, interface, type,
variable, constant, array, object, map, set, list, dictionary, hash.
"""


async def build_whisper_prompt(user_id: str) -> str:
    """
    Build Whisper initial prompt combining base vocabulary with user's custom words.

    Args:
        user_id: User ID for personalization

    Returns:
        Combined prompt for Whisper biasing
    """
    # Get user's custom vocabulary
    user_vocab = await get_user_vocabulary(user_id)
    custom_prompt = await user_vocab.get_whisper_prompt()

    # Combine base prompt with user's vocabulary
    if custom_prompt:
        return f"{CODING_PROMPT}\nUser vocabulary: {custom_prompt}"
    return CODING_PROMPT


@dataclass
class TranscriptionResult:
    """Result from speech-to-text transcription."""

    text: str
    is_final: bool
    confidence: float
    language: str = "en"


@dataclass
class InterimResult:
    """Interim transcription result with potential corrections."""

    text: str
    is_final: bool
    confidence: float
    changes: list[TextChange]


@dataclass
class TextChange:
    """Text edit operation for client-side updates."""

    start: int
    deleteCount: int
    insert: str


class WhisperSTT:
    """
    Speech-to-text service using faster-whisper.

    Supports GPU acceleration with CUDA fallback to CPU.
    Implements streaming transcription with voice activity detection.
    """

    def __init__(
        self,
        model_size: str = "base",
        device: str = "auto",
        compute_type: str = "float16",
        download_root: str = "/models/whisper",
    ) -> None:
        """
        Initialize WhisperSTT.

        Args:
            model_size: Whisper model size (tiny, base, small, medium, large-v3)
            device: Device to use (cuda, cpu, auto)
            compute_type: Computation type (float16, int8, float32)
            download_root: Directory to store/download models
        """
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.download_root = download_root
        self._model: Optional[WhisperModel] = None

    @property
    def model(self) -> WhisperModel:
        """Lazy-load Whisper model on first access."""
        if self._model is None:
            self._load_model()
        return self._model

    def _load_model(self) -> None:
        """Load the Whisper model."""
        try:
            from faster_whisper import WhisperModel

            logger.info(f"Loading Whisper model: {self.model_size}")

            # Detect device if auto
            device = self.device
            if device == "auto":
                try:
                    import torch

                    device = "cuda" if torch.cuda.is_available() else "cpu"
                except ImportError:
                    device = "cpu"

            # Adjust compute type for CPU
            compute_type = self.compute_type
            if device == "cpu" and compute_type == "float16":
                compute_type = "int8"

            self._model = WhisperModel(
                self.model_size,
                device=device,
                compute_type=compute_type,
                download_root=self.download_root,
            )

            logger.info(f"Whisper model loaded on {device} with {compute_type}")

        except ImportError as e:
            logger.error(f"faster-whisper not installed: {e}")
            raise BackendError(
                message="faster-whisper is required. Install with: pip install faster-whisper",
                code="MISSING_DEPENDENCY",
                original_error=str(e),
            ) from e
        except Exception as e:
            logger.error(f"Failed to load Whisper model: {e}")
            raise BackendError(
                message=f"Failed to load Whisper model: {e}",
                code="MODEL_LOAD_FAILED",
                retryable=True,
            ) from e

    def transcribe(
        self,
        audio: np.ndarray,
        sample_rate: int = 16000,
        language: str = "en",
        user_id: Optional[str] = None,
    ) -> str:
        """
        Transcribe audio array to text.

        Args:
            audio: Audio samples as float32 numpy array (-1.0 to 1.0)
            sample_rate: Sample rate in Hz (default 16000)
            language: Language code (default 'en')
            user_id: Optional user ID for personalized vocabulary

        Returns:
            Transcribed text string
        """
        from app.config import get_settings

        settings = get_settings()

        # Validate audio shape
        if audio.size == 0:
            raise ValidationError(
                message="Audio array is empty",
                code="EMPTY_AUDIO",
            )

        if sample_rate != 16000:
            raise ValidationError(
                message=f"Unsupported sample rate: {sample_rate}. Expected 16000 Hz.",
                code="INVALID_SAMPLE_RATE",
                sample_rate=sample_rate,
            )

        # Build prompt (use base if no user_id)
        if user_id:
            # Note: This is a simplified sync version.
            # In production, prompt should be passed in from caller.
            initial_prompt = CODING_PROMPT
        else:
            initial_prompt = CODING_PROMPT

        try:
            segments, info = self.model.transcribe(
                audio,
                beam_size=settings.stt_beam_size,
                best_of=settings.stt_best_of,
                language=language,
                initial_prompt=initial_prompt,
                condition_on_previous_text=True,
                vad_filter=True,
                vad_parameters={
                    "threshold": settings.stt_vad_threshold,
                    "min_speech_duration_ms": settings.stt_vad_min_speech_ms,
                    "min_silence_duration_ms": settings.stt_vad_min_silence_ms,
                },
            )

            text = " ".join(segment.text.strip() for segment in segments)
            logger.debug(f"Transcription: {text}")
            return text

        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            raise BackendError(
                message=f"Transcription failed: {e}",
                code="TRANSCRIPTION_FAILED",
                retryable=True,
            ) from e

    async def transcribe_with_user(
        self,
        audio: np.ndarray,
        user_id: str,
        sample_rate: int = 16000,
        language: str = "en",
    ) -> str:
        """
        Transcribe with user-specific vocabulary (ADR-011).

        Args:
            audio: Audio samples as float32 numpy array
            user_id: User ID for personalized vocabulary
            sample_rate: Sample rate in Hz
            language: Language code

        Returns:
            Transcribed text with user vocabulary biasing
        """
        from app.config import get_settings

        settings = get_settings()

        # Get personalized prompt
        prompt = await build_whisper_prompt(user_id)

        # Validate audio
        if audio.size == 0:
            raise ValidationError(
                message="Audio array is empty",
                code="EMPTY_AUDIO",
            )

        # Run transcription in thread pool
        loop = asyncio.get_event_loop()
        segments, info = await loop.run_in_executor(
            None,
            lambda: self.model.transcribe(
                audio,
                beam_size=settings.stt_beam_size,
                best_of=settings.stt_best_of,
                language=language,
                initial_prompt=prompt,
                condition_on_previous_text=True,
                vad_filter=True,
                vad_parameters={
                    "threshold": settings.stt_vad_threshold,
                    "min_speech_duration_ms": settings.stt_vad_min_speech_ms,
                    "min_silence_duration_ms": settings.stt_vad_min_silence_ms,
                },
            )
        )

        text = " ".join(segment.text.strip() for segment in segments)

        # Apply user's learned corrections
        user_vocab = await get_user_vocabulary(user_id)
        text = await user_vocab.apply_corrections(text)

        logger.debug(f"Transcription (user={user_id}): {text}")
        return text

    def transcribe_final(
        self,
        audio: bytes | np.ndarray,
        sample_rate: int = 16000,
        initial_prompt: Optional[str] = None,
    ) -> TranscriptionResult:
        """
        High-quality final transcription.

        Args:
            audio: Audio as bytes (PCM16) or numpy array (float32)
            sample_rate: Sample rate in Hz
            initial_prompt: Optional custom initial prompt for Whisper

        Returns:
            TranscriptionResult with final text
        """
        # Convert bytes to numpy if needed
        if isinstance(audio, bytes):
            audio_array = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
        else:
            audio_array = audio

        # Use provided prompt or default
        prompt = initial_prompt or CODING_PROMPT

        # Transcribe with high-quality settings
        segments, info = self.model.transcribe(
            audio_array,
            beam_size=5,
            best_of=5,
            language="en",
            temperature=0.0,
            initial_prompt=prompt,
            vad_filter=True,
        )

        text = " ".join(segment.text.strip() for segment in segments)

        return TranscriptionResult(
            text=text,
            is_final=True,
            confidence=min(info.language_probability, 0.95),
            language=info.language,
        )


class StreamingWhisperSTT:
    """
    Streaming Whisper STT with interim results.

    Buffers audio chunks and produces partial transcriptions
    that are updated as more audio arrives.

    Performance: User vocabulary is cached and reused for each transcription.
    """

    def __init__(
        self,
        model_size: str = "base",
        device: str = "auto",
        compute_type: str = "float16",
        download_root: str = "~/.cache/whisper",
    ) -> None:
        """
        Initialize streaming STT.

        Args:
            model_size: Whisper model size
            device: Device to use
            compute_type: Computation type
            download_root: Directory for model storage
        """
        from app.config import get_settings

        settings = get_settings()
        self.stt = WhisperSTT(model_size, device, compute_type, download_root)
        self.buffer: bytearray = bytearray()
        self.last_transcript = ""

        # Performance: Use configurable chunk size and process interval
        self.chunk_size = settings.stt_streaming_chunk_size  # Default: 1 second at 16kHz
        self.process_interval = settings.stt_streaming_process_interval  # Default: 500ms

        # Performance: Cached user vocabulary prompt (updated via set_user_vocabulary)
        self._user_prompt: Optional[str] = None

    def set_user_vocabulary(self, vocabulary: list[str]) -> None:
        """
        Set user vocabulary for personalization (ADR-011).

        Args:
            vocabulary: List of custom vocabulary words
        """
        if vocabulary:
            # Build prompt from user vocabulary (limit to 50 terms for Whisper)
            vocab_str = " ".join(vocabulary[:50])
            self._user_prompt = f"{CODING_PROMPT}\nUser vocabulary: {vocab_str}"
        else:
            self._user_prompt = CODING_PROMPT

    async def process_chunk(
        self, audio_chunk: bytes
    ) -> AsyncIterator[InterimResult]:
        """
        Process audio chunk and yield interim results.

        Args:
            audio_chunk: Binary audio data (PCM16, 16kHz mono)

        Yields:
            InterimResult with potential corrections
        """
        self.buffer.extend(audio_chunk)

        # Process every ~500ms of audio
        if len(self.buffer) < self.process_interval:
            return

        # Convert to numpy for transcription
        audio_array = np.frombuffer(bytes(self.buffer), dtype=np.int16).astype(
            np.float32
        ) / 32768.0

        # Run transcription in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        current_transcript = await loop.run_in_executor(
            None,
            lambda: self._transcribe_partial(audio_array),
        )

        if current_transcript and current_transcript != self.last_transcript:
            # Calculate changes for efficient client update
            changes = self._compute_diff(self.last_transcript, current_transcript)

            yield InterimResult(
                text=current_transcript,
                is_final=False,
                confidence=0.7,
                changes=changes,
            )

            self.last_transcript = current_transcript

    async def finalize(self) -> Optional[InterimResult]:
        """
        Finalize transcription when user stops speaking.

        Returns:
            Final InterimResult with high confidence
        """
        if not self.buffer:
            return None

        # Convert to numpy
        audio_array = np.frombuffer(bytes(self.buffer), dtype=np.int16).astype(
            np.float32
        ) / 32768.0

        # Run high-quality transcription
        loop = asyncio.get_event_loop()
        final_transcript = await loop.run_in_executor(
            None,
            lambda: self._transcribe_final(audio_array),
        )

        if final_transcript:
            changes = self._compute_diff(self.last_transcript, final_transcript)

            result = InterimResult(
                text=final_transcript,
                is_final=True,
                confidence=0.95,
                changes=changes,
            )

            # Reset for next session
            self.buffer.clear()
            self.last_transcript = ""

            return result

        return None

    def _transcribe_partial(self, audio: np.ndarray) -> str:
        """
        Quick transcription for interim results.

        Performance: Uses cached user vocabulary prompt for personalization.
        """
        segments, _ = self.stt.model.transcribe(
            audio,
            language="en",
            condition_on_previous_text=True,
            vad_filter=False,  # Skip VAD for speed
            initial_prompt=self._user_prompt or CODING_PROMPT,  # Use user vocabulary
        )
        return " ".join(seg.text.strip() for seg in segments)

    def _transcribe_final(self, audio: np.ndarray) -> str:
        """
        High-quality final transcription.

        Performance: Uses cached user vocabulary prompt for personalization.
        """
        result = self.stt.transcribe_final(
            audio,
            initial_prompt=self._user_prompt or CODING_PROMPT,  # Use user vocabulary
        )
        return result.text

    def _compute_diff(self, old: str, new: str) -> list[TextChange]:
        """Compute minimal edit operations to transform old -> new."""
        import difflib

        matcher = difflib.SequenceMatcher(None, old, new)
        changes: list[TextChange] = []

        for op, i1, i2, j1, j2 in matcher.get_opcodes():
            if op == "replace":
                changes.append(
                    TextChange(
                        start=i1, deleteCount=i2 - i1, insert=new[j1:j2]
                    )
                )
            elif op == "insert":
                changes.append(
                    TextChange(start=i1, deleteCount=0, insert=new[j1:j2])
                )
            elif op == "delete":
                changes.append(
                    TextChange(start=i1, deleteCount=i2 - i1, insert="")
                )

        return changes

    def reset(self) -> None:
        """Reset buffer and state for new session."""
        self.buffer.clear()
        self.last_transcript = ""


@lru_cache
def get_stt_service() -> WhisperSTT:
    """
    Get cached STT service instance.

    Uses model size from configuration.
    """
    from app.config import get_settings
    import os

    settings = get_settings()
    # Expand ~ to user home directory
    model_path = os.path.expanduser(settings.stt_model_path)

    return WhisperSTT(
        model_size=settings.stt_model,
        device=settings.stt_device,
        compute_type=settings.stt_compute_type,
        download_root=model_path,
    )


def get_streaming_stt() -> StreamingWhisperSTT:
    """
    Get new streaming STT instance.

    Each WebSocket connection gets its own instance.
    """
    from app.config import get_settings
    import os

    settings = get_settings()
    # Expand ~ to user home directory
    model_path = os.path.expanduser(settings.stt_model_path)

    return StreamingWhisperSTT(
        model_size=settings.stt_model,
        device=settings.stt_device,
        compute_type=settings.stt_compute_type,
        download_root=model_path,
    )
