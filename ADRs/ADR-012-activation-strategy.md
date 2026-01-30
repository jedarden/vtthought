# ADR-012: Activation Strategy

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

Users need a way to trigger audio recording for dictation. The activation method significantly impacts UX - it must be intuitive, prevent accidental activations, and work across different contexts (editor, terminal, input boxes).

## Decision Drivers

- **Intuitiveness**: Easy to learn and use
- **Accident prevention**: Minimize unintended recordings
- **Flexibility**: Support different user preferences
- **Extensibility**: Architecture should support future activation modes
- **VS Code integration**: Work within VS Code's keybinding system

## Activation Modes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ACTIVATION MODES                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PUSH-TO-TALK (MVP Default)                                                  │
│  ├─ Hold hotkey to record                                                   │
│  ├─ Release to process                                                      │
│  ├─ ESC to cancel while holding                                             │
│  └─ Most intuitive, prevents accidents                                      │
│                                                                              │
│  TOGGLE (Future)                                                             │
│  ├─ Press hotkey to start recording                                         │
│  ├─ Press again to stop and process                                         │
│  ├─ ESC to cancel                                                           │
│  └─ Better for longer dictation                                             │
│                                                                              │
│  VAD - Voice Activity Detection (Future)                                     │
│  ├─ Press hotkey to start                                                   │
│  ├─ Auto-stops after silence threshold                                      │
│  ├─ Configurable silence duration (e.g., 1.5s)                              │
│  └─ Hands-free after activation                                             │
│                                                                              │
│  CONTINUOUS (Future)                                                         │
│  ├─ Press hotkey to start                                                   │
│  ├─ Auto-restarts after each utterance                                      │
│  ├─ Press hotkey to stop completely                                         │
│  └─ For extended dictation sessions                                         │
│                                                                              │
│  VOICE ACTIVATION (Future)                                                   │
│  ├─ Wake word detection ("Hey Code")                                        │
│  ├─ Always listening for wake word                                          │
│  ├─ Privacy/battery implications                                            │
│  └─ Requires local wake word model                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Decision

**Push-to-Talk as MVP default** with an extensible architecture supporting future modes.

### Default Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Mode | Push-to-Talk | Most intuitive, industry standard |
| Hotkey | `Ctrl+Shift+D` | D=dictate, available in VS Code |
| Cancel | `Escape` | Universal cancel |
| Minimum duration | 200ms | Prevent accidental taps |

## Architecture

### Activation Mode Interface

```typescript
/**
 * Abstract interface for activation modes.
 * Each mode controls when recording starts/stops.
 */
interface ActivationMode {
    readonly id: string;
    readonly displayName: string;

    /**
     * Initialize the activation mode with callbacks.
     */
    initialize(callbacks: ActivationCallbacks): void;

    /**
     * Start listening for activation triggers.
     */
    enable(): void;

    /**
     * Stop listening for activation triggers.
     */
    disable(): void;

    /**
     * Clean up resources.
     */
    dispose(): void;

    /**
     * Current state of the activation mode.
     */
    readonly state: ActivationState;
}

interface ActivationCallbacks {
    onRecordingStart: () => void;
    onRecordingStop: () => void;
    onRecordingCancel: () => void;
    onError: (error: Error) => void;
}

type ActivationState =
    | { status: 'idle' }
    | { status: 'listening' }      // Waiting for trigger
    | { status: 'recording' }       // Actively recording
    | { status: 'processing' }      // Recording stopped, processing
    | { status: 'error'; message: string };
```

### Push-to-Talk Implementation

