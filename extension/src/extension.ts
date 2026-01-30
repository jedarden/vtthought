import * as vscode from 'vscode';
import { VoiceInputViewProvider } from './voiceInputViewProvider';
import { AudioStreamer } from './audioStreamer';
import { DictationHandler } from './textInsertion';

/**
 * VTThought Extension State
 */
interface VTThoughtState {
    isRecording: boolean;
    isConnected: boolean;
    backendUrl: string;
}

/**
 * VTThought Extension Main Class
 */
export class VTThoughtExtension {
    private readonly context: vscode.ExtensionContext;
    private readonly outputChannel: vscode.OutputChannel;

    // Status Bar Items
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly connectionStatusBarItem: vscode.StatusBarItem;

    // State
    private state: VTThoughtState;

    // WebView Provider for audio capture
    private readonly voiceInputViewProvider: VoiceInputViewProvider;

    // Audio Streamer for WebSocket communication
    private audioStreamer: AudioStreamer | null = null;

    // Dictation handler for text insertion
    private dictationHandler: DictationHandler | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('VTThought');

        // Initialize state from configuration
        const config = vscode.workspace.getConfiguration('vtthought');
        this.state = {
            isRecording: false,
            isConnected: false,
            backendUrl: config.get('backendUrl', 'ws://localhost:8000/ws/audio')
        };

        // Create status bar items
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.name = 'VTThought Recording Status';
        this.statusBarItem.command = 'vtthought.toggleRecording';

