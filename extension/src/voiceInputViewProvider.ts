import * as vscode from 'vscode';

/**
 * Message types between extension and WebView
 */
interface AudioDataMessage {
    type: 'audio';
    data: number[]; // Float32Array serialized as array
    sampleRate: number;
}

interface ReadyMessage {
    type: 'ready';
}

interface ErrorMessage {
    type: 'error';
    message: string;
}

interface CommandMessage {
    type: 'command';
    command: string;
}

type WebViewMessage = AudioDataMessage | ReadyMessage | ErrorMessage | CommandMessage;

/**
 * Audio capture WebView provider
 * Implements audio capture using Web Audio API in a WebView
 * Per ADR-003: Uses Web Audio API for cross-platform audio capture
 */
export class VoiceInputViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'vtthought.voiceInputView';

    private _view?: vscode.WebviewView;

    // Callbacks for audio data events
    private onAudioDataCallbacks: ((data: Float32Array, sampleRate: number) => void)[] = [];
    private onErrorCallbacks: ((error: string) => void)[] = [];
    private onCommandCallbacks: ((command: string) => void)[] = [];

    constructor(private readonly _extensionUri: vscode.Uri) {}

    /**
     * Register callback for audio data
     */
    public onAudioData(callback: (data: Float32Array, sampleRate: number) => void): void {
        this.onAudioDataCallbacks.push(callback);
    }

    /**
     * Register callback for errors
     */
    public onError(callback: (error: string) => void): void {
        this.onErrorCallbacks.push(callback);
    }

    /**
     * Register callback for commands from webview
     */
    public onCommand(callback: (command: string) => void): void {
        this.onCommandCallbacks.push(callback);
    }

    /**
     * Resolve the WebView view
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from WebView
        webviewView.webview.onDidReceiveMessage(
            (message: WebViewMessage) => {
                switch (message.type) {
                    case 'audio':
                        // Convert array back to Float32Array
                        const audioData = new Float32Array(message.data);
                        this.onAudioDataCallbacks.forEach(cb => cb(audioData, message.sampleRate));
                        break;
                    case 'ready':
                        // WebView is ready to accept commands
                        break;
                    case 'error':
                        this.onErrorCallbacks.forEach(cb => cb(message.message));
                        break;
                    case 'command':
                        this.onCommandCallbacks.forEach(cb => cb(message.command));
                        break;
                }
            },
            undefined,
            undefined
        );
    }

    /**
     * Send start recording command to WebView
     */
    public startRecording(): void {
        if (this._view) {
            this._view.webview.postMessage({ command: 'start' });
        }
    }

    /**
     * Send stop recording command to WebView
     */
    public stopRecording(): void {
        if (this._view) {
            this._view.webview.postMessage({ command: 'stop' });
        }
    }

    /**
     * Get the WebView HTML
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline';">
    <title>VTThought Voice Input</title>
    <style>
        body {
            padding: 10px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .container {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .status {
            padding: 8px;
            border-radius: 4px;
            font-size: 12px;
        }
        .status.idle {
            background-color: var(--vscode-editorInfo-background);
            color: var(--vscode-editorInfo-foreground);
        }
        .status.recording {
            background-color: var(--vscode-errorBackground);
            color: var(--vscode-errorForeground);
            animation: pulse 1.5s infinite;
        }
        .status.error {
            background-color: var(--vscode-editorWarningBackground);
            color: var(--vscode-editorWarning-foreground);
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        .level-meter {
            height: 8px;
            background-color: var(--vscode-progressBar-background);
            border-radius: 4px;
            overflow: hidden;
        }
        .level-meter-fill {
            height: 100%;
            background-color: var(--vscode-progressBar-foreground);
            width: 0%;
            transition: width 0.05s ease-out;
        }
        .info {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .actions {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid var(--vscode-widget-border);
        }
        .action-btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: pointer;
            font-size: 12px;
            text-align: left;
        }
        .action-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .action-btn.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .action-btn.primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="container">
        <div id="status" class="status idle">
            Ready - Press Ctrl+Alt+V to record
        </div>
        <div class="level-meter">
            <div id="levelMeter" class="level-meter-fill"></div>
        </div>
        <div class="info">
            Sample Rate: <span id="sampleRate">-</span> Hz<br>
            Chunk Size: <span id="chunkSize">-</span> samples
        </div>
    </div>

    <script>
        (function() {
            const vscode = acquireVsCodeApi();

            // Audio context and nodes
            let audioContext: AudioContext | null = null;
            let mediaStream: MediaStream | null = null;
            let source: MediaStreamAudioSourceNode | null = null;
            let processorNode: AudioWorkletNode | null = null;
            let scriptProcessor: ScriptProcessorNode | null = null;

            // Configuration
            const TARGET_SAMPLE_RATE = 16000; // Whisper optimal
            const BUFFER_SIZE = 4096; // ~256ms at 16kHz

            // DOM elements
            const statusEl = document.getElementById('status');
            const levelMeterEl = document.getElementById('levelMeter');
            const sampleRateEl = document.getElementById('sampleRate');
            const chunkSizeEl = document.getElementById('chunkSize');

            // Update status display
            function setStatus(state: string, message: string) {
                statusEl.className = 'status ' + state;
                statusEl.textContent = message;
            }

            // Update level meter
            function updateLevelMeter(rms: number) {
                // Convert RMS to percentage (0-100)
                // Typical speech RMS is around 0.01-0.1
                const level = Math.min(100, Math.max(0, rms * 1000));
                levelMeterEl.style.width = level + '%';
            }

            // Calculate RMS of audio samples
            function calculateRMS(samples: Float32Array): number {
                let sum = 0;
                for (let i = 0; i < samples.length; i++) {
                    sum += samples[i] * samples[i];
                }
                return Math.sqrt(sum / samples.length);
            }

            // Send audio data to extension
            function sendAudioData(samples: Float32Array) {
                // Update level meter
                const rms = calculateRMS(samples);
                updateLevelMeter(rms);

                // Send to extension
                vscode.postMessage({
                    type: 'audio',
                    data: Array.from(samples),
                    sampleRate: TARGET_SAMPLE_RATE
                });
            }

            // AudioWorklet processor code (inline version)
            const workletCode = \`
                class AudioProcessor extends AudioWorkletProcessor {
                    constructor() {
                        super();
                        this.buffer = [];
                        this.bufferSize = \${BUFFER_SIZE};
                    }

                    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
                        const input = inputs[0];
                        if (input.length > 0) {
                            const samples = input[0];
                            // Convert stereo to mono if needed
                            for (let i = 0; i < samples.length; i++) {
                                this.buffer.push(samples[i]);
                            }

                            if (this.buffer.length >= this.bufferSize) {
                                const chunk = new Float32Array(this.buffer.splice(0, this.bufferSize));
                                this.port.postMessage(chunk);
                            }
                        }
                        return true;
                    }
                }

                registerProcessor('audio-processor', AudioProcessor);
            \`;

            // Start audio capture
            async function startCapture() {
                try {
                    setStatus('idle', 'Requesting microphone access...');

                    // Get user media with optimal constraints
                    mediaStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: TARGET_SAMPLE_RATE,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        }
                    });

                    // Create audio context
                    audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });

                    // Update info display
                    sampleRateEl.textContent = audioContext.sampleRate.toString();
                    chunkSizeEl.textContent = BUFFER_SIZE.toString();

                    // Create source
                    source = audioContext.createMediaStreamSource(mediaStream);

                    // Try to use AudioWorklet (preferred)
                    try {
                        const blob = new Blob([workletCode], { type: 'application/javascript' });
                        const workletUrl = URL.createObjectURL(blob);
                        await audioContext.audioWorklet.addModule(workletUrl);
                        URL.revokeObjectURL(workletUrl);

                        processorNode = new AudioWorkletNode(audioContext, 'audio-processor');
                        processorNode.port.onmessage = (e: MessageEvent) => {
                            sendAudioData(e.data as Float32Array);
                        };

                        source.connect(processorNode);
                        setStatus('recording', 'Recording... (Release key to stop)');
                    } catch (workletError) {
                        // Fallback to ScriptProcessorNode
                        console.warn('AudioWorklet failed, using ScriptProcessorNode fallback:', workletError);

                        let buffer: number[] = [];

                        scriptProcessor = audioContext.createScriptProcessor(
                            BUFFER_SIZE,
                            1,
                            1
                        );

                        scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
                            const samples = e.inputBuffer.getChannelData(0);
                            sendAudioData(new Float32Array(samples));
                        };

                        source.connect(scriptProcessor);
                        scriptProcessor.connect(audioContext.destination);
                        setStatus('recording', 'Recording... (Release key to stop)');
                    }

                    vscode.postMessage({ type: 'ready' });

                } catch (error) {
                    console.error('Failed to start audio capture:', error);
                    let errorMsg = 'Failed to start recording';
                    if (error instanceof Error) {
                        if (error.name === 'NotAllowedError') {
                            errorMsg = 'Microphone permission denied. Please allow microphone access in your browser settings.';
                        } else if (error.name === 'NotFoundError') {
                            errorMsg = 'No microphone found. Please connect a microphone.';
                        } else {
                            errorMsg = error.message;
                        }
                    }
                    setStatus('error', errorMsg);
                    vscode.postMessage({ type: 'error', message: errorMsg });
                }
            }

            // Stop audio capture
            function stopCapture() {
                setStatus('idle', 'Stopping...');

                // Disconnect and cleanup
                if (processorNode) {
                    processorNode.disconnect();
                    processorNode = null;
                }

                if (scriptProcessor) {
                    scriptProcessor.disconnect();
                    scriptProcessor = null;
                }

                if (source) {
                    source.disconnect();
                    source = null;
                }

                if (mediaStream) {
                    mediaStream.getTracks().forEach(track => track.stop());
                    mediaStream = null;
                }

                if (audioContext) {
                    audioContext.close();
                    audioContext = null;
                }

                levelMeterEl.style.width = '0%';
                setStatus('idle', 'Ready - Press Ctrl+Alt+V to record');
            }

            // Listen for messages from extension
            window.addEventListener('message', (event: MessageEvent) => {
                const command = event.data.command;
                if (command === 'start') {
                    startCapture();
                } else if (command === 'stop') {
                    stopCapture();
                }
            });

            // Auto-start on load if extension signals it
            vscode.postMessage({ type: 'ready' });
        })();
    </script>
</body>
</html>`;
    }
}
