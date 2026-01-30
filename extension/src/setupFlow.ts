/**
 * VTThought First-Run Setup Flow (ADR-017)
 *
 * Implements the 3-click onboarding experience for new users.
 * Gets users from install to first transcription in under 60 seconds.
 */

import * as vscode from 'vscode';
import { TokenManager } from './tokenManager';

/**
 * Setup state machine states
 */
type SetupState =
    | 'not_started'
    | 'welcome'
    | 'backend_url'
    | 'token'
    | 'microphone'
    | 'testing'
    | 'complete'
    | 'error';

/**
 * Setup flow configuration
 */
interface SetupConfig {
    backendUrl: string;
    token: string;
    microphoneGranted: boolean;
}

/**
 * Quick pick action types
 */
interface QuickPickAction {
    label: string;
    description: string;
    action: string;
}

/**
 * First-run setup flow manager
 *
 * Implements ADR-017: Frictionless onboarding with:
 * 1. Welcome screen with Get Started option
 * 2. Backend URL configuration
 * 3. Token acquisition from backend
 * 4. Microphone permission request
 * 5. Connection testing
 * 6. Completion celebration
 */
export class SetupFlow {
    private state: SetupState = 'not_started';
    private config: SetupConfig = {
        backendUrl: '',
        token: '',
        microphoneGranted: false
    };

