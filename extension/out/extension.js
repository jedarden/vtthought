"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.VTThoughtExtension = void 0;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const voiceInputViewProvider_1 = require("./voiceInputViewProvider");
const audioStreamer_1 = require("./audioStreamer");
const textInsertion_1 = require("./textInsertion");
const tokenManager_1 = require("./tokenManager");
const setupFlow_1 = require("./setupFlow");
/**
 * VTThought Extension Main Class
 */
class VTThoughtExtension {
    constructor(context) {
        // Audio Streamer for WebSocket communication
        this.audioStreamer = null;
        // Dictation handler for text insertion
        this.dictationHandler = null;
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('VTThought');
        // Create token manager (ADR-002)
        this.tokenManager = tokenManager_1.TokenManager.create(context);
        // Initialize state from configuration
        const config = vscode.workspace.getConfiguration('vtthought');
        this.state = {
            isRecording: false,
            isConnected: false,
            backendUrl: config.get('backendUrl', 'http://localhost:8000'),
            isAuthenticated: false
        };
        // Create status bar items
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.name = 'VTThought Recording Status';
        this.statusBarItem.command = 'vtthought.toggleRecording';
        this.connectionStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.connectionStatusBarItem.name = 'VTThought Connection Status';
        this.connectionStatusBarItem.command = 'vtthought.connectBackend';
        // Create WebView provider for audio capture
        this.voiceInputViewProvider = new voiceInputViewProvider_1.VoiceInputViewProvider(context.extensionUri);
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
        // Create dictation handler with context for first-run celebration
        this.dictationHandler = new textInsertion_1.DictationHandler(context);
        this.context.subscriptions.push({
            dispose: () => this.dictationHandler?.dispose()
        });
    }
    /**
     * Activate the extension
     */
    async activate() {
        this.log('VTThought Extension Activated');
        // Check for first-run setup (ADR-017)
        const setupFlow = new setupFlow_1.SetupFlow(this.context, this.tokenManager);
        const isFirstRun = await setupFlow.isFirstRun();
        if (isFirstRun) {
            this.log('First run detected - starting setup flow...');
            // Show welcome after a short delay to let VS Code fully load
            setTimeout(() => {
                setupFlow.start().catch(err => {
                    this.log(`Setup flow failed: ${err}`);
                });
            }, 1000);
        }
        else {
            // Check authentication status (ADR-002)
            const authStatus = await (0, tokenManager_1.getAuthStatus)(this.tokenManager);
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
        this.context.subscriptions.push(vscode.window.registerWebviewViewProvider(voiceInputViewProvider_1.VoiceInputViewProvider.viewType, this.voiceInputViewProvider));
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
    deactivate() {
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
    registerCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand('vtthought.toggleRecording', () => {
            this.toggleRecording();
        }), vscode.commands.registerCommand('vtthought.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'vtthought');
        }), vscode.commands.registerCommand('vtthought.connectBackend', () => {
            this.connectBackend();
        }), vscode.commands.registerCommand('vtthought.disconnectBackend', () => {
            this.disconnect();
        }), 
        // Authentication commands (ADR-002)
        vscode.commands.registerCommand('vtthought.setupAuthentication', async () => {
            await this.setupAuthentication();
        }), vscode.commands.registerCommand('vtthought.clearAuthentication', async () => {
            await this.clearAuthentication();
        }), vscode.commands.registerCommand('vtthought.showAuthenticationStatus', async () => {
            await this.showAuthenticationStatus();
        }), 
        // First-run setup commands (ADR-017)
        vscode.commands.registerCommand('vtthought.runSetup', async () => {
            await this.runSetup();
        }), vscode.commands.registerCommand('vtthought.resetSetup', async () => {
            await this.resetSetup();
        }));
        this.log('Commands registered');
    }
    /**
     * Toggle recording state
     */
    toggleRecording() {
        if (!this.state.isConnected) {
            vscode.window.showWarningMessage('VTThought is not connected to the backend. Connect first.');
            return;
        }
        this.state.isRecording = !this.state.isRecording;
        this.updateStatusDisplay();
        if (this.state.isRecording) {
            this.startRecording();
        }
        else {
            this.stopRecording();
        }
    }
    /**
     * Start recording
     */
    startRecording() {
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
    stopRecording() {
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
    handleAudioData(data, sampleRate) {
        // Stream audio to backend via WebSocket
        if (this.audioStreamer?.isConnected) {
            try {
                this.audioStreamer.sendAudio(data);
            }
            catch (error) {
                this.log(`Failed to send audio data: ${error}`);
            }
        }
    }
    /**
     * Setup authentication (ADR-002)
     */
    async setupAuthentication() {
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
            const authMode = await response.json();
            this.log(`Backend auth mode: ${authMode.mode}`);
            if (authMode.single_user_mode) {
                // Single-user mode: no token needed
                vscode.window.showInformationMessage('VTThought: Backend configured in single-user mode. No token required.');
                this.state.isAuthenticated = true;
                this.updateStatusDisplay();
                return;
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`VTThought: Failed to connect to backend at ${normalizedUrl}. ${message}`);
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
        vscode.window.showInformationMessage('VTThought: Authentication configured successfully!');
        this.updateStatusDisplay();
    }
    /**
     * Clear authentication (ADR-002)
     */
    async clearAuthentication() {
        const result = await vscode.window.showWarningMessage('Are you sure you want to clear your authentication settings?', { modal: true }, 'Clear', 'Cancel');
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
    async showAuthenticationStatus() {
        const authStatus = await (0, tokenManager_1.getAuthStatus)(this.tokenManager);
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
    async runSetup() {
        this.log('Starting setup flow...');
        const setupFlow = new setupFlow_1.SetupFlow(this.context, this.tokenManager);
        await setupFlow.start();
    }
    /**
     * Reset the first-run setup (ADR-017)
     */
    async resetSetup() {
        const result = await vscode.window.showWarningMessage('This will reset VTThought to first-run state. You will need to set up authentication again.', { modal: true }, 'Reset', 'Cancel');
        if (result === 'Reset') {
            await setupFlow_1.SetupFlow.reset(this.context);
            await this.tokenManager.clearAll();
            this.state.isAuthenticated = false;
            this.disconnect();
            this.log('Setup reset');
            vscode.window.showInformationMessage('VTThought has been reset. Click the status bar or run "VTThought: Run Setup" to start again.');
            this.updateStatusDisplay();
        }
    }
    /**
     * Connect to backend WebSocket
     */
    async connectBackend() {
        // Check authentication first (ADR-002)
        if (!this.state.isAuthenticated) {
            const result = await vscode.window.showWarningMessage('VTThought is not configured. Would you like to set up authentication?', 'Setup', 'Cancel');
            if (result === 'Setup') {
                await this.setupAuthentication();
                if (!this.state.isAuthenticated) {
                    this.log('Connection cancelled: Authentication not configured');
                    return;
                }
            }
            else {
                this.log('Connection cancelled: Authentication not configured');
                return;
            }
        }
        const apiUrl = await this.tokenManager.getBackendUrl();
        const wsUrl = await this.tokenManager.getWebSocketUrl();
        this.log(`Connecting to backend: ${apiUrl}`);
        try {
            // First, verify backend is reachable via health check
            const authHeader = await this.tokenManager.getAuthHeader();
            const headers = {};
            if (authHeader) {
                headers['Authorization'] = authHeader;
            }
            const response = await fetch(`${apiUrl}/api/health`, { headers });
            if (!response.ok) {
                if (response.status === 401) {
                    // Token expired or invalid
                    await this.tokenManager.clearToken();
                    this.state.isAuthenticated = false;
                    vscode.window.showErrorMessage('VTThought: Authentication failed. Please set up authentication again.', 'Setup').then(action => {
                        if (action === 'Setup') {
                            vscode.commands.executeCommand('vtthought.setupAuthentication');
                        }
                    });
                    return;
                }
                throw new Error(`Health check failed: ${response.status}`);
            }
            // Establish WebSocket connection
            this.audioStreamer = new audioStreamer_1.AudioStreamer(wsUrl, { sampleRate: 16000, channels: 1 }, {
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
        }
        catch (error) {
            this.log(`Connection failed: ${error}`);
            vscode.window.showErrorMessage(`VTThought: Failed to connect to backend at ${apiUrl}. Ensure the backend is running and try again.`);
            this.state.isConnected = false;
            this.updateStatusDisplay();
        }
    }
    /**
     * Disconnect from backend
     */
    disconnect() {
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
    updateStatusDisplay() {
        // Recording status
        if (this.state.isRecording) {
            this.statusBarItem.text = '$record VTThought: Recording';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.statusBarItem.tooltip = 'Click to stop recording';
        }
        else {
            this.statusBarItem.text = '$circle-large-outline VTThought: Idle';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = 'Click to start recording (Ctrl+Alt+V)';
        }
        // Connection status
        if (this.state.isConnected) {
            this.connectionStatusBarItem.text = '$radio-tower VTThought: Connected';
            this.connectionStatusBarItem.tooltip = 'Connected to backend';
            this.connectionStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        }
        else {
            this.connectionStatusBarItem.text = '$circle-large-outline VTThought: Disconnected';
            this.connectionStatusBarItem.tooltip = 'Click to connect to backend';
            this.connectionStatusBarItem.backgroundColor = undefined;
        }
    }
    /**
     * Handle configuration changes
     */
    handleConfigurationChange() {
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
    log(message) {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }
}
exports.VTThoughtExtension = VTThoughtExtension;
/**
 * Extension entry point
 */
function activate(context) {
    const extension = new VTThoughtExtension(context);
    extension.activate();
    // Store extension instance for deactivation
    context.subscriptions.push({
        dispose: () => extension.deactivate()
    });
}
function deactivate() {
    // Cleanup handled by extension dispose
}
//# sourceMappingURL=extension.js.map