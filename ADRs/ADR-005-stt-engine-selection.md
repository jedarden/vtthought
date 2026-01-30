# ADR-005: Speech-to-Text Engine Selection

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

The backend needs to transcribe audio to text. Multiple STT engines are available with different tradeoffs in accuracy, latency, cost, and privacy.

## Decision Drivers

- **Accuracy**: Technical vocabulary (code terms) must be transcribed correctly
- **Latency**: Sub-second transcription for responsive UX
- **Cost**: Minimize per-request costs
- **Privacy**: Option for fully local processing
- **Scalability**: Handle multiple concurrent users

## Options Considered

### Option A: faster-whisper (Local, GPU) - Recommended for Self-Hosted

```
┌──────────────────────────────────────────────────────────────────────┐
│                    FASTER-WHISPER                                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  CTranslate2 Runtime (optimized Whisper)                        │ │
│  │                                                                  │ │
│  │  Models:                                                         │ │
│  │  - tiny.en    (39MB)   → ~10x realtime on CPU                   │ │
│  │  - base.en    (74MB)   → ~5x realtime on CPU                    │ │
│  │  - small.en   (244MB)  → ~2x realtime on CPU                    │ │
│  │  - medium.en  (769MB)  → ~1x realtime on GPU                    │ │
│  │  - large-v3   (1.5GB)  → ~3x realtime on GPU (best accuracy)    │ │
│  │                                                                  │ │
│  │  GPU Acceleration:                                               │ │
│  │  - CUDA (NVIDIA)                                                 │ │
│  │  - ROCm (AMD)                                                    │ │
│  │  - int8/float16 quantization                                     │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Benchmarks (RTX 3090, large-v3):**

| Audio Duration | Transcription Time | Real-time Factor |
|----------------|-------------------|------------------|
| 5 seconds | 0.8s | 6.25x |
| 30 seconds | 2.1s | 14.3x |
| 5 minutes | 12s | 25x |

**Implementation:**

```python
from faster_whisper import WhisperModel

model = WhisperModel(
    "large-v3",
    device="cuda",
    compute_type="float16"
)

def transcribe(audio_path: str) -> str:
    segments, info = model.transcribe(
        audio_path,
        beam_size=5,
        language="en",
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500)
    )
    return " ".join(segment.text for segment in segments)
```

**Pros:**
- Complete privacy (local processing)
- No per-request costs
- Excellent accuracy with large model
- GPU acceleration

**Cons:**
- Requires GPU for best performance
- Model loading time on cold start
- Memory usage (2-4GB VRAM for large)

### Option B: Deepgram Nova-3 (Cloud)

```
┌──────────────────────────────────────────────────────────────────────┐
│                    DEEPGRAM NOVA-3                                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Streaming API:                                                       │
│  - WebSocket connection                                               │
│  - Real-time transcription (~200ms latency)                          │
│  - Interim results (partial transcriptions)                          │
│                                                                       │
│  Features:                                                            │
│  - Custom vocabulary (keyterms)                                       │
│  - Speaker diarization                                                │
│  - Smart formatting                                                   │
│  - Punctuation                                                        │
│                                                                       │
│  Pricing: ~$0.0043/minute                                            │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```python
from deepgram import DeepgramClient, LiveOptions

deepgram = DeepgramClient(api_key=DEEPGRAM_API_KEY)

async def transcribe_stream(audio_stream):
    connection = deepgram.listen.live.v("1")

    options = LiveOptions(
        model="nova-3",
        language="en",
        smart_format=True,
        interim_results=True,
        punctuate=True,
        keyterms=["Claude", "VS Code", "TypeScript", "Python"]
    )

    await connection.start(options)

    async for chunk in audio_stream:
        await connection.send(chunk)

    await connection.finish()
```

**Pros:**
- Lowest latency (~200ms)
- Custom vocabulary support
- Streaming with interim results
- No infrastructure needed

**Cons:**
- Per-request cost
- Audio sent to cloud
- Dependency on external service

### Option C: OpenAI Whisper API (Cloud)

```python
from openai import OpenAI

client = OpenAI()

def transcribe(audio_file):
    result = client.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file,
        response_format="text"
    )
    return result
```

**Pricing:** $0.006/minute

**Pros:**
- Simple API
- High accuracy
- Widely used

**Cons:**
- Batch only (no streaming)
- Higher latency (~1-2s)
- More expensive than Deepgram

### Option D: AssemblyAI Universal-Streaming (Cloud)

Similar to Deepgram with ~300ms latency. Pricing: ~$0.47/hour.

