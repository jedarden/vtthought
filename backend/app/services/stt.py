"""
VTThought STT Service (ADR-005)

Speech-to-text service using faster-whisper with GPU acceleration.
Supports streaming transcription with interim results.
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
    CircuitBreaker,
    RetryConfig,
    TimeoutError,
    ValidationError,
    get_circuit_breaker,
    retry_with_backoff,
)

logger = logging.getLogger(__name__)


# Technical vocabulary for code-related transcription
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
    ) -> str:
        """
        Transcribe audio array to text.

        Args:
            audio: Audio samples as float32 numpy array (-1.0 to 1.0)
            sample_rate: Sample rate in Hz (default 16000)
            language: Language code (default 'en')

        Returns:
            Transcribed text string
        """
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

        try:
            segments, info = self.model.transcribe(
                audio,
                beam_size=5,
                best_of=5,
                language=language,
                initial_prompt=CODING_PROMPT,
                condition_on_previous_text=True,
                vad_filter=True,
                vad_parameters={
                    "threshold": 0.5,
                    "min_speech_duration_ms": 250,
                    "min_silence_duration_ms": 500,
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

    def transcribe_final(
        self,
        audio: bytes | np.ndarray,
        sample_rate: int = 16000,
    ) -> TranscriptionResult:
        """
        High-quality final transcription.

        Args:
            audio: Audio as bytes (PCM16) or numpy array (float32)
            sample_rate: Sample rate in Hz

        Returns:
            TranscriptionResult with final text
        """
        # Convert bytes to numpy if needed
        if isinstance(audio, bytes):
            audio_array = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
        else:
            audio_array = audio

        # Transcribe with high-quality settings
        segments, info = self.model.transcribe(
            audio_array,
            beam_size=5,
            best_of=5,
            language="en",
            temperature=0.0,
            initial_prompt=CODING_PROMPT,
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
    """

    def __init__(
        self,
        model_size: str = "base",
        device: str = "auto",
        compute_type: str = "float16",
    ) -> None:
        """
        Initialize streaming STT.

        Args:
            model_size: Whisper model size
            device: Device to use
            compute_type: Computation type
        """
        self.stt = WhisperSTT(model_size, device, compute_type)
        self.buffer: bytearray = bytearray()
        self.last_transcript = ""
        self.chunk_size = 16000  # 1 second at 16kHz
        self.process_interval = 8000  # Process every 500ms

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
        """Quick transcription for interim results."""
        segments, _ = self.stt.model.transcribe(
            audio,
            language="en",
            condition_on_previous_text=True,
            vad_filter=False,  # Skip VAD for speed
        )
        return " ".join(seg.text.strip() for seg in segments)

    def _transcribe_final(self, audio: np.ndarray) -> str:
        """High-quality final transcription."""
        result = self.stt.transcribe_final(audio)
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

    settings = get_settings()

    return WhisperSTT(
        model_size=settings.stt_model,
        device=settings.stt_device,
        compute_type=settings.stt_compute_type,
    )


def get_streaming_stt() -> StreamingWhisperSTT:
    """
    Get new streaming STT instance.

    Each WebSocket connection gets its own instance.
    """
    from app.config import get_settings

    settings = get_settings()

    return StreamingWhisperSTT(
        model_size=settings.stt_model,
        device=settings.stt_device,
        compute_type=settings.stt_compute_type,
    )