```typescript
import * as vscode from 'vscode';

class PushToTalkMode implements ActivationMode {
    readonly id = 'push-to-talk';
    readonly displayName = 'Push to Talk';

    private callbacks: ActivationCallbacks | null = null;
    private _state: ActivationState = { status: 'idle' };
    private keyDownTime: number = 0;
    private isKeyDown = false;
    private disposables: vscode.Disposable[] = [];

    // Configuration
    private readonly minDuration = 200; // ms - prevent accidental taps

    get state(): ActivationState {
        return this._state;
    }

    initialize(callbacks: ActivationCallbacks): void {
        this.callbacks = callbacks;
    }

    enable(): void {
        this._state = { status: 'listening' };

        // Register key down handler (start recording)
        const keyDownDisposable = vscode.commands.registerCommand(
            'voicecode.activationKeyDown',
            () => this.handleKeyDown()
        );

        // Register key up handler (stop recording)
        const keyUpDisposable = vscode.commands.registerCommand(
            'voicecode.activationKeyUp',
            () => this.handleKeyUp()
        );

        // Register cancel handler
        const cancelDisposable = vscode.commands.registerCommand(
            'voicecode.cancel',
            () => this.handleCancel()
        );

        this.disposables.push(keyDownDisposable, keyUpDisposable, cancelDisposable);
    }

    disable(): void {
        this._state = { status: 'idle' };
        this.isKeyDown = false;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    private handleKeyDown(): void {
        if (this.isKeyDown) return; // Ignore key repeat

        this.isKeyDown = true;
        this.keyDownTime = Date.now();
        this._state = { status: 'recording' };

        this.callbacks?.onRecordingStart();
    }

    private handleKeyUp(): void {
        if (!this.isKeyDown) return;

        this.isKeyDown = false;
        const duration = Date.now() - this.keyDownTime;

        if (duration < this.minDuration) {
            // Too short - treat as accidental tap
            this._state = { status: 'listening' };
            this.callbacks?.onRecordingCancel();
            return;
        }

        this._state = { status: 'processing' };
        this.callbacks?.onRecordingStop();
    }

    private handleCancel(): void {
        if (this._state.status === 'recording') {
            this.isKeyDown = false;
            this._state = { status: 'listening' };
            this.callbacks?.onRecordingCancel();
        }
    }
}
```

### Toggle Mode Implementation (Future)

```typescript
class ToggleMode implements ActivationMode {
    readonly id = 'toggle';
    readonly displayName = 'Toggle';

    private callbacks: ActivationCallbacks | null = null;
    private _state: ActivationState = { status: 'idle' };
    private isRecording = false;
    private disposables: vscode.Disposable[] = [];

    get state(): ActivationState {
        return this._state;
    }

    initialize(callbacks: ActivationCallbacks): void {
        this.callbacks = callbacks;
    }

    enable(): void {
        this._state = { status: 'listening' };

        const toggleDisposable = vscode.commands.registerCommand(
            'voicecode.toggle',
            () => this.handleToggle()
        );

        const cancelDisposable = vscode.commands.registerCommand(
            'voicecode.cancel',
            () => this.handleCancel()
        );

        this.disposables.push(toggleDisposable, cancelDisposable);
    }

    disable(): void {
        this._state = { status: 'idle' };
        this.isRecording = false;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    private handleToggle(): void {
        if (this.isRecording) {
            // Stop recording
            this.isRecording = false;
            this._state = { status: 'processing' };
            this.callbacks?.onRecordingStop();
        } else {
            // Start recording
            this.isRecording = true;
            this._state = { status: 'recording' };
            this.callbacks?.onRecordingStart();
        }
    }

    private handleCancel(): void {
        if (this.isRecording) {
            this.isRecording = false;
            this._state = { status: 'listening' };
            this.callbacks?.onRecordingCancel();
        }
    }
}
```

### VAD Mode Implementation (Future)

```typescript
class VADMode implements ActivationMode {
    readonly id = 'vad';
    readonly displayName = 'Voice Activity Detection';

    private callbacks: ActivationCallbacks | null = null;
    private _state: ActivationState = { status: 'idle' };
    private silenceTimer: NodeJS.Timeout | null = null;
    private disposables: vscode.Disposable[] = [];

    // Configuration
    private silenceThreshold = 1500; // ms of silence before stopping

    get state(): ActivationState {
        return this._state;
    }

    initialize(callbacks: ActivationCallbacks): void {
        this.callbacks = callbacks;
    }

    enable(): void {
        this._state = { status: 'listening' };

        const startDisposable = vscode.commands.registerCommand(
            'voicecode.start',
            () => this.handleStart()
        );

        const cancelDisposable = vscode.commands.registerCommand(
            'voicecode.cancel',
            () => this.handleCancel()
        );

        this.disposables.push(startDisposable, cancelDisposable);
    }

    disable(): void {
        this._state = { status: 'idle' };
        this.clearSilenceTimer();
    }

    dispose(): void {
        this.clearSilenceTimer();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    /**
     * Called by audio processor when voice activity is detected.
     */
    onVoiceActivity(isVoice: boolean): void {
        if (this._state.status !== 'recording') return;

        if (isVoice) {
            // Voice detected - reset silence timer
            this.clearSilenceTimer();
        } else {
            // Silence detected - start timer
            if (!this.silenceTimer) {
                this.silenceTimer = setTimeout(() => {
                    this._state = { status: 'processing' };
                    this.callbacks?.onRecordingStop();
                }, this.silenceThreshold);
            }
        }
    }

    private handleStart(): void {
        if (this._state.status === 'recording') return;

        this._state = { status: 'recording' };
        this.callbacks?.onRecordingStart();
    }

    private handleCancel(): void {
        if (this._state.status === 'recording') {
            this.clearSilenceTimer();
            this._state = { status: 'listening' };
            this.callbacks?.onRecordingCancel();
        }
    }

    private clearSilenceTimer(): void {
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
    }
}
```

