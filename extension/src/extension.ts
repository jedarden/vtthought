import * as vscode from 'vscode';
import { VoiceInputViewProvider } from './voiceInputViewProvider';
import { AudioStreamer } from './audioStreamer';
import { DictationHandler } from './textInsertion';
import { TokenManager, getAuthStatus } from './tokenManager';
import { SetupFlow } from './setupFlow';
import { CommandParser, normalizeCommand } from './voiceCommands';
import { runCommandParserTests, formatTestResults, createCommandTester } from './voiceCommands.test';
import { UserPreferencesManager, createEditDetector } from './userPreferences';
import { EditDetector } from './editDetection';
import {
    VersionChecker,
    FeatureDetector,
    handleCompatibilityError,
    logCompatibilityResult,
    type CompatibilityResult
} from './versionCheck';

/**
 * VTThought Extension State
 */
interface VTThoughtState {
    isRecording: boolean;
    isConnected: boolean;
    backendUrl: string;
    isAuthenticated: boolean;
    backendFeatures: string[];  // Available features from backend (ADR-024)
}

/**
 * VTThought Extension Resources
 */
interface VTThoughtResources {
    userPreferencesManager: UserPreferencesManager | null;
    editDetector: EditDetector | null;
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

    // Token Manager (ADR-002)
    private readonly tokenManager: TokenManager;

    // WebView Provider for audio capture
    private readonly voiceInputViewProvider: VoiceInputViewProvider;

    // Audio Streamer for WebSocket communication
    private audioStreamer: AudioStreamer | null = null;

    // Dictation handler for text insertion
    private dictationHandler: DictationHandler | null = null;

    // User preferences manager (ADR-011)
    private resources: VTThoughtResources = {
        userPreferencesManager: null,
        editDetector: null,
    };

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('VTThought');

        // Create token manager (ADR-002)
        this.tokenManager = TokenManager.create(context);

        // Initialize state from configuration
        const config = vscode.workspace.getConfiguration('vtthought');
        this.state = {
            isRecording: false,
            isConnected: false,
            backendUrl: config.get('backendUrl', 'http://localhost:8000'),
            isAuthenticated: false,
            backendFeatures: []  // Populated on successful connection (ADR-024)
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

        // Register command callback from webview buttons
        this.voiceInputViewProvider.onCommand((command) => {
            vscode.commands.executeCommand(command);
        });

        this.updateStatusDisplay();

        // Create dictation handler with context for first-run celebration
        this.dictationHandler = new DictationHandler(context);
        this.context.subscriptions.push({
            dispose: () => this.dictationHandler?.dispose()
        });

        // Create user preferences manager (ADR-011)
        this.resources.userPreferencesManager = UserPreferencesManager.create(
            context,
            () => this.tokenManager.getAuthHeader()
        );
        this.context.subscriptions.push(this.resources.userPreferencesManager);

        // Create edit detector for style learning (ADR-011)
        const editConfig = vscode.workspace.getConfiguration('vtthought');
        const editLearningEnabled = editConfig.get('enableEditLearning', true);
        const editLearningWindow = editConfig.get('editLearningWindowMs', 30000);

        if (editLearningEnabled) {
            this.resources.editDetector = createEditDetector(
                this.resources.userPreferencesManager,
                {
                    enabled: true,
                    learningWindowMs: editLearningWindow,
                    maxTrackLength: 500,
                }
            );
            if (this.resources.editDetector) {
                this.context.subscriptions.push(this.resources.editDetector);
                this.dictationHandler.setEditDetector(this.resources.editDetector);
            }
        }
    }

