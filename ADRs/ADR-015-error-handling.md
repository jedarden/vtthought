# ADR-015: Error Handling & Recovery

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

Network failures, backend issues, and device problems will occur. Graceful error handling is critical for user trust. Users need to know what went wrong, whether their audio was lost, and what to do next.

## Decision Drivers

- **Transparency**: Users understand what happened
- **Recovery**: Automatic recovery when possible
- **No data loss**: Minimize lost recordings
- **Non-blocking**: Errors shouldn't freeze the UI

## Error Categories

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ERROR CATEGORIES                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CONNECTION ERRORS                                                           │
│  ├─ WebSocket fails to connect                                              │
│  ├─ WebSocket disconnects mid-recording                                     │
│  ├─ Backend unreachable (DNS, network)                                      │
│  └─ TLS/certificate errors                                                  │
│                                                                              │
│  BACKEND ERRORS                                                              │
│  ├─ Timeout (Whisper slow, LLM slow)                                        │
│  ├─ Server error (500, OOM, GPU busy)                                       │
│  ├─ Rate limited (429)                                                      │
│  └─ Malformed response                                                      │
│                                                                              │
│  AUTHENTICATION ERRORS                                                       │
│  ├─ Token expired                                                           │
│  ├─ Token revoked/invalid                                                   │
│  └─ OAuth flow failed                                                       │
│                                                                              │
│  DEVICE ERRORS                                                               │
│  ├─ Microphone not found                                                    │
│  ├─ Microphone permission denied                                            │
│  ├─ Audio device disconnected                                               │
│  └─ Audio capture failed                                                    │
│                                                                              │
│  CLIENT ERRORS                                                               │
│  ├─ WebView crashed                                                         │
│  ├─ Extension host restarted                                                │
│  └─ Memory pressure                                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Decision

Implement **layered error handling** with automatic recovery, clear user feedback, and graceful degradation.

## Error Handling Strategy

### 1. Connection Errors

```typescript
interface ConnectionState {
    status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
    lastError: Error | null;
    reconnectAttempts: number;
}

class WebSocketManager {
    private ws: WebSocket | null = null;
    private state: ConnectionState = {
        status: 'disconnected',
        lastError: null,
        reconnectAttempts: 0
    };

    // Reconnection config
    private readonly maxReconnectAttempts = 5;
    private readonly baseDelay = 1000;  // 1 second
    private readonly maxDelay = 30000;  // 30 seconds

    async connect(url: string, token: string): Promise<void> {
        this.state.status = 'connecting';

        try {
            this.ws = new WebSocket(`${url}?token=${token}`);

            this.ws.onopen = () => {
                this.state.status = 'connected';
                this.state.reconnectAttempts = 0;
                this.state.lastError = null;
            };

            this.ws.onclose = (event) => {
                if (event.code !== 1000) {  // Abnormal close
                    this.handleDisconnect(new Error(`WebSocket closed: ${event.reason}`));
                }
            };

            this.ws.onerror = (error) => {
                this.handleDisconnect(error);
            };

        } catch (error) {
            this.handleDisconnect(error);
        }
    }

    private async handleDisconnect(error: Error): Promise<void> {
        this.state.status = 'disconnected';
        this.state.lastError = error;

        // Notify UI
        this.emit('disconnected', error);

        // Attempt reconnection with exponential backoff
        if (this.state.reconnectAttempts < this.maxReconnectAttempts) {
            await this.attemptReconnect();
        } else {
            this.emit('reconnectFailed', error);
        }
    }

    private async attemptReconnect(): Promise<void> {
        this.state.status = 'reconnecting';
        this.state.reconnectAttempts++;

        // Exponential backoff with jitter
        const delay = Math.min(
            this.baseDelay * Math.pow(2, this.state.reconnectAttempts - 1),
            this.maxDelay
        );
        const jitter = delay * 0.2 * Math.random();

        await sleep(delay + jitter);

        try {
            await this.connect(this.url, this.token);
        } catch (error) {
            // Will trigger handleDisconnect again
        }
    }
}
```

### 2. Recording Recovery

```typescript
class RecordingSession {
    private audioBuffer: ArrayBuffer[] = [];
    private isSent = false;

    /**
     * Buffer audio locally in case of connection issues.
     */
    addChunk(chunk: ArrayBuffer): void {
        this.audioBuffer.push(chunk);

        // Also try to send immediately
        if (this.ws.isConnected()) {
            this.ws.send(chunk);
        }
    }

    /**
     * If connection was lost, we have the audio buffered.
     * Can retry sending when reconnected.
     */
    async retryWithBuffer(): Promise<void> {
        if (this.isSent || this.audioBuffer.length === 0) {
            return;
        }

        // Combine all chunks
        const fullAudio = this.combineChunks(this.audioBuffer);

        // Send as single payload after reconnection
        await this.ws.send(fullAudio);
        this.isSent = true;
    }

    /**
     * Clear buffer after successful processing.
     */
    clear(): void {
        this.audioBuffer = [];
        this.isSent = false;
    }
}
```