### Activation Mode Registry

```typescript
/**
 * Registry for all available activation modes.
 * Allows dynamic mode switching and future mode additions.
 */
class ActivationModeRegistry {
    private modes = new Map<string, ActivationMode>();
    private activeMode: ActivationMode | null = null;
    private callbacks: ActivationCallbacks | null = null;

    constructor() {
        // Register built-in modes
        this.register(new PushToTalkMode());
        this.register(new ToggleMode());
        this.register(new VADMode());
    }

    /**
     * Register a new activation mode.
     */
    register(mode: ActivationMode): void {
        this.modes.set(mode.id, mode);
    }

    /**
     * Get all available modes.
     */
    getAvailableModes(): { id: string; displayName: string }[] {
        return Array.from(this.modes.values()).map(m => ({
            id: m.id,
            displayName: m.displayName
        }));
    }

    /**
     * Set the callbacks for activation events.
     */
    setCallbacks(callbacks: ActivationCallbacks): void {
        this.callbacks = callbacks;
    }

    /**
     * Switch to a different activation mode.
     */
    switchMode(modeId: string): void {
        const newMode = this.modes.get(modeId);
        if (!newMode) {
            throw new Error(`Unknown activation mode: ${modeId}`);
        }

        // Disable current mode
        if (this.activeMode) {
            this.activeMode.disable();
            this.activeMode.dispose();
        }

        // Enable new mode
        this.activeMode = newMode;
        if (this.callbacks) {
            this.activeMode.initialize(this.callbacks);
        }
        this.activeMode.enable();
    }

    /**
     * Get current mode state.
     */
    getState(): ActivationState | null {
        return this.activeMode?.state ?? null;
    }

    /**
     * Dispose all resources.
     */
    dispose(): void {
        if (this.activeMode) {
            this.activeMode.disable();
            this.activeMode.dispose();
        }
    }
}
```

### VS Code Keybindings

```json
// package.json contributes.keybindings
{
    "keybindings": [
        {
            "command": "voicecode.activationKeyDown",
            "key": "ctrl+shift+d",
            "when": "voicecode.mode == 'push-to-talk'"
        },
        {
            "command": "voicecode.activationKeyUp",
            "key": "ctrl+shift+d",
            "when": "voicecode.mode == 'push-to-talk'",
            "args": { "keyUp": true }
        },
        {
            "command": "voicecode.toggle",
            "key": "ctrl+shift+d",
            "when": "voicecode.mode == 'toggle'"
        },
        {
            "command": "voicecode.start",
            "key": "ctrl+shift+d",
            "when": "voicecode.mode == 'vad'"
        },
        {
            "command": "voicecode.cancel",
            "key": "escape",
            "when": "voicecode.isRecording"
        }
    ]
}
```

### Configuration Schema

```typescript
interface ActivationConfig {
    /**
     * The activation mode to use.
     * @default "push-to-talk"
     */
    mode: 'push-to-talk' | 'toggle' | 'vad' | 'continuous';

    /**
     * Primary activation hotkey.
     * @default "ctrl+shift+d"
     */
    hotkey: string;

    /**
     * Cancel recording hotkey.
     * @default "escape"
     */
    cancelKey: string;

    /**
     * Minimum recording duration in ms (prevents accidental taps).
     * @default 200
     */
    minDuration: number;

    /**
     * VAD mode: silence duration before auto-stop (ms).
     * @default 1500
     */
    silenceThreshold: number;

    /**
     * Show visual feedback during recording.
     * @default true
     */
    showRecordingIndicator: boolean;

    /**
     * Play sound on recording start/stop.
     * @default true
     */
    playSounds: boolean;
}
```

### VS Code Settings