    private static readonly SETUP_COMPLETE_KEY = 'vtthought.setupComplete';
    private static readonly FIRST_TRANSCRIPTION_KEY = 'vtthought.firstTranscription';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly tokenManager: TokenManager
    ) {}

    /**
     * Check if this is a first-run scenario
     */
    public async isFirstRun(): Promise<boolean> {
        const setupComplete = this.context.globalState.get<boolean>(
            SetupFlow.SETUP_COMPLETE_KEY,
            false
        );
        return !setupComplete;
    }

    /**
     * Start the first-run setup flow
     */
    public async start(): Promise<void> {
        this.state = 'welcome';

        // Show welcome screen
        await this.showWelcome();
    }

    /**
     * Show welcome quick pick
     */
    private async showWelcome(): Promise<void> {
        const items: QuickPickAction[] = [
            {
                label: '$(rocket) Get Started',
                description: 'Set up in 30 seconds',
                action: 'start'
            },
            {
                label: '$(book) Learn More',
                description: 'Open documentation',
                action: 'docs'
            }
        ];

        const choice = await vscode.window.showQuickPick(items, {
            placeHolder: 'Welcome to VTThought Voice Code!',
            title: 'VTThought Setup'
        });

        if (!choice) {
            // User dismissed the dialog
            this.state = 'not_started';
            return;
        }

        switch (choice.action) {
            case 'start':
                await this.startQuickSetup();
                break;
            case 'docs':
                await vscode.env.openExternal(
                    vscode.Uri.parse('https://github.com/jedarden/vtthought')
                );
                // Re-show welcome after opening docs
                await this.showWelcome();
                break;
        }
    }

    /**
     * Run the quick setup flow
     */
    private async startQuickSetup(): Promise<void> {
        // Step 1: Backend URL
        this.state = 'backend_url';
        const backendUrl = await this.promptBackendUrl();
        if (!backendUrl) {
            this.state = 'not_started';
            return;
        }
        this.config.backendUrl = backendUrl;

        // Step 2: Validate backend and get token
        this.state = 'token';
        const token = await this.promptAndValidateToken(backendUrl);
        if (!token) {
            this.state = 'not_started';
            return;
        }
        this.config.token = token;

        // Step 3: Microphone permission
        this.state = 'microphone';
        const micGranted = await this.requestMicrophonePermission();
        if (!micGranted) {
            this.state = 'not_started';
            return;
        }
        this.config.microphoneGranted = true;

        // Step 4: Test connection (optional but recommended)
        this.state = 'testing';
        const testResult = await this.testConnection(backendUrl, token);
        if (!testResult && !await this.skipTest()) {
            this.state = 'not_started';
            return;
        }

        // Step 5: Complete setup
        await this.completeSetup();
    }

    /**
     * Prompt for backend URL
     */
    private async promptBackendUrl(): Promise<string | null> {
        const url = await vscode.window.showInputBox({
            prompt: 'Enter your VTThought backend URL',
            placeHolder: 'http://localhost:8000',
            value: 'http://localhost:8000',
            validateInput: (value) => {
                try {
                    const parsed = new URL(value);
                    if (!['http:', 'https:'].includes(parsed.protocol)) {
                        return 'URL must use http or https';
                    }
                    return null;
                } catch {
                    return 'Please enter a valid URL';
                }
            }
        });

        if (!url) {
            return null;
        }

        // Normalize URL (remove trailing slash)
        return url.replace(/\/$/, '');
    }

    /**
     * Validate backend and prompt for token
     */
    private async promptAndValidateToken(backendUrl: string): Promise<string | null> {
        // First, validate backend is reachable
        const reachable = await this.validateBackend(backendUrl);
        if (!reachable) {
            return null;
        }

        // Check if backend is in single-user mode
        const singleUserMode = await this.checkSingleUserMode(backendUrl);
        if (singleUserMode) {
            // No token needed
            return 'single_user_mode';
        }

        // Prompt user to get token from backend
        const action = await vscode.window.showInformationMessage(
            'Get your extension token from the backend settings page.',
            'Open Backend',
            'I Have a Token',
            'Cancel'
        );

        if (action === 'Cancel' || !action) {
            return null;
        }

        if (action === 'Open Backend') {
            // Open backend in browser
            await vscode.env.openExternal(vscode.Uri.parse(backendUrl));

            // Wait for user to come back with token
            const waitResult = await vscode.window.showInformationMessage(
                'After logging in, copy your token from Settings → Extension Token.',
                'I Have My Token',
                'Cancel'
            );

            if (waitResult !== 'I Have My Token') {
                return null;
            }
        }

        // Prompt for token
        const token = await vscode.window.showInputBox({
            prompt: 'Paste your extension token',
            placeHolder: 'vct_xxxxxxxxxxxxxxxxxxxx',
            password: true,
            validateInput: (value) => {
                if (!value || value.length < 10) {
                    return 'Token appears too short';
                }
                if (!value.startsWith('vct_') && !value.startsWith('single_user_mode')) {
                    return 'Token should start with vct_';
                }
                return null;
            }
        });

        if (!token) {
            return null;
        }

        // Validate token
        const valid = await this.validateToken(backendUrl, token);
        if (!valid) {
            return null;
        }

        return token;
    }

    /**
     * Validate backend is reachable
     */
    private async validateBackend(url: string): Promise<boolean> {
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Checking backend...',
            cancellable: false
        }, async () => {
            try {
                const response = await fetch(`${url}/api/health`, {
                    signal: AbortSignal.timeout(10000)
                });
                return response.ok;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await vscode.window.showErrorMessage(
                    `Cannot reach ${url}. ${message}`,
                    'OK'
                );
                return false;
            }
        });
    }

    /**
     * Check if backend is in single-user mode
     */
    private async checkSingleUserMode(url: string): Promise<boolean> {
        try {
            const response = await fetch(`${url}/api/auth/mode`, {
                signal: AbortSignal.timeout(5000)
            });
            if (!response.ok) {
                return false;
            }
            const data = await response.json() as { mode: string; single_user_mode: boolean };
            return data.single_user_mode || false;
        } catch {
            return false;
        }
    }

    /**
     * Validate token against backend
     */
    private async validateToken(url: string, token: string): Promise<boolean> {
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Validating token...',
            cancellable: false
        }, async () => {
            try {
                // Use WebSocket endpoint for validation (it requires token)
                const wsUrl = url
                    .replace(/^https:\/\//, 'wss://')
                    .replace(/^http:\/\//, 'ws://');

                // Try to establish WebSocket connection
                const testWsUrl = token === 'single_user_mode'
                    ? `${wsUrl}/api/ws/audio`
                    : `${wsUrl}/api/ws/audio?token=${encodeURIComponent(token)}`;

                return new Promise<boolean>((resolve) => {
                    const ws = new WebSocket(testWsUrl);
                    const timeout = setTimeout(() => {
                        ws.close();
                        resolve(false);
                    }, 5000);

                    ws.onopen = () => {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(true);
                    };

                    ws.onerror = () => {
                        clearTimeout(timeout);
                        resolve(false);
                    };
                });
            } catch (error) {
                await vscode.window.showErrorMessage(
                    'Could not validate token. Please check and try again.',
                    'OK'
                );
                return false;
            }
        });
    }

    /**
     * Request microphone permission
     */
    private async requestMicrophonePermission(): Promise<boolean> {
        const action = await vscode.window.showInformationMessage(
            'VTThought needs microphone access to hear you.\nAudio is processed in real-time and not recorded.',
            'Allow Microphone',
            'Cancel'
        );

        if (action !== 'Allow Microphone') {
            return false;
        }

        // We can't actually test mic from here - that happens in the WebView
        // Just confirm the user understands they need to allow it
        await vscode.window.showInformationMessage(
            'Microphone access will be requested when you start recording.\nPlease allow it when prompted by your browser.',
            'Got it'
        );

        return true;
    }

    /**
     * Test connection to backend
     */
    private async testConnection(backendUrl: string, token: string): Promise<boolean> {
        const action = await vscode.window.showInformationMessage(
            'Would you like to test the connection now?',
            'Test Now',
            'Skip'
        );

        if (action === 'Skip') {
            return true;
        }

        if (!action) {
            return false;
        }

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Testing connection...',
            cancellable: false
        }, async () => {
            try {
                // Test health endpoint
                const headers: Record<string, string> = {};
                if (token !== 'single_user_mode') {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const response = await fetch(`${backendUrl}/api/health`, {
                    headers,
                    signal: AbortSignal.timeout(10000)
                });

                if (!response.ok) {
                    throw new Error(`Health check failed: ${response.status}`);
                }

                const data = await response.json();
                await vscode.window.showInformationMessage(
                    `Connection successful! Backend is healthy.`,
                    'Great!'
                );
                return true;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const retry = await vscode.window.showErrorMessage(
                    `Connection test failed: ${message}`,
                    'Try Again',
                    'Skip',
                    'Cancel'
                );

                if (retry === 'Try Again') {
                    return this.testConnection(backendUrl, token);
                }
                return retry === 'Skip';
            }
        });
    }

    /**
     * Ask user if they want to skip the test
     */
    private async skipTest(): Promise<boolean> {
        const action = await vscode.window.showWarningMessage(
            'Connection test failed. Continue anyway?',
            'Continue',
            'Cancel'
        );
        return action === 'Continue';
    }

    /**
     * Complete the setup process
     */
    private async completeSetup(): Promise<void> {
        this.state = 'complete';

        // Store configuration
        await this.tokenManager.storeBackendUrl(this.config.backendUrl);
        if (this.config.token !== 'single_user_mode') {
            await this.tokenManager.storeToken(this.config.token);
        }

        // Mark setup as complete
        await this.context.globalState.update(SetupFlow.SETUP_COMPLETE_KEY, true);

        // Initialize first transcription flag
        await this.context.globalState.update(SetupFlow.FIRST_TRANSCRIPTION_KEY, false);

        // Show completion message
        const action = await vscode.window.showInformationMessage(
            '✓ You\'re all set!\n\nPress Ctrl+Alt+V and speak to dictate.\nClick the status bar for settings.',
            'Try It Now',
            'Done'
        );

        if (action === 'Try It Now') {
            // Focus editor and show hint
            await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
            await vscode.window.showInformationMessage(
                'Hold Ctrl+Alt+V and say something!',
            );
        }
    }

    /**
     * Handle first transcription (show celebration)
     */
    public static async onFirstTranscription(context: vscode.ExtensionContext, text: string): Promise<void> {
        const isFirst = !context.globalState.get<boolean>(
            SetupFlow.FIRST_TRANSCRIPTION_KEY,
            false
        );

        if (isFirst && text.length > 0) {
            await context.globalState.update(SetupFlow.FIRST_TRANSCRIPTION_KEY, true);

            const preview = text.length > 50
                ? text.substring(0, 50) + '...'
                : text;

            await vscode.window.showInformationMessage(
                `It works! You said: "${preview}"`,
                'Great!'
            );
        }
    }

    /**
     * Reset setup (for re-configuration)
     */
    public static async reset(context: vscode.ExtensionContext): Promise<void> {
        await context.globalState.update(SetupFlow.SETUP_COMPLETE_KEY, false);
        await context.globalState.update(SetupFlow.FIRST_TRANSCRIPTION_KEY, false);
    }

    /**
     * Check if setup is complete
     */
    public static async isSetupComplete(context: vscode.ExtensionContext): Promise<boolean> {
        return context.globalState.get<boolean>(
            SetupFlow.SETUP_COMPLETE_KEY,
            false
        );
    }
}
