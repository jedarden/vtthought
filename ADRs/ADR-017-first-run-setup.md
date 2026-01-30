# ADR-017: First-Run Setup Flow

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

The first-run experience determines whether users adopt or abandon the extension. Setup must be fast, clear, and lead to immediate value.

Users self-host the backend (exposed via Cloudflare Tunnel or direct). The backend handles all authentication (Google OAuth, username/password, etc.). The extension only needs the backend URL and a session token.

## Decision Drivers

- **Speed**: Get to first transcription in under 60 seconds
- **Minimal steps**: URL + token + mic permission
- **Backend owns auth**: Extension doesn't implement OAuth
- **No surprises**: Explain before asking for permissions
- **Recovery**: Easy to fix if something goes wrong

## Decision

**Simple token-based setup**: User gets token from backend's web UI, pastes into extension.

## Principles

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FRICTIONLESS ONBOARDING PRINCIPLES                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. DEFAULTS THAT WORK                                                       │
│     └─ Pre-configured backend URL (hosted service)                          │
│     └─ Push-to-talk mode, Ctrl+Shift+D hotkey                              │
│     └─ English language, moderate cleanup                                   │
│                                                                              │
│  2. EXPLAIN THEN ASK                                                         │
│     └─ Show WHY before permission prompts                                   │
│     └─ "Voice Code needs microphone access to hear you"                    │
│                                                                              │
│  3. DEVICE CODE OAUTH                                                        │
│     └─ No redirect URI issues                                               │
│     └─ Works in any environment (remote, codespaces)                       │
│     └─ User stays in VS Code                                               │
│                                                                              │
│  4. TEST DURING SETUP                                                        │
│     └─ Verify connection immediately after auth                            │
│     └─ Test mic as part of setup, not after                                │
│                                                                              │
│  5. CELEBRATE SUCCESS                                                        │
│     └─ Clear confirmation when setup complete                              │
│     └─ First transcription gets special feedback                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Auth Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AUTH RESPONSIBILITY                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  BACKEND (owns all auth)                                                     │
│  ├─ Web UI at backend URL (e.g., https://voice.example.com)                │
│  ├─ Supports Google OAuth, username/password, or other methods             │
│  ├─ Settings page displays: "Extension Token: vct_abc123..."               │
│  └─ Token is long-lived, user can regenerate anytime                       │
│                                                                              │
│  EXTENSION (just uses token)                                                 │
│  ├─ Stores backend URL + token                                              │
│  ├─ Sends token in Authorization header                                     │
│  ├─ No OAuth implementation needed                                          │
│  └─ If token invalid → prompt user to get new one                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FIRST-RUN FLOW                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  INSTALL                                                                     │
│     │                                                                        │
│     ▼                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Status bar appears: $(mic-off) Voice Code                           │   │
│  │  Tooltip: "Click to set up Voice Code"                               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│     │                                                                        │
│     │ user clicks                                                           │
│     ▼                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Quick Pick: "Welcome to Voice Code!"                                │   │
│  │                                                                       │   │
│  │  $(rocket) Get Started          Connect to your backend              │   │
│  │  $(book) Learn More             Documentation                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│     │                                                                        │
│     │ "Get Started"                                                         │
│     ▼                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Input Box:                                                           │   │
│  │                                                                       │   │
│  │  "Enter your Voice Code backend URL"                                 │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │ https://voice.example.com                                      │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│     │                                                                        │
│     │ URL entered → validate backend is reachable                           │
│     ▼                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Information Message:                                                 │   │
│  │                                                                       │   │
│  │  "Get your extension token from the backend settings page."         │   │
│  │                                                                       │   │
│  │  [Open Backend]  [I Have a Token]  [Cancel]                          │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│     │                                                                        │
│     │ "Open Backend" → opens backend URL in browser                         │
│     │ User logs in via Google/password (backend handles this)              │
│     │ User copies token from settings page                                  │
│     │                                                                        │
│     │ "I Have a Token"                                                      │
│     ▼                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Input Box:                                                           │   │
│  │                                                                       │   │
│  │  "Paste your extension token"                                        │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │ vct_xxxxxxxxxxxxxxxxxxxxxxxxxxxx                               │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│     │                                                                        │
│     │ token entered → validate against backend                              │
│     ▼                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Information Message:                                                 │   │
│  │                                                                       │   │
│  │  "Voice Code needs microphone access to hear you."                  │   │
│  │                                                                       │   │
│  │  [Allow Microphone]  [Cancel]                                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│     │                                                                        │
│     │ "Allow Microphone" → browser permission prompt                        │
│     ▼                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Information Message:                                                 │   │
│  │                                                                       │   │
│  │  "✓ You're all set!                                                  │   │
│  │                                                                       │   │
│  │   Press Ctrl+Shift+D and speak to dictate."                         │   │
│  │                                                                       │   │
│  │  [Try It Now]  [Done]                                                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│     │                                                                        │
│     ▼                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Status bar: $(mic) Voice Code                                       │   │
│  │  Ready to use!                                                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Implementation

### Setup State Machine

```typescript
type SetupState =
    | 'not_started'
    | 'welcome'
    | 'authenticating'
    | 'awaiting_device_code'
    | 'requesting_mic'
    | 'testing_connection'
    | 'complete'
    | 'error';

class SetupFlow {
    private state: SetupState = 'not_started';
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async checkFirstRun(): Promise<boolean> {
        const hasCompletedSetup = this.context.globalState.get<boolean>(
            'voicecode.setupComplete',
            false
        );
        return !hasCompletedSetup;
    }

    async start(): Promise<void> {
        this.state = 'welcome';
        await this.showWelcome();
    }

    private async showWelcome(): Promise<void> {
        const choice = await vscode.window.showQuickPick([
            {
                label: '$(rocket) Get Started',
                description: 'Set up in 30 seconds',
                action: 'start'
            },
            {
                label: '$(gear) Advanced Setup',
                description: 'Self-hosted backend',
                action: 'advanced'
            },
            {
                label: '$(book) Learn More',
                description: 'Open documentation',
                action: 'docs'
            }
        ], {
            placeHolder: 'Welcome to Voice Code!',
            title: 'Voice Code Setup'
        });

        if (!choice) return;

        switch (choice.action) {
            case 'start':
                await this.startQuickSetup();
                break;
            case 'advanced':
                await this.startAdvancedSetup();
                break;
            case 'docs':
                vscode.env.openExternal(
                    vscode.Uri.parse('https://docs.voicecode.dev')
                );
                break;
        }
    }

    private async startSetup(): Promise<void> {
        const tokenAuth = new TokenAuth();

        // Step 1: Backend URL + Token
        const authed = await tokenAuth.authenticate(this.context);
        if (!authed) return;

        // Step 2: Mic permission
        const micAllowed = await this.requestMicPermission();
        if (!micAllowed) return;

        // Step 3: Quick test
        const works = await this.testTranscription();
        if (!works) return;

        // Step 4: Complete
        await this.completeSetup();
    }

    private async testTranscription(): Promise<boolean> {
        // Optional: Quick test to verify everything works
        // Can be skipped if user wants to jump right in
        const action = await vscode.window.showInformationMessage(
            'Would you like to test the connection?',
            'Test Now',
            'Skip'
        );

        if (action === 'Skip') return true;

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Testing connection...'
        }, async () => {
            try {
                const testAudio = await this.recordTestAudio(1500);
                const result = await this.transcribe(testAudio);

                if (result.success) {
                    await vscode.window.showInformationMessage(
                        `Test successful! Heard: "${result.text}"`,
                        'Great!'
                    );
                    return true;
                } else {
                    throw new Error(result.error);
                }
            } catch (error) {
                const retry = await vscode.window.showErrorMessage(
                    'Test failed. Please check your microphone.',
                    'Try Again',
                    'Skip'
                );
                if (retry === 'Try Again') {
                    return this.testTranscription();
                }
                return retry === 'Skip';
            }
        });
    }
}
```

### Token-Based Auth Flow

```typescript
class TokenAuth {
    /**
     * Prompt user for backend URL and token.
     * Backend handles all OAuth/password auth - we just use the token.
     */
    async authenticate(context: vscode.ExtensionContext): Promise<boolean> {
        // Step 1: Get backend URL
        const backendUrl = await this.promptForBackendUrl();
        if (!backendUrl) return false;

        // Step 2: Validate backend is reachable
        const reachable = await this.validateBackend(backendUrl);
        if (!reachable) return false;

        // Step 3: Prompt user to get token from backend
        const token = await this.promptForToken(backendUrl);
        if (!token) return false;

        // Step 4: Validate token
        const valid = await this.validateToken(backendUrl, token);
        if (!valid) return false;

        // Step 5: Store credentials
        await this.storeCredentials(context, backendUrl, token);

        return true;
    }

    private async promptForBackendUrl(): Promise<string | null> {
        const url = await vscode.window.showInputBox({
            prompt: 'Enter your Voice Code backend URL',
            placeHolder: 'https://voice.example.com',
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

        return url || null;
    }

    private async validateBackend(url: string): Promise<boolean> {
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Checking backend...'
        }, async () => {
            try {
                const response = await fetch(`${url}/health`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(10000)
                });
                return response.ok;
            } catch (error) {
                await vscode.window.showErrorMessage(
                    `Cannot reach ${url}. Please check the URL and try again.`,
                    'OK'
                );
                return false;
            }
        });
    }

    private async promptForToken(backendUrl: string): Promise<string | null> {
        const action = await vscode.window.showInformationMessage(
            'Get your extension token from the backend settings page.',
            'Open Backend',
            'I Have a Token',
            'Cancel'
        );

        if (action === 'Cancel') return null;

        if (action === 'Open Backend') {
            // Open backend in browser - user will log in and get token
            await vscode.env.openExternal(vscode.Uri.parse(backendUrl));

            // Wait for user to come back with token
            await vscode.window.showInformationMessage(
                'After logging in, copy your token from Settings → Extension Token.',
                'I Have My Token'
            );
        }

        // Prompt for token
        const token = await vscode.window.showInputBox({
            prompt: 'Paste your extension token',
            placeHolder: 'vct_xxxxxxxxxxxxxxxxxxxx',
            password: true,  // Hide token as it's typed
            validateInput: (value) => {
                if (!value || value.length < 10) {
                    return 'Token appears too short';
                }
                return null;
            }
        });

        return token || null;
    }

    private async validateToken(url: string, token: string): Promise<boolean> {
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Validating token...'
        }, async () => {
            try {
                const response = await fetch(`${url}/api/me`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    signal: AbortSignal.timeout(10000)
                });

                if (response.ok) {
                    return true;
                } else if (response.status === 401) {
                    await vscode.window.showErrorMessage(
                        'Invalid token. Please check and try again.',
                        'OK'
                    );
                    return false;
                } else {
                    throw new Error(`Unexpected status: ${response.status}`);
                }
            } catch (error) {
                await vscode.window.showErrorMessage(
                    'Could not validate token. Please try again.',
                    'OK'
                );
                return false;
            }
        });
    }

    private async storeCredentials(
        context: vscode.ExtensionContext,
        url: string,
        token: string
    ): Promise<void> {
        // Store URL in settings (not secret)
        await vscode.workspace.getConfiguration('voicecode').update(
            'backendUrl',
            url,
            vscode.ConfigurationTarget.Global
        );

        // Store token securely
        await context.secrets.store('voicecode.token', token);
    }
}
```

### Microphone Permission

```typescript
class MicPermissionFlow {
    async request(): Promise<boolean> {
        // Step 1: Explain before prompting
        const proceed = await vscode.window.showInformationMessage(
            'Voice Code needs microphone access to hear you.\n' +
            'Audio is processed in real-time and not recorded.',
            'Allow Microphone',
            'Cancel'
        );

        if (proceed !== 'Allow Microphone') {
            return false;
        }

        // Step 2: Trigger browser permission via WebView
        const webview = this.getAudioWebView();
        const granted = await webview.requestMicrophonePermission();

        if (!granted) {
            const retry = await vscode.window.showErrorMessage(
                'Microphone access was denied.',
                'Try Again',
                'How to Fix',
                'Cancel'
            );

            if (retry === 'Try Again') {
                return this.request();
            } else if (retry === 'How to Fix') {
                vscode.env.openExternal(
                    vscode.Uri.parse('https://docs.voicecode.dev/permissions')
                );
            }
            return false;
        }

        return true;
    }
}
```

### Test Connection

```typescript
class ConnectionTest {
    async test(token: string): Promise<boolean> {
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Testing connection...'
        }, async () => {
            try {
                const response = await fetch(`${this.backendUrl}/health`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) {
                    throw new Error('Backend not healthy');
                }

                // Quick transcription test
                const testAudio = await this.recordTestAudio(1000);  // 1 second
                const result = await this.transcribe(testAudio, token);

                return result.success;
            } catch (error) {
                await vscode.window.showErrorMessage(
                    'Could not connect to Voice Code service.',
                    'Retry',
                    'Check Settings'
                );
                return false;
            }
        });
    }
}
```

### Complete Setup

```typescript
async function completeSetup(context: vscode.ExtensionContext): Promise<void> {
    // Mark setup as complete
    await context.globalState.update('voicecode.setupComplete', true);

    // Track first use for celebration
    await context.globalState.update('voicecode.firstTranscription', false);

    // Show completion message
    const action = await vscode.window.showInformationMessage(
        '✓ You\'re all set!\n\n' +
        'Press Ctrl+Shift+D and speak to dictate.\n' +
        'Click the status bar for settings.',
        'Try It Now',
        'Done'
    );

    if (action === 'Try It Now') {
        // Focus editor and show hint
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');

        vscode.window.showInformationMessage(
            'Hold Ctrl+Shift+D and say something!',
        );
    }
}
```

### First Transcription Celebration

```typescript
class FirstTranscriptionHandler {
    async onTranscriptionComplete(
        context: vscode.ExtensionContext,
        text: string
    ): Promise<void> {
        const isFirst = !context.globalState.get<boolean>(
            'voicecode.firstTranscription',
            false
        );

        if (isFirst) {
            await context.globalState.update('voicecode.firstTranscription', true);

            vscode.window.showInformationMessage(
                `It works! You said: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
                'Great!'
            );
        }
    }
}
```

## Backend Token Generation

The backend's web UI should provide a clear way to get extension tokens:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  BACKEND SETTINGS PAGE (example)                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Settings → Extension Token                                                  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                                                                        │  │
│  │  Your Extension Token                                                  │  │
│  │  ────────────────────────────────────────────────────────────────────  │  │
│  │                                                                        │  │
│  │  vct_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6                                 │  │
│  │                                                                        │  │
│  │  [Copy Token]  [Regenerate]                                           │  │
│  │                                                                        │  │
│  │  ────────────────────────────────────────────────────────────────────  │  │
│  │                                                                        │  │
│  │  Paste this token into the VS Code extension when prompted.           │  │
│  │  If compromised, click Regenerate to create a new token.              │  │
│  │                                                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Backend Token API

```python
# Backend endpoint for token validation
@app.get("/api/me")
async def get_current_user(token: str = Depends(validate_token)):
    """Validate token and return user info."""
    return {
        "user_id": token.user_id,
        "email": token.email,
        "created_at": token.created_at
    }