```json
// package.json contributes.configuration
{
    "voicecode.activation.mode": {
        "type": "string",
        "enum": ["push-to-talk", "toggle", "vad"],
        "default": "push-to-talk",
        "description": "How to activate voice recording"
    },
    "voicecode.activation.hotkey": {
        "type": "string",
        "default": "ctrl+shift+d",
        "description": "Keyboard shortcut to activate recording"
    },
    "voicecode.activation.minDuration": {
        "type": "number",
        "default": 200,
        "description": "Minimum recording duration in milliseconds"
    },
    "voicecode.activation.silenceThreshold": {
        "type": "number",
        "default": 1500,
        "description": "VAD mode: milliseconds of silence before auto-stop"
    },
    "voicecode.activation.showIndicator": {
        "type": "boolean",
        "default": true,
        "description": "Show visual indicator during recording"
    },
    "voicecode.activation.playSounds": {
        "type": "boolean",
        "default": true,
        "description": "Play sounds on recording start/stop"
    }
}
```

### Integration with Audio Pipeline

```typescript
class DictationController {
    private modeRegistry: ActivationModeRegistry;
    private audioCapture: AudioCapture;
    private wsClient: WebSocketClient;
    private textManager: InterimTextManager;

    constructor(
        config: ActivationConfig,
        audioCapture: AudioCapture,
        wsClient: WebSocketClient,
        textManager: InterimTextManager
    ) {
        this.audioCapture = audioCapture;
        this.wsClient = wsClient;
        this.textManager = textManager;

        // Set up mode registry with callbacks
        this.modeRegistry = new ActivationModeRegistry();
        this.modeRegistry.setCallbacks({
            onRecordingStart: () => this.startRecording(),
            onRecordingStop: () => this.stopRecording(),
            onRecordingCancel: () => this.cancelRecording(),
            onError: (error) => this.handleError(error)
        });

        // Activate configured mode
        this.modeRegistry.switchMode(config.mode);
    }

    private async startRecording(): Promise<void> {
        // Update UI
        this.showRecordingIndicator();

        // Start audio capture
        await this.audioCapture.start();

        // Open WebSocket connection
        await this.wsClient.connect();

        // Stream audio chunks
        this.audioCapture.onData((chunk) => {
            this.wsClient.sendAudio(chunk);
        });
    }

    private async stopRecording(): Promise<void> {
        // Stop audio capture
        await this.audioCapture.stop();

        // Signal end of audio to server
        this.wsClient.sendStop();

        // Update UI
        this.showProcessingIndicator();
    }

    private async cancelRecording(): Promise<void> {
        // Stop audio capture
        await this.audioCapture.stop();

        // Close WebSocket without processing
        this.wsClient.close();

        // Clean up any interim text
        await this.textManager.cancel(vscode.window.activeTextEditor!);

        // Update UI
        this.hideIndicator();
    }

    private handleError(error: Error): void {
        vscode.window.showErrorMessage(`Dictation error: ${error.message}`);
        this.cancelRecording();
    }

    /**
     * Switch activation mode at runtime.
     */
    setMode(mode: string): void {
        this.modeRegistry.switchMode(mode);
        vscode.commands.executeCommand(
            'setContext',
            'voicecode.mode',
            mode
        );
    }
}
```

## Consequences

### Positive
- **Intuitive default**: Push-to-talk is familiar to most users
- **Flexible architecture**: Easy to add new modes without changing core logic
- **User choice**: Different modes suit different workflows
- **Accident prevention**: Minimum duration prevents accidental activations

### Negative
- **VS Code keybinding limitations**: Key up detection requires workarounds
- **Mode complexity**: Users must understand mode differences
- **Testing burden**: Each mode needs thorough testing

### VS Code Keybinding Workaround

VS Code doesn't natively support key-up events. Options:

1. **WebView bridge**: Handle key events in WebView, forward to extension
2. **Keyboard monitoring**: Use native module (platform-specific)
3. **Timer-based**: Treat long press differently than short press

For MVP, use WebView bridge since we already have a WebView for audio capture:

```typescript
// WebView script
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'd') {
        vscode.postMessage({ type: 'keydown', key: 'activation' });
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'd') {
        vscode.postMessage({ type: 'keyup', key: 'activation' });
    }
});
```

## Related ADRs
- ADR-003: Audio Capture (WebView handles key events)
- ADR-007: Text Insertion (InterimTextManager for cancellation)
- ADR-013: Extension UI/UX (recording indicators)
