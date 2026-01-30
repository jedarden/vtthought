# ADR-004: Audio Streaming Protocol

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

Audio captured in the VS Code extension must be transmitted to the backend for transcription. The protocol choice affects latency, reliability, and implementation complexity.

## Decision Drivers

- **Latency**: Minimize time from speech to transcription
- **Reliability**: Handle network interruptions gracefully
- **Bidirectional**: Stream audio up, stream transcription down
- **Efficiency**: Minimize bandwidth and overhead
- **Simplicity**: Easy to implement and debug

## Options Considered

### Option A: WebSocket with Binary Frames (Recommended)

```
┌──────────────────────────────────────────────────────────────────────┐
│                    WEBSOCKET STREAMING                                │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  VS Code Extension                              Backend               │
│  ┌─────────────────┐                    ┌─────────────────────────┐  │
│  │ Audio Capture   │                    │  WebSocket Server       │  │
│  │                 │                    │                         │  │
│  │  Binary Frame   │ ─────────────────▶ │  Audio Buffer           │  │
│  │  (PCM chunks)   │    wss://...       │                         │  │
│  │                 │                    │  ┌─────────────────┐    │  │
│  │  JSON Frame     │ ◀───────────────── │  │ Whisper STT     │    │  │
│  │  (transcription)│                    │  └─────────────────┘    │  │
│  │                 │                    │                         │  │
│  │  JSON Frame     │ ◀───────────────── │  Partial results        │  │
│  │  (partial)      │                    │  (streaming)            │  │
│  └─────────────────┘                    └─────────────────────────┘  │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Protocol Messages:**

```typescript
// Client → Server (Binary)
// Raw PCM audio chunks (16kHz, mono, 16-bit)

// Client → Server (JSON)
interface StartMessage {
    type: 'start';
    config: {
        language?: string;
        enhanceWithLlm: boolean;
        voiceCommands: boolean;
    };
}

interface StopMessage {
    type: 'stop';
}

// Server → Client (JSON)
interface PartialTranscript {
    type: 'partial';
    text: string;
    confidence: number;
}

interface FinalTranscript {
    type: 'final';
    raw: string;           // Raw Whisper output
    enhanced: string;      // LLM-cleaned output
    commands: VoiceCommand[];  // Parsed voice commands
}

interface ErrorMessage {
    type: 'error';
    code: string;
    message: string;
}
```

**Pros:**
- Full-duplex communication
- Low latency (persistent connection)
- Binary frames for audio (efficient)
- JSON frames for control/results
- Native browser/Node.js support

**Cons:**
- Stateful connection (reconnection handling needed)
- Firewall/proxy issues in some networks

### Option B: HTTP/2 Server-Sent Events + POST

```
┌──────────────────────────────────────────────────────────────────────┐
│                    HTTP/2 + SSE                                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Extension                                    Backend                 │
│  ┌─────────────────┐                    ┌─────────────────────────┐  │
│  │ POST /audio     │ ─────────────────▶ │  Receive audio          │  │
│  │ (chunked body)  │                    │                         │  │
│  │                 │                    │                         │  │
│  │ GET /events     │ ◀───────────────── │  SSE stream             │  │
│  │ (EventSource)   │                    │  (transcription events) │  │
│  └─────────────────┘                    └─────────────────────────┘  │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Simpler server implementation
- Better proxy/firewall compatibility
- HTTP/2 multiplexing

**Cons:**
- Two connections needed
- Higher latency than WebSocket
- Chunked POST not universally supported

### Option C: WebRTC Data Channel

```
┌──────────────────────────────────────────────────────────────────────┐
│                    WEBRTC DATA CHANNEL                                │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Extension (WebView)                          Backend                 │
│  ┌─────────────────┐                    ┌─────────────────────────┐  │
│  │ RTCPeerConnection                    │  RTCPeerConnection      │  │
│  │                 │ ◀── Signaling ───▶ │                         │  │
│  │ DataChannel     │ ═══════════════════│  DataChannel            │  │
│  │ (audio)         │   Peer-to-Peer     │  (transcription)        │  │
│  └─────────────────┘                    └─────────────────────────┘  │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Lowest latency (P2P when possible)
- Built-in audio codecs
- NAT traversal

**Cons:**
- Complex setup (STUN/TURN)
- Overkill for client-server
- Harder to debug

### Option D: gRPC Streaming

```protobuf
service VoiceTranscription {
    rpc Transcribe(stream AudioChunk) returns (stream TranscriptResult);
}

message AudioChunk {
    bytes audio_data = 1;
    int64 timestamp = 2;
}

message TranscriptResult {
    string text = 1;
    bool is_final = 2;
}
```

**Pros:**
- Strongly typed
- Efficient binary protocol
- Bidirectional streaming

**Cons:**
- gRPC-web needed for browser
- Additional tooling
- Less common in JS ecosystem

## Decision

**Option A: WebSocket with Binary Frames**

Rationale:
1. Native support in both browser (WebView) and Node.js
2. True bidirectional streaming
3. Binary frames for audio efficiency
4. JSON frames for structured messages
5. Well-understood, widely used

## Implementation Details

### Client Implementation (TypeScript)

```typescript
class VoiceWebSocket {
    private ws: WebSocket;
    private reconnectAttempts = 0;
    private maxReconnects = 5;