        this.connectionStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99
        );
        this.connectionStatusBarItem.name = 'VTThought Connection Status';
        this.connectionStatusBarItem.command = 'vtthought.connectBackend';

        // Create WebView provider for audio capture
        this.voiceInputViewProvider = new VoiceInputViewProvider(context.extensionUri);

        // Register audio data callback
        this.voiceInputViewProvider.onAudioData((data, sampleRate) => {
            this.handleAudioData(data, sampleRate);
        });

        // Register error callback
        this.voiceInputViewProvider.onError((error) => {
            this.log(`Audio capture error: ${error}`);
            vscode.window.showErrorMessage(`VTThought: ${error}`);
            this.state.isRecording = false;
            this.updateStatusDisplay();
        });

        this.updateStatusDisplay();

        // Create dictation handler
        this.dictationHandler = new DictationHandler();
        this.context.subscriptions.push({
            dispose: () => this.dictationHandler?.dispose()
        });
    }

    /**
     * Activate the extension
     */
    public activate(): void {
        this.log('VTThought Extension Activated');

        // Register WebView provider
        this.context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                VoiceInputViewProvider.viewType,
                this.voiceInputViewProvider
            )
        );

        // Register commands
        this.registerCommands();

        // Show status bar items
        this.statusBarItem.show();
        this.connectionStatusBarItem.show();

        // Auto-connect if enabled
        const config = vscode.workspace.getConfiguration('vtthought');
        if (config.get('autoConnect', true)) {
            this.connectBackend().catch(err => {
                this.log(`Auto-connect failed: ${err}`);
            });
        }

        // Watch for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('vtthought')) {
                this.handleConfigurationChange();
            }
        });
    }

    /**
     * Deactivate the extension
     */
    public deactivate(): void {
        // Stop recording if active
        if (this.state.isRecording) {
            this.stopRecording();
        }

        // Disconnect WebSocket
        this.disconnect();

        // Dispose resources
        this.statusBarItem.dispose();
        this.connectionStatusBarItem.dispose();
        this.outputChannel.dispose();
    }

    /**
     * Register all extension commands
     */
    private registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('vtthought.toggleRecording', () => {
                this.toggleRecording();
            }),
            vscode.commands.registerCommand('vtthought.openSettings', () => {
                vscode.commands.executeCommand('workbench.action.openSettings', 'vtthought');
            }),
            vscode.commands.registerCommand('vtthought.connectBackend', () => {
                this.connectBackend();
            }),
            vscode.commands.registerCommand('vtthought.disconnectBackend', () => {
                this.disconnect();
            })
        );

        this.log('Commands registered');
    }

    /**
     * Toggle recording state
     */
    private toggleRecording(): void {
        if (!this.state.isConnected) {
            vscode.window.showWarningMessage(
                'VTThought is not connected to the backend. Connect first.'
            );
            return;
        }

        this.state.isRecording = !this.state.isRecording;
        this.updateStatusDisplay();

        if (this.state.isRecording) {
            this.startRecording();
        } else {
            this.stopRecording();
        }
    }

    /**
     * Start recording
     */
    private startRecording(): void {
        this.log('Starting recording...');

        // Send start signal to backend
        if (this.audioStreamer?.isConnected) {
            this.audioStreamer.startRecording();
        }

        // Start audio capture in WebView
        this.voiceInputViewProvider.startRecording();

        vscode.window.showInformationMessage('VTThought: Recording started');
    }

    /**
     * Stop recording
     */
    private stopRecording(): void {
        this.log('Stopping recording...');

        // Stop audio capture in WebView
        this.voiceInputViewProvider.stopRecording();

        // Send stop signal to backend
        if (this.audioStreamer?.isConnected) {
            this.audioStreamer.stopRecording();
        }

        vscode.window.showInformationMessage('VTThought: Recording stopped');
    }

    /**
     * Handle audio data from WebView
     */
    private handleAudioData(data: Float32Array, sampleRate: number): void {
        // Stream audio to backend via WebSocket
        if (this.audioStreamer?.isConnected) {
            try {
                this.audioStreamer.sendAudio(data);
            } catch (error) {
                this.log(`Failed to send audio data: ${error}`);
            }
        }
    }

    /**
     * Connect to backend WebSocket
     */
    private async connectBackend(): Promise<void> {
        const config = vscode.workspace.getConfiguration('vtthought');
        const apiUrl = config.get('apiUrl', 'http://localhost:8000');
        const wsUrl = config.get('backendUrl', 'ws://localhost:8000/ws/audio');

        this.log(`Connecting to backend: ${apiUrl}`);

        try {
            // First, verify backend is reachable via health check
            const response = await fetch(`${apiUrl}/api/health`);

            if (!response.ok) {
                throw new Error(`Health check failed: ${response.status}`);
            }

            // Establish WebSocket connection
            this.audioStreamer = new AudioStreamer(wsUrl, { sampleRate: 16000, channels: 1 }, {
                onConnected: () => {
                    this.state.isConnected = true;
                    this.updateStatusDisplay();
                    this.log('WebSocket connected successfully');
                },
                onDisconnected: () => {
                    this.state.isConnected = false;
                    this.state.isRecording = false;
                    this.updateStatusDisplay();
                    this.log('WebSocket disconnected');
                },
                onError: (error) => {
                    this.log(`WebSocket error: ${error.message}`);
                    vscode.window.showErrorMessage(`VTThought: WebSocket error - ${error.message}`);
                },
                onMessage: async (message) => {
                    // Handle server messages (interim, streaming, final, error)
                    if (this.dictationHandler) {
                        await this.dictationHandler.handleMessage(message);
                    }
                }
            });

            await this.audioStreamer.connect();

            this.log('Connected to backend successfully');
            vscode.window.showInformationMessage('VTThought: Connected to backend');

        } catch (error) {
            this.log(`Connection failed: ${error}`);
            vscode.window.showErrorMessage(
                `VTThought: Failed to connect to backend at ${apiUrl}. Ensure the backend is running.`
            );
            this.state.isConnected = false;
            this.updateStatusDisplay();
        }
    }

    /**
     * Disconnect from backend
     */
    private disconnect(): void {
        // Stop recording if active
        if (this.state.isRecording) {
            this.stopRecording();
        }

        // Close WebSocket connection
        if (this.audioStreamer) {
            this.audioStreamer.close();
            this.audioStreamer = null;
        }

        this.state.isConnected = false;
        this.state.isRecording = false;
        this.updateStatusDisplay();

        this.log('Disconnected from backend');
        vscode.window.showInformationMessage('VTThought: Disconnected from backend');
    }

    /**
     * Update status bar display
     */
    private updateStatusDisplay(): void {
        // Recording status
        if (this.state.isRecording) {
            this.statusBarItem.text = '$record VTThought: Recording';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.statusBarItem.tooltip = 'Click to stop recording';
        } else {
            this.statusBarItem.text = '$circle-large-outline VTThought: Idle';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = 'Click to start recording (Ctrl+Alt+V)';
        }

        // Connection status
        if (this.state.isConnected) {
            this.connectionStatusBarItem.text = '$radio-tower VTThought: Connected';
            this.connectionStatusBarItem.tooltip = 'Connected to backend';
            this.connectionStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        } else {
            this.connectionStatusBarItem.text = '$circle-large-outline VTThought: Disconnected';
            this.connectionStatusBarItem.tooltip = 'Click to connect to backend';
            this.connectionStatusBarItem.backgroundColor = undefined;
        }
    }

    /**
     * Handle configuration changes
     */
    private handleConfigurationChange(): void {
        const config = vscode.workspace.getConfiguration('vtthought');
        this.state.backendUrl = config.get('backendUrl', 'ws://localhost:8000/ws/audio');

        this.log('Configuration changed - reconnecting...');
        if (this.state.isConnected) {
            this.disconnect();
            this.connectBackend().catch(err => {
                this.log(`Reconnect failed: ${err}`);
            });
        }
    }

    /**
     * Log message to output channel
     */
    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }
}

/**
 * Extension entry point
 */
export function activate(context: vscode.ExtensionContext): void {
    const extension = new VTThoughtExtension(context);
    extension.activate();

    // Store extension instance for deactivation
    context.subscriptions.push({
        dispose: () => extension.deactivate()
    });
}

export function deactivate(): void {
    // Cleanup handled by extension dispose
}