### 3. Backend Errors

```typescript
interface BackendError {
    code: string;
    message: string;
    retryable: boolean;
    retryAfter?: number;  // seconds
}

class BackendErrorHandler {
    handleError(error: BackendError, ui: StatusBarUI): void {
        switch (error.code) {
            case 'TIMEOUT':
                this.handleTimeout(error, ui);
                break;

            case 'RATE_LIMITED':
                this.handleRateLimit(error, ui);
                break;

            case 'SERVER_ERROR':
                this.handleServerError(error, ui);
                break;

            case 'TRANSCRIPTION_FAILED':
                this.handleTranscriptionError(error, ui);
                break;

            default:
                this.handleUnknownError(error, ui);
        }
    }

    private handleTimeout(error: BackendError, ui: StatusBarUI): void {
        ui.setError('Processing took too long');

        vscode.window.showWarningMessage(
            'Transcription timed out. The server may be busy.',
            'Retry',
            'Cancel'
        ).then(action => {
            if (action === 'Retry') {
                vscode.commands.executeCommand('voicecode.retryLast');
            }
        });
    }

    private handleRateLimit(error: BackendError, ui: StatusBarUI): void {
        const waitTime = error.retryAfter || 60;

        ui.setError(`Rate limited (${waitTime}s)`);

        vscode.window.showWarningMessage(
            `Too many requests. Please wait ${waitTime} seconds.`
        );

        // Auto-recover after wait time
        setTimeout(() => {
            ui.setIdle();
        }, waitTime * 1000);
    }

    private handleServerError(error: BackendError, ui: StatusBarUI): void {
        ui.setError('Server error');

        vscode.window.showErrorMessage(
            'The server encountered an error. Please try again.',
            'Retry',
            'View Logs'
        ).then(action => {
            if (action === 'Retry') {
                vscode.commands.executeCommand('voicecode.retryLast');
            } else if (action === 'View Logs') {
                vscode.commands.executeCommand('voicecode.showOutput');
            }
        });
    }

    private handleTranscriptionError(error: BackendError, ui: StatusBarUI): void {
        ui.setError('Transcription failed');

        vscode.window.showErrorMessage(
            'Could not transcribe audio. Recording may be too short or unclear.',
            'Try Again'
        );
    }

    private handleUnknownError(error: BackendError, ui: StatusBarUI): void {
        ui.setError('Unknown error');

        // Log for debugging
        console.error('Unknown backend error:', error);

        vscode.window.showErrorMessage(
            `Error: ${error.message}`,
            'View Logs'
        ).then(action => {
            if (action === 'View Logs') {
                vscode.commands.executeCommand('voicecode.showOutput');
            }
        });
    }
}
```

### 4. Authentication Errors

```typescript
class AuthErrorHandler {
    async handleAuthError(error: AuthError, ui: StatusBarUI): Promise<void> {
        switch (error.code) {
            case 'TOKEN_EXPIRED':
                // Try silent refresh
                const refreshed = await this.tryRefreshToken();
                if (refreshed) {
                    // Retry the failed operation
                    return;
                }
                // Fall through to re-auth

            case 'TOKEN_INVALID':
            case 'TOKEN_REVOKED':
                ui.setDisconnected();

                const action = await vscode.window.showWarningMessage(
                    'Your session has expired. Please sign in again.',
                    'Sign In',
                    'Later'
                );

                if (action === 'Sign In') {
                    vscode.commands.executeCommand('voicecode.signIn');
                }
                break;

            case 'OAUTH_FAILED':
                vscode.window.showErrorMessage(
                    'Sign in failed. Please try again.',
                    'Retry'
                ).then(action => {
                    if (action === 'Retry') {
                        vscode.commands.executeCommand('voicecode.signIn');
                    }
                });
                break;
        }
    }

    private async tryRefreshToken(): Promise<boolean> {
        try {
            const newToken = await this.authService.refreshToken();
            await this.storeToken(newToken);
            return true;
        } catch {
            return false;
        }
    }
}
```

### 5. Device Errors