    constructor(private url: string, private token: string) {}

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(`${this.url}?token=${this.token}`);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                this.reconnectAttempts = 0;
                resolve();
            };

            this.ws.onclose = (event) => {
                if (event.code !== 1000) {
                    this.handleReconnect();
                }
            };

            this.ws.onerror = reject;
        });
    }

    startSession(config: SessionConfig): void {
        this.ws.send(JSON.stringify({
            type: 'start',
            config
        }));
    }

    sendAudio(chunk: ArrayBuffer): void {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(chunk);
        }
    }

    stopSession(): void {
        this.ws.send(JSON.stringify({ type: 'stop' }));
    }

    onTranscript(callback: (result: TranscriptResult) => void): void {
        this.ws.onmessage = (event) => {
            if (typeof event.data === 'string') {
                const message = JSON.parse(event.data);
                callback(message);
            }
        };
    }

    private handleReconnect(): void {
        if (this.reconnectAttempts < this.maxReconnects) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            setTimeout(() => this.connect(), delay);
        }
    }
}
```

### Server Implementation (Python/FastAPI)

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.websockets import WebSocketState
import asyncio
import json

app = FastAPI()

class TranscriptionSession:
    def __init__(self, websocket: WebSocket, user_id: str):
        self.websocket = websocket
        self.user_id = user_id
        self.audio_buffer = bytearray()
        self.is_active = False

    async def handle_message(self, data):
        if isinstance(data, bytes):
            # Binary audio data
            self.audio_buffer.extend(data)

            # Process in chunks (e.g., every 0.5s of audio)
            if len(self.audio_buffer) >= 16000:  # 0.5s at 16kHz, 16-bit
                await self.process_audio()

        else:
            # JSON control message
            message = json.loads(data)
            if message['type'] == 'start':
                self.is_active = True
                self.config = message.get('config', {})
            elif message['type'] == 'stop':
                await self.finalize()

    async def process_audio(self):
        audio_chunk = bytes(self.audio_buffer)
        self.audio_buffer.clear()

        # Run Whisper transcription
        partial = await transcribe_audio(audio_chunk, partial=True)

        await self.websocket.send_json({
            'type': 'partial',
            'text': partial,
            'confidence': 0.9
        })

    async def finalize(self):
        if self.audio_buffer:
            audio = bytes(self.audio_buffer)
            self.audio_buffer.clear()

            # Final transcription
            raw_text = await transcribe_audio(audio, partial=False)

            # LLM enhancement
            enhanced = await enhance_with_llm(raw_text) if self.config.get('enhanceWithLlm') else raw_text

            # Parse voice commands
            commands = parse_voice_commands(enhanced) if self.config.get('voiceCommands') else []

            await self.websocket.send_json({
                'type': 'final',
                'raw': raw_text,
                'enhanced': enhanced,
                'commands': commands
            })

        self.is_active = False

@app.websocket("/ws/transcribe")
async def transcribe_endpoint(websocket: WebSocket, token: str):
    # Validate token
    user_id = validate_token(token)
    if not user_id:
        await websocket.close(code=4001, reason="Invalid token")
        return

    await websocket.accept()
    session = TranscriptionSession(websocket, user_id)

    try:
        while True:
            data = await websocket.receive()
            if 'bytes' in data:
                await session.handle_message(data['bytes'])
            elif 'text' in data:
                await session.handle_message(data['text'])
    except WebSocketDisconnect:
        pass
```

### Audio Chunk Format

```
┌────────────────────────────────────────────────────────────┐
│                    AUDIO CHUNK FORMAT                       │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Binary WebSocket Frame:                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  PCM Audio Data (Little Endian)                     │   │
│  │  - Sample Rate: 16000 Hz                            │   │
│  │  - Channels: 1 (mono)                               │   │
│  │  - Bit Depth: 16-bit signed integer                 │   │
│  │  - Chunk Size: 8192 bytes (~256ms)                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Optional Opus Encoding:                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1 byte: Frame type (0x01 = Opus)                   │   │
│  │  4 bytes: Timestamp (uint32)                        │   │
│  │  N bytes: Opus encoded audio                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

### Connection Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CONNECTION LIFECYCLE                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. CONNECT                                                          │
│     Client ──▶ wss://backend/ws/transcribe?token=xxx                │
│     Server validates token, accepts connection                       │
│                                                                      │
│  2. START SESSION                                                    │
│     Client ──▶ {"type": "start", "config": {...}}                   │
│     Server initializes transcription session                         │
│                                                                      │
│  3. STREAM AUDIO                                                     │
│     Client ──▶ [binary audio chunks]                                │
│     Server ◀── {"type": "partial", "text": "..."}                   │
│     (repeat until user stops)                                        │
│                                                                      │
│  4. STOP SESSION                                                     │
│     Client ──▶ {"type": "stop"}                                     │
│     Server ◀── {"type": "final", "raw": "...", "enhanced": "..."}   │
│                                                                      │
│  5. CLOSE (or repeat from step 2)                                    │
│     Client closes WebSocket                                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Error Handling

```typescript
// Error codes
enum ErrorCode {
    AUTH_FAILED = 'AUTH_FAILED',
    RATE_LIMIT = 'RATE_LIMIT',
    TRANSCRIPTION_ERROR = 'TRANSCRIPTION_ERROR',
    LLM_ERROR = 'LLM_ERROR',
    INVALID_AUDIO = 'INVALID_AUDIO'
}

// Server sends error message
interface ErrorMessage {
    type: 'error';
    code: ErrorCode;
    message: string;
    retryable: boolean;
}
```

## Consequences

### Positive
- Real-time bidirectional streaming
- Efficient binary transfer for audio
- JSON for control messages (easy debugging)
- Well-supported in all environments

### Negative
- Stateful connection management
- Need to handle reconnection
- Some corporate firewalls block WebSocket

### Mitigations
- Exponential backoff for reconnection
- Fallback to HTTP polling (degraded mode)
- Connection health monitoring with ping/pong

## Related ADRs
- ADR-001: System Architecture
- ADR-003: Audio Capture Approach
- ADR-005: STT Engine Selection