### Option E: Hybrid (Local + Cloud Fallback)

Use faster-whisper locally when GPU available, fallback to Deepgram when:
- High load
- CPU-only server
- User prefers cloud

```python
class HybridSTT:
    def __init__(self):
        self.local = None
        self.cloud = DeepgramClient()

        if torch.cuda.is_available():
            self.local = WhisperModel("large-v3", device="cuda")

    async def transcribe(self, audio, prefer_local=True):
        if prefer_local and self.local:
            return self.local_transcribe(audio)
        else:
            return await self.cloud_transcribe(audio)
```

## Decision

**Primary: faster-whisper (large-v3) with GPU**

For self-hosted deployments where the user controls the backend:
- Best accuracy
- Complete privacy
- No per-request costs
- Sub-second latency with GPU

**Fallback: Deepgram Nova-3**

When GPU not available or for SaaS offering:
- Lowest latency
- Custom vocabulary for technical terms
- Streaming support

## Model Selection Guide

| Scenario | Recommended Model |
|----------|-------------------|
| GPU available, accuracy priority | faster-whisper large-v3 |
| GPU available, speed priority | faster-whisper medium.en |
| CPU only, tolerable latency | faster-whisper small.en |
| Lowest latency required | Deepgram Nova-3 |
| Privacy not critical, easy setup | OpenAI Whisper API |

## Implementation Details

### faster-whisper Setup

```python
import torch
from faster_whisper import WhisperModel
import numpy as np

class WhisperSTT:
    def __init__(self, model_size="large-v3"):
        device = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"

        self.model = WhisperModel(
            model_size,
            device=device,
            compute_type=compute_type,
            download_root="/models/whisper"
        )

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000) -> str:
        """
        Args:
            audio: numpy array of audio samples (float32, -1 to 1)
            sample_rate: sample rate in Hz
        Returns:
            Transcribed text
        """
        segments, info = self.model.transcribe(
            audio,
            beam_size=5,
            best_of=5,
            language="en",
            condition_on_previous_text=True,
            vad_filter=True,
            vad_parameters={
                "threshold": 0.5,
                "min_speech_duration_ms": 250,
                "min_silence_duration_ms": 500
            }
        )

        return " ".join(segment.text.strip() for segment in segments)
```

### Streaming with Voice Activity Detection

```python
class StreamingWhisperSTT:
    def __init__(self):
        self.model = WhisperModel("large-v3", device="cuda")
        self.buffer = []
        self.vad = SileroVAD()

    async def process_chunk(self, audio_chunk: bytes) -> Optional[str]:
        """Process audio chunk, return transcription when speech ends."""

        audio = np.frombuffer(audio_chunk, dtype=np.int16).astype(np.float32) / 32768.0

        is_speech = self.vad.is_speech(audio)

        if is_speech:
            self.buffer.append(audio)
            return None  # Accumulating

        elif self.buffer:
            # Speech ended, transcribe
            full_audio = np.concatenate(self.buffer)
            self.buffer = []

            text = self.transcribe(full_audio)
            return text

        return None
```

### Technical Vocabulary Handling

For code-related terms, use initial prompt:

```python
CODING_PROMPT = """
Technical programming terms: TypeScript, JavaScript, Python, Rust, Go,
React, Vue, Angular, FastAPI, Django, Flask, PostgreSQL, MongoDB, Redis,
Docker, Kubernetes, AWS, GCP, Azure, GitHub, GitLab, CI/CD, API, REST,
GraphQL, WebSocket, JSON, YAML, HTTP, HTTPS, SSL, TLS, JWT, OAuth,
npm, pip, cargo, brew, apt, Claude, Anthropic, OpenAI, LLM
"""

segments, _ = model.transcribe(
    audio,
    initial_prompt=CODING_PROMPT
)
```

## Consequences

### Positive
- High accuracy for technical speech
- Privacy-preserving option available
- Scalable with GPU acceleration
- Fallback ensures availability

### Negative
- GPU required for best performance
- Model size requires disk space
- Cold start latency on first request

### Performance Targets

| Metric | Target | faster-whisper (GPU) |
|--------|--------|----------------------|
| Latency (5s audio) | <1s | ~0.5s |
| Latency (30s audio) | <3s | ~2s |
| Word Error Rate | <5% | ~3-4% |
| Throughput | 10 concurrent | Yes |

## Related ADRs
- ADR-001: System Architecture
- ADR-004: Audio Streaming Protocol
- ADR-006: LLM Post-Processing