# Token format
# vct_ prefix for easy identification
# 32 random bytes, base62 encoded
def generate_extension_token() -> str:
    import secrets
    random_bytes = secrets.token_bytes(32)
    return "vct_" + base62_encode(random_bytes)
```
```

## Configuration Storage

```typescript
// Token stored securely
const secretStorage = context.secrets;
await secretStorage.store('voicecode.token', token);

// Settings stored in VS Code settings
const config = vscode.workspace.getConfiguration('voicecode');
await config.update('backendUrl', url, vscode.ConfigurationTarget.Global);

// State stored in extension state
await context.globalState.update('voicecode.setupComplete', true);
```

## Error Recovery

```typescript
async function recoverFromError(
    error: SetupError,
    context: vscode.ExtensionContext
): Promise<void> {
    switch (error.code) {
        case 'AUTH_FAILED':
            // Clear stored token and restart auth
            await context.secrets.delete('voicecode.token');
            await authenticate();
            break;

        case 'MIC_DENIED':
            // Show help for permission fix
            vscode.env.openExternal(
                vscode.Uri.parse('https://docs.voicecode.dev/permissions')
            );
            break;

        case 'BACKEND_UNREACHABLE':
            // Offer to reconfigure backend URL
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'voicecode.backendUrl'
            );
            break;

        case 'UNKNOWN':
            // Reset everything and start fresh
            await context.globalState.update('voicecode.setupComplete', false);
            await context.secrets.delete('voicecode.token');
            vscode.window.showInformationMessage(
                'Setup has been reset. Click the status bar to start again.'
            );
            break;
    }
}
```

