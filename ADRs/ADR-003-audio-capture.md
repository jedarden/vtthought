# ADR-003: Audio Capture Approach

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

The VS Code extension needs to capture audio from the user's microphone. VS Code extensions run in a Node.js environment with limited access to system audio APIs.

## Decision Drivers

- **Cross-platform**: Must work on Windows, macOS, Linux
- **Quality**: 16kHz mono minimum for Whisper
- **Latency**: Capture must not add significant delay
- **Permissions**: Handle microphone permissions gracefully
- **Bundle size**: Extension shouldn't be too large

## Options Considered

### Option A: WebView with Web Audio API (Recommended)

```
┌──────────────────────────────────────────────────────────────────────┐
│                      WEBVIEW AUDIO CAPTURE                            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                     VS CODE EXTENSION                            │ │
│  │  ┌─────────────────────────────────────────────────────────┐    │ │
│  │  │                    WEBVIEW PANEL                         │    │ │
│  │  │  ┌───────────────────────────────────────────────────┐  │    │ │
│  │  │  │  navigator.mediaDevices.getUserMedia()            │  │    │ │
│  │  │  │           │                                        │  │    │ │
│  │  │  │           ▼                                        │  │    │ │
│  │  │  │  MediaStreamAudioSourceNode                       │  │    │ │
│  │  │  │           │                                        │  │    │ │
│  │  │  │           ▼                                        │  │    │ │
│  │  │  │  AudioWorkletProcessor (resampling to 16kHz)      │  │    │ │
│  │  │  │           │                                        │  │    │ │
│  │  │  │           ▼                                        │  │    │ │
│  │  │  │  postMessage(audioChunk) to extension             │  │    │ │
│  │  │  └───────────────────────────────────────────────────┘  │    │ │
│  │  └─────────────────────────────────────────────────────────┘    │ │
│  │                              │                                   │ │
│  │                              ▼                                   │ │
│  │  ┌─────────────────────────────────────────────────────────┐    │ │
│  │  │  Extension Host (receives audio via message passing)    │    │ │
│  │  │  → Streams to WebSocket backend                         │    │ │
│  │  └─────────────────────────────────────────────────────────┘    │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
// Extension creates WebView panel
const panel = vscode.window.createWebviewPanel(
    'voiceCapture',
    'Voice Input',
    vscode.ViewColumn.Two,
    { enableScripts: true }
);

panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
    <script>
        const vscode = acquireVsCodeApi();
        let mediaRecorder;
        let audioContext;

        async function startCapture() {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            audioContext = new AudioContext({ sampleRate: 16000 });
            const source = audioContext.createMediaStreamSource(stream);

            await audioContext.audioWorklet.addModule('processor.js');
            const processor = new AudioWorkletNode(audioContext, 'audio-processor');

            processor.port.onmessage = (e) => {
                // Send audio chunks to extension
                vscode.postMessage({ type: 'audio', data: e.data });
            };

            source.connect(processor);
        }

        window.addEventListener('message', (e) => {
            if (e.data.command === 'start') startCapture();
            if (e.data.command === 'stop') stopCapture();
        });
    </script>
</head>
<body>
    <div id="status">Ready</div>
    <button onclick="startCapture()">Start</button>
</body>
</html>
`;

// Receive audio from WebView
panel.webview.onDidReceiveMessage(message => {
    if (message.type === 'audio') {
        websocket.send(message.data);
    }
});
```

**Pros:**
- Cross-platform (Web APIs)
- Permission handling built-in
- No native dependencies
- Access to Web Audio processing (resampling, noise suppression)

**Cons:**
- Requires visible WebView (can be minimized)
- Slightly higher latency than native
- Message passing overhead

### Option B: Native Node Module (node-microphone)

```typescript
import { Microphone } from 'node-microphone';

const mic = new Microphone({
    rate: 16000,
    channels: 1,
    encoding: 'signed-integer',
    bitwidth: 16
});

const stream = mic.startRecording();
stream.on('data', (chunk) => {
    websocket.send(chunk);
});
```

**Pros:**
- Direct audio access
- Lower latency
- No WebView needed

**Cons:**
- Native compilation required per platform
- Larger extension bundle
- Permission handling varies by OS
- Maintenance burden

### Option C: External Helper Process

Ship a small native binary (Rust/Go) that captures audio and pipes to extension.

```
Extension  ←→  Helper Binary (via stdio)  ←→  System Audio
```

**Pros:**
- Clean separation
- Binary can be optimized per platform
- Extension stays pure TypeScript

**Cons:**
- Binary distribution complexity
- Security review needed
- Platform-specific binaries

### Option D: System-Level (OS Audio APIs)

Use VS Code's proposed Audio API (not yet available as of 2025).

**Status:** Not available - VS Code doesn't expose audio APIs to extensions.

## Decision

**Option A: WebView with Web Audio API**

Rationale:
1. Cross-platform without native code
2. Built-in permission handling
3. Access to Web Audio features (resampling, noise suppression)
4. WebView can be hidden/minimized in sidebar
5. Aligns with how other VS Code audio tools work

## Implementation Details

### WebView Placement

Use `WebviewViewProvider` for sidebar integration:

```typescript
class VoiceInputViewProvider implements vscode.WebviewViewProvider {
    resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();
    }
}

// Register in extension activation
vscode.window.registerWebviewViewProvider('voicecode.input', new VoiceInputViewProvider());
```

### Audio Format

- **Sample Rate:** 16000 Hz (Whisper optimal)
- **Channels:** 1 (mono)
- **Bit Depth:** 16-bit signed integer
- **Encoding:** PCM or Opus for compression

### AudioWorklet Processor

```javascript
// processor.js
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = [];
        this.bufferSize = 4096; // ~256ms at 16kHz
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input.length > 0) {
            const samples = input[0];
            this.buffer.push(...samples);

            if (this.buffer.length >= this.bufferSize) {
                const chunk = new Float32Array(this.buffer.splice(0, this.bufferSize));
                this.port.postMessage(chunk);
            }
        }
        return true;
    }
}

registerProcessor('audio-processor', AudioProcessor);
```

### Permission Handling

```typescript
// Check permission before starting
async function checkMicrophonePermission(): Promise<boolean> {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        return true;
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            vscode.window.showErrorMessage(
                'Microphone permission denied. Please allow microphone access.'
            );
        }
        return false;
    }
}
```

### Voice Activity Detection (Optional)

Implement client-side VAD to reduce bandwidth:

```javascript
// Simple energy-based VAD
function isVoiceActive(samples) {
    const rms = Math.sqrt(
        samples.reduce((sum, s) => sum + s * s, 0) / samples.length
    );
    return rms > 0.01; // Threshold
}
```

## Consequences

### Positive
- Works across all platforms
- No native code compilation
- Built-in echo cancellation and noise suppression
- Clean permission UX

### Negative
- Requires WebView (minor UI element)
- Slightly higher latency than native
- Limited to browser audio capabilities

## Audio Quality Considerations

### Recommended Settings

```javascript
const constraints = {
    audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    }
};
```

### Compression (Optional)

For bandwidth-constrained scenarios, use Opus encoding:

```javascript
const mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 16000
});
```

## Related ADRs
- ADR-001: System Architecture
- ADR-004: Audio Streaming Protocol