```typescript
class DeviceErrorHandler {
    handleDeviceError(error: DeviceError, ui: StatusBarUI): void {
        switch (error.code) {
            case 'NO_MICROPHONE':
                ui.setError('No microphone');
                vscode.window.showErrorMessage(
                    'No microphone found. Please connect a microphone and try again.',
                    'Check Settings'
                ).then(action => {
                    if (action === 'Check Settings') {
                        vscode.commands.executeCommand('voicecode.testMicrophone');
                    }
                });
                break;

            case 'PERMISSION_DENIED':
                ui.setError('Mic permission denied');
                vscode.window.showErrorMessage(
                    'Microphone access denied. Please grant permission in your browser/system settings.',
                    'How to Fix'
                ).then(action => {
                    if (action === 'How to Fix') {
                        vscode.env.openExternal(
                            vscode.Uri.parse('https://docs.voicecode.dev/permissions')
                        );
                    }
                });
                break;

            case 'DEVICE_DISCONNECTED':
                ui.setError('Microphone disconnected');

                // Cancel current recording
                vscode.commands.executeCommand('voicecode.cancel');

                vscode.window.showWarningMessage(
                    'Microphone was disconnected during recording.',
                    'Select Device'
                ).then(action => {
                    if (action === 'Select Device') {
                        vscode.commands.executeCommand('voicecode.selectMicrophone');
                    }
                });
                break;

            case 'CAPTURE_FAILED':
                ui.setError('Audio capture failed');
                vscode.window.showErrorMessage(
                    'Failed to capture audio. Please check your microphone.',
                    'Test Microphone'
                ).then(action => {
                    if (action === 'Test Microphone') {
                        vscode.commands.executeCommand('voicecode.testMicrophone');
                    }
                });
                break;
        }
    }
}
```

## Circuit Breaker Pattern

Prevent cascading failures when backend is unhealthy:

```typescript
enum CircuitState {
    CLOSED,      // Normal operation
    OPEN,        // Failing, reject requests
    HALF_OPEN    // Testing if recovered
}

class CircuitBreaker {
    private state = CircuitState.CLOSED;
    private failures = 0;
    private lastFailure: number = 0;
    private successesInHalfOpen = 0;

    // Configuration
    private readonly failureThreshold = 5;
    private readonly resetTimeout = 30000;  // 30 seconds
    private readonly successThreshold = 2;

    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (this.state === CircuitState.OPEN) {
            if (Date.now() - this.lastFailure > this.resetTimeout) {
                this.state = CircuitState.HALF_OPEN;
            } else {
                throw new CircuitOpenError('Service temporarily unavailable');
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        if (this.state === CircuitState.HALF_OPEN) {
            this.successesInHalfOpen++;
            if (this.successesInHalfOpen >= this.successThreshold) {
                this.state = CircuitState.CLOSED;
                this.failures = 0;
                this.successesInHalfOpen = 0;
            }
        } else {
            this.failures = 0;
        }
    }

    private onFailure(): void {
        this.failures++;
        this.lastFailure = Date.now();

        if (this.state === CircuitState.HALF_OPEN) {
            this.state = CircuitState.OPEN;
            this.successesInHalfOpen = 0;
        } else if (this.failures >= this.failureThreshold) {
            this.state = CircuitState.OPEN;
        }
    }

    getState(): CircuitState {
        return this.state;
    }
}
```

## User Feedback Matrix

| Error | Status Bar | Notification | Action |
|-------|------------|--------------|--------|
| Connection lost | `$(error) Voice` (red) | "Connection lost" | Retry button |
| Reconnecting | `$(sync~spin)` | None | Auto |
| Reconnected | `$(mic) Voice` | "Reconnected" (brief) | None |
| Timeout | `$(error) Voice` | "Processing timed out" | Retry button |
| Rate limited | `$(error) Voice` | "Rate limited (Xs)" | Wait |
| Server error | `$(error) Voice` | "Server error" | Retry, View Logs |
| Token expired | `$(mic-off) Voice` | "Session expired" | Sign In |
| No microphone | `$(error) Voice` | "No microphone found" | Check Settings |
| Permission denied | `$(error) Voice` | "Mic access denied" | How to Fix |

## Logging

```typescript
class ErrorLogger {
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Voice Code');
    }

    logError(category: string, error: Error, context?: object): void {
        const timestamp = new Date().toISOString();
        const contextStr = context ? JSON.stringify(context) : '';

        this.outputChannel.appendLine(
            `[${timestamp}] [ERROR] [${category}] ${error.message}`
        );

        if (error.stack) {
            this.outputChannel.appendLine(error.stack);
        }

        if (contextStr) {
            this.outputChannel.appendLine(`Context: ${contextStr}`);
        }

        this.outputChannel.appendLine('---');
    }

    show(): void {
        this.outputChannel.show();
    }
}
```