    /**
     * Activate the extension
     */
    public async activate(): Promise<void> {
        this.log('VTThought Extension Activated');

        // Check for first-run setup (ADR-017)
        const setupFlow = new SetupFlow(this.context, this.tokenManager);
        const isFirstRun = await setupFlow.isFirstRun();

        if (isFirstRun) {
            this.log('First run detected - starting setup flow...');
            // Show welcome after a short delay to let VS Code fully load
            setTimeout(() => {
                setupFlow.start().catch(err => {
                    this.log(`Setup flow failed: ${err}`);
                });
            }, 1000);
        } else {
            // Check authentication status (ADR-002)
            const authStatus = await getAuthStatus(this.tokenManager);
            this.state.isAuthenticated = authStatus.isConfigured;
            this.state.backendUrl = authStatus.backendUrl;

            if (!authStatus.isConfigured) {
                this.log('Authentication not configured. Run "VTThought: Setup Authentication" to configure.');
            }

            // Auto-connect if enabled and authenticated
            const config = vscode.workspace.getConfiguration('vtthought');
            if (authStatus.isConfigured && config.get('autoConnect', true)) {
                this.connectBackend().catch(err => {
                    this.log(`Auto-connect failed: ${err}`);
                });
            }
        }

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
            }),
            // Authentication commands (ADR-002)
            vscode.commands.registerCommand('vtthought.setupAuthentication', async () => {
                await this.setupAuthentication();
            }),
            vscode.commands.registerCommand('vtthought.clearAuthentication', async () => {
                await this.clearAuthentication();
            }),
            vscode.commands.registerCommand('vtthought.showAuthenticationStatus', async () => {
                await this.showAuthenticationStatus();
            }),
            // First-run setup commands (ADR-017)
            vscode.commands.registerCommand('vtthought.runSetup', async () => {
                await this.runSetup();
            }),
            vscode.commands.registerCommand('vtthought.resetSetup', async () => {
                await this.resetSetup();
            }),
            // Voice command utilities
            vscode.commands.registerCommand('vtthought.listCommands', async () => {
                await this.listVoiceCommands();
            }),
            vscode.commands.registerCommand('vtthought.testCommands', async () => {
                await this.testVoiceCommands();
            }),
            vscode.commands.registerCommand('vtthought.analyzeCommand', async () => {
                await this.analyzeVoiceCommand();
            }),
            // User preferences commands (ADR-011)
            vscode.commands.registerCommand('vtthought.manageVocabulary', async () => {
                await this.manageVocabulary();
            }),
            vscode.commands.registerCommand('vtthought.showStylePreferences', async () => {
                await this.showStylePreferences();
            }),
            vscode.commands.registerCommand('vtthought.editStylePreferences', async () => {
                await this.editStylePreferences();
            }),
            vscode.commands.registerCommand('vtthought.showLearnedCorrections', async () => {
                await this.showLearnedCorrections();
            }),
            vscode.commands.registerCommand('vtthought.manageUserPreferences', async () => {
                await this.manageUserPreferences();
            }),
            vscode.commands.registerCommand('vtthought.exportUserData', async () => {
                await this.exportUserData();
            }),
            vscode.commands.registerCommand('vtthought.deleteUserData', async () => {
                await this.deleteUserData();
            }),
            vscode.commands.registerCommand('vtthought.manageCustomVoiceCommands', async () => {
                await this.manageCustomVoiceCommands();
            })
        );

        this.log('Commands registered');
    }

    /**
     * Test voice command parser
     */
    private async testVoiceCommands(): Promise<void> {
        const parser = CommandParser.withSettings();
        const results = runCommandParserTests(parser);

        const output = formatTestResults(results);
        this.outputChannel.clear();
        this.outputChannel.append(output);
        this.outputChannel.show();

        const passed = results.filter(r => r.passed).length;
        const total = results.length;

        vscode.window.showInformationMessage(
            `Voice command tests: ${passed}/${total} passed`,
            'View Results'
        ).then(action => {
            if (action === 'View Results') {
                this.outputChannel.show();
            }
        });
    }

    /**
     * Analyze a transcription for voice commands
     */
    private async analyzeVoiceCommand(): Promise<void> {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter text to analyze for voice commands',
            placeHolder: 'create a function called hello enter'
        });

        if (!input) {
            return;
        }

        const parser = CommandParser.withSettings();
        const tester = createCommandTester(parser);
        const analysis = tester.analyze(input);

        // First apply homophone normalization
        const normalized = normalizeCommand(input);

        let output = `Voice Command Analysis\n\n`;
        output += `Original: "${input}"\n`;
        output += `Normalized: "${normalized}"\n`;
        output += `Cleaned text: "${analysis.cleaned}"\n`;
        output += `Commands found: ${analysis.commandsFound}\n`;

        if (analysis.commands.length > 0) {
            output += '\nCommands:\n';
            for (const cmd of analysis.commands) {
                output += `  • ${cmd.action}`;
                if (cmd.isTerminal) output += ' (terminal)';
                if (cmd.params) output += ` ${JSON.stringify(cmd.params)}`;
                output += '\n';
            }
        }

        this.outputChannel.clear();
        this.outputChannel.append(output);
        this.outputChannel.show();
    }

    /**
     * List all available voice commands (ADR-008)
     */
    private async listVoiceCommands(): Promise<void> {
        const parser = CommandParser.withSettings();
        const commands = parser.getCommandList();

        // Group commands by category
        const categories = new Map<string, typeof commands>();
        for (const cmd of commands) {
            const category = this.categorizeCommand(cmd.action);
            if (!categories.has(category)) {
                categories.set(category, []);
            }
            categories.get(category)!.push(cmd);
        }

        // Build formatted message
        let message = 'VTThought Voice Commands\n\n';
        for (const [category, cmds] of categories.entries()) {
            message += `## ${category}\n`;
            for (const cmd of cmds) {
                const triggers = cmd.trigger.join(', ');
                message += `  • "${triggers}" → ${cmd.action}\n`;
            }
            message += '\n';
        }

        // Show in output channel
        this.outputChannel.clear();
        this.outputChannel.append(message);
        this.outputChannel.show();

        vscode.window.showInformationMessage(
            'Voice commands listed in VTThought output channel'
        );
    }

    private categorizeCommand(action: string): string {
        if (action.startsWith('terminal.')) return 'Execution Commands';
        if (action.startsWith('editor.action') || action === 'undo' || action === 'redo' || action === 'type') return 'Editing Commands';
        if (action === 'workbench.action.gotoLine' || action === 'editorScroll' || action === 'cursorHome' || action === 'cursorEnd') return 'Navigation Commands';
        if (action.startsWith('workbench.action') || action.startsWith('workbench.view')) return 'VS Code Commands';
        if (action === 'vtthought.toggleRecording') return 'Dictation Control';
        return 'Other';
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
     * Setup authentication (ADR-002)
     */
    private async setupAuthentication(): Promise<void> {
        this.log('Starting authentication setup...');

        // Step 1: Get backend URL
        const backendUrl = await vscode.window.showInputBox({
            prompt: 'Enter your VTThought backend URL',
            value: this.state.backendUrl,
            placeHolder: 'http://localhost:8000',
            validateInput: (value) => {
                if (!value || !value.startsWith('http')) {
                    return 'Please enter a valid URL (http:// or https://)';
                }
                return null;
            }
        });

        if (!backendUrl) {
            this.log('Authentication setup cancelled: No backend URL provided');
            return;
        }

        // Normalize URL (remove trailing slash)
        const normalizedUrl = backendUrl.replace(/\/$/, '');
        await this.tokenManager.storeBackendUrl(normalizedUrl);
        this.state.backendUrl = normalizedUrl;

        // Step 2: Test backend connection
        this.log(`Testing connection to ${normalizedUrl}...`);
        try {
            const response = await fetch(`${normalizedUrl}/api/auth/mode`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const authMode = await response.json() as { mode: string; single_user_mode: boolean };
            this.log(`Backend auth mode: ${authMode.mode}`);

            if (authMode.single_user_mode) {
                // Single-user mode: no token needed
                vscode.window.showInformationMessage(
                    'VTThought: Backend configured in single-user mode. No token required.'
                );
                this.state.isAuthenticated = true;
                this.updateStatusDisplay();
                return;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(
                `VTThought: Failed to connect to backend at ${normalizedUrl}. ${message}`
            );
            this.log(`Backend connection failed: ${message}`);
            return;
        }

        // Step 3: Get token from user
        const token = await vscode.window.showInputBox({
            prompt: 'Enter your VTThought extension token (from backend settings)',
            password: true,
            placeHolder: 'vct_...',
            validateInput: (value) => {
                if (!value || !value.startsWith('vct_')) {
                    return 'Please enter a valid token (starts with vct_)';
                }
                return null;
            }
        });

        if (!token) {
            this.log('Authentication setup cancelled: No token provided');
            return;
        }

        // Store token
        await this.tokenManager.storeToken(token);
        this.state.isAuthenticated = true;

        this.log('Authentication configured successfully');
        vscode.window.showInformationMessage(
            'VTThought: Authentication configured successfully!'
        );
        this.updateStatusDisplay();
    }

    /**
     * Clear authentication (ADR-002)
     */
    private async clearAuthentication(): Promise<void> {
        const result = await vscode.window.showWarningMessage(
            'Are you sure you want to clear your authentication settings?',
            { modal: true },
            'Clear',
            'Cancel'
        );

        if (result === 'Clear') {
            await this.tokenManager.clearAll();
            this.state.isAuthenticated = false;
            this.disconnect();
            this.log('Authentication cleared');
            vscode.window.showInformationMessage('VTThought: Authentication cleared');
            this.updateStatusDisplay();
        }
    }

    /**
     * Show authentication status (ADR-002)
     */
    private async showAuthenticationStatus(): Promise<void> {
        const authStatus = await getAuthStatus(this.tokenManager);

        const message = `
VTThought Authentication Status
===============================
Authenticated: ${authStatus.isConfigured ? 'Yes' : 'No'}
Backend URL: ${authStatus.backendUrl}
`.trim();

        this.log(message);
        vscode.window.showInformationMessage(message);
    }

    /**
     * Run the first-run setup flow (ADR-017)
     */
    private async runSetup(): Promise<void> {
        this.log('Starting setup flow...');
        const setupFlow = new SetupFlow(this.context, this.tokenManager);
        await setupFlow.start();
    }

    /**
     * Reset the first-run setup (ADR-017)
     */
    private async resetSetup(): Promise<void> {
        const result = await vscode.window.showWarningMessage(
            'This will reset VTThought to first-run state. You will need to set up authentication again.',
            { modal: true },
            'Reset',
            'Cancel'
        );

        if (result === 'Reset') {
            await SetupFlow.reset(this.context);
            await this.tokenManager.clearAll();
            this.state.isAuthenticated = false;
            this.disconnect();
            this.log('Setup reset');
            vscode.window.showInformationMessage(
                'VTThought has been reset. Click the status bar or run "VTThought: Run Setup" to start again.'
            );
            this.updateStatusDisplay();
        }
    }

    /**
     * Connect to backend WebSocket
     */
    private async connectBackend(): Promise<void> {
        // Check authentication first (ADR-002)
        if (!this.state.isAuthenticated) {
            const result = await vscode.window.showWarningMessage(
                'VTThought is not configured. Would you like to set up authentication?',
                'Setup',
                'Cancel'
            );

            if (result === 'Setup') {
                await this.setupAuthentication();
                if (!this.state.isAuthenticated) {
                    this.log('Connection cancelled: Authentication not configured');
                    return;
                }
            } else {
                this.log('Connection cancelled: Authentication not configured');
                return;
            }
        }

        const apiUrl = await this.tokenManager.getBackendUrl();
        const wsUrl = await this.tokenManager.getWebSocketUrl();

        this.log(`Connecting to backend: ${apiUrl}`);

        try {
            const authHeader = await this.tokenManager.getAuthHeader();
            const headers: Record<string, string> = {};
            if (authHeader) {
                headers['Authorization'] = authHeader;
            }

            // Step 1: Check compatibility via /api/version endpoint (ADR-024)
            const checker = new VersionChecker();
            const versionResult = await checker.checkCompatibility(apiUrl, authHeader);
            logCompatibilityResult(versionResult, this.outputChannel);

            if (!versionResult.compatible) {
                await handleCompatibilityError(versionResult);
                // If user chose to connect anyway, we continue
                // If they cancelled, handleCompatibilityError throws
            }

            // Store available features for feature detection
            this.state.backendFeatures = versionResult.features;
            this.log(`Backend features: ${versionResult.features.join(', ')}`);

            // Step 2: Verify backend health
            const response = await fetch(`${apiUrl}/api/health`, { headers });

            if (!response.ok) {
                if (response.status === 401) {
                    // Token expired or invalid
                    await this.tokenManager.clearToken();
                    this.state.isAuthenticated = false;
                    vscode.window.showErrorMessage(
                        'VTThought: Authentication failed. Please set up authentication again.',
                        'Setup'
                    ).then(action => {
                        if (action === 'Setup') {
                            vscode.commands.executeCommand('vtthought.setupAuthentication');
                        }
                    });
                    return;
                }
                throw new Error(`Health check failed: ${response.status}`);
            }

            // Step 3: Establish WebSocket connection
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
                `VTThought: Failed to connect to backend at ${apiUrl}. Ensure the backend is running and try again.`
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

    /**
     * Manage vocabulary (ADR-011)
     */
    private async manageVocabulary(): Promise<void> {
        if (!this.resources.userPreferencesManager) {
            vscode.window.showErrorMessage('VTThought: User preferences not initialized');
            return;
        }
        await this.resources.userPreferencesManager.manageVocabulary();
    }

    /**
     * Show style preferences (ADR-011)
     */
    private async showStylePreferences(): Promise<void> {
        if (!this.resources.userPreferencesManager) {
            vscode.window.showErrorMessage('VTThought: User preferences not initialized');
            return;
        }
        await this.resources.userPreferencesManager.showStylePreferences();
    }

    /**
     * Edit style preferences manually (ADR-011)
     */
    private async editStylePreferences(): Promise<void> {
        if (!this.resources.userPreferencesManager) {
            vscode.window.showErrorMessage('VTThought: User preferences not initialized');
            return;
        }
        await this.resources.userPreferencesManager.editStylePreferences();
    }

    /**
     * Show learned corrections (ADR-011)
     */
    private async showLearnedCorrections(): Promise<void> {
        if (!this.resources.userPreferencesManager) {
            vscode.window.showErrorMessage('VTThought: User preferences not initialized');
            return;
        }
        await this.resources.userPreferencesManager.showLearnedCorrections();
    }

    /**
     * Manage user preferences (ADR-011)
     */
    private async manageUserPreferences(): Promise<void> {
        if (!this.resources.userPreferencesManager) {
            vscode.window.showErrorMessage('VTThought: User preferences not initialized');
            return;
        }
        await this.resources.userPreferencesManager.manageUserPreferences();
    }

    /**
     * Show user preferences (ADR-011) - legacy method for compatibility
     */
    private async showUserPreferences(): Promise<void> {
        return this.manageUserPreferences();
    }

    /**
     * Export user data (ADR-011)
     */
    private async exportUserData(): Promise<void> {
        if (!this.resources.userPreferencesManager) {
            vscode.window.showErrorMessage('VTThought: User preferences not initialized');
            return;
        }
        await this.resources.userPreferencesManager.exportUserData();
    }

    /**
     * Delete user data (ADR-011)
     */
    private async deleteUserData(): Promise<void> {
        if (!this.resources.userPreferencesManager) {
            vscode.window.showErrorMessage('VTThought: User preferences not initialized');
            return;
        }
        await this.resources.userPreferencesManager.deleteUserData();
    }

    /**
     * Manage custom voice commands (ADR-011)
     */
    private async manageCustomVoiceCommands(): Promise<void> {
        if (!this.resources.userPreferencesManager) {
            vscode.window.showErrorMessage('VTThought: User preferences not initialized');
            return;
        }
        await this.resources.userPreferencesManager.manageCustomVoiceCommands();
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