## Metrics

Track setup completion to identify drop-off points:

```typescript
interface SetupMetrics {
    setupStarted: boolean;
    authCompleted: boolean;
    micPermissionGranted: boolean;
    connectionTested: boolean;
    setupCompleted: boolean;
    firstTranscription: boolean;
    timeToFirstTranscription: number;  // ms from install
}
```

## Consequences

### Positive
- **Simple**: URL + token + mic = done
- **Backend owns auth**: Extension has no OAuth complexity
- **Flexible**: Backend can use any auth method (Google, password, SSO)
- **Recoverable**: Easy to regenerate token if compromised
- **Works everywhere**: No redirect URIs, works in remote/codespaces

### Negative
- **Two-step token flow**: User must copy/paste from browser
- **No offline setup**: Requires backend connection
- **Token management**: User must keep token secure

### Tradeoffs
- Backend-managed auth (more flexible) over extension OAuth (more integrated)
- Copy/paste token (reliable) over browser redirect (seamless but fragile)
- Inline messages (VS Code native) over wizard (more polished)

## Related ADRs
- ADR-002: Authentication Strategy (backend auth implementation)
- ADR-009: Docker Container Architecture (backend deployment)
- ADR-013: Extension UI (status bar states)
- ADR-015: Error Handling (recovery flows)