## Recovery State Machine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ERROR RECOVERY STATE MACHINE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                    ┌──────────┐                                             │
│                    │   IDLE   │◄─────────────────────────┐                  │
│                    └────┬─────┘                          │                  │
│                         │ start recording                │                  │
│                         ▼                                │                  │
│                    ┌──────────┐                          │                  │
│           ┌────────┤RECORDING ├────────┐                 │                  │
│           │        └────┬─────┘        │                 │                  │
│           │             │              │                 │                  │
│      connection      success      device error           │                  │
│         lost            │              │                 │                  │
│           │             ▼              ▼                 │                  │
│           │        ┌──────────┐   ┌──────────┐          │                  │
│           │        │PROCESSING│   │  ERROR   │──────────┘                  │
│           │        └────┬─────┘   └──────────┘           user dismisses    │
│           │             │                                                   │
│           │        ┌────┴────┐                                             │
│           │        │         │                                             │
│           │     success   timeout/error                                    │
│           │        │         │                                             │
│           │        ▼         ▼                                             │
│           │   ┌──────────┐ ┌──────────┐                                    │
│           │   │ COMPLETE │ │  ERROR   │                                    │
│           │   └────┬─────┘ └────┬─────┘                                    │
│           │        │            │                                          │
│           │        └─────┬──────┘                                          │
│           │              │                                                  │
│           │              ▼                                                  │
│           │         ┌──────────┐                                           │
│           └────────►│RECONNECT │                                           │
│                     └────┬─────┘                                           │
│                          │                                                  │
│                    ┌─────┴─────┐                                           │
│                    │           │                                           │
│                 success     max retries                                    │
│                    │           │                                           │
│                    ▼           ▼                                           │
│               ┌──────────┐ ┌──────────┐                                    │
│               │   IDLE   │ │  FAILED  │                                    │
│               └──────────┘ └────┬─────┘                                    │
│                                 │                                          │
│                            user clicks retry                               │
│                                 │                                          │
│                                 ▼                                          │
│                            ┌──────────┐                                    │
│                            │   IDLE   │                                    │
│                            └──────────┘                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Implementation Integration

```typescript
class DictationController {
    private wsManager: WebSocketManager;
    private circuitBreaker: CircuitBreaker;
    private errorLogger: ErrorLogger;
    private ui: StatusBarUI;

    async startRecording(): Promise<void> {
        // Check circuit breaker first
        if (this.circuitBreaker.getState() === CircuitState.OPEN) {
            this.ui.setError('Service unavailable');
            vscode.window.showWarningMessage(
                'Voice Code is temporarily unavailable. Please try again later.'
            );
            return;
        }

        try {
            // Ensure connected
            if (!this.wsManager.isConnected()) {
                await this.wsManager.connect(this.backendUrl, this.token);
            }

            this.ui.setRecording();
            await this.audioCapture.start();

        } catch (error) {
            this.errorLogger.logError('recording_start', error);

            if (error instanceof DeviceError) {
                this.deviceErrorHandler.handleDeviceError(error, this.ui);
            } else if (error instanceof ConnectionError) {
                this.ui.setError('Cannot connect');
                this.wsManager.attemptReconnect();
            }
        }
    }

    async stopRecording(): Promise<void> {
        this.ui.setProcessing();

        try {
            await this.circuitBreaker.execute(async () => {
                const result = await this.sendAudioAndWaitForResult();
                return result;
            });

            this.ui.setIdle();

        } catch (error) {
            this.errorLogger.logError('processing', error);

            if (error instanceof CircuitOpenError) {
                this.ui.setError('Service unavailable');
            } else if (error instanceof BackendError) {
                this.backendErrorHandler.handleError(error, this.ui);
            } else if (error instanceof AuthError) {
                await this.authErrorHandler.handleAuthError(error, this.ui);
            } else {
                this.ui.setError('Processing failed');
            }
        }
    }
}
```

## Consequences

### Positive
- **Resilient**: Automatic recovery from transient failures
- **Transparent**: Users understand what went wrong
- **Actionable**: Clear next steps for users
- **Protected**: Circuit breaker prevents cascade failures

### Negative
- **Complexity**: Multiple error handlers to maintain
- **Testing**: Many error paths to test
- **Buffering**: Memory overhead for audio buffering

### Tradeoffs
- Buffer audio locally (uses memory, but enables retry)
- Auto-reconnect (may seem slow, but recovers gracefully)
- Circuit breaker (may block valid requests, but protects system)

## Related ADRs
- ADR-004: Audio Streaming Protocol (WebSocket handling)
- ADR-010: Security Model (auth errors)
- ADR-013: Extension UI (error display)
