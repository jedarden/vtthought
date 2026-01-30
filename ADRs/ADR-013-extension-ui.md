# ADR-013: Extension UI

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

The extension needs a UI to show recording state, errors, and provide access to settings. VS Code offers several UI options: status bar, sidebar panels, webviews, notifications, and quick picks.

## Decision Drivers

- **Simplicity**: Minimal UI footprint
- **Non-intrusive**: Don't distract from coding
- **Discoverability**: Users can find settings easily
- **Feedback**: Clear indication of recording state

## Decision

**Status bar item only** for MVP. No panels, sidebars, or custom webviews for UI.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  VS CODE WINDOW                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         EDITOR / TERMINAL                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ main.ts   Ln 42, Col 12   UTF-8       $(mic) Voice        Spaces: 2 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                          ▲                                   │
│                                          └── STATUS BAR ITEM                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Status Bar States

| State | Icon | Text | Background | Tooltip |
|-------|------|------|------------|---------|
| Idle | `$(mic)` | Voice | default | "Press Ctrl+Shift+D to dictate" |
| Recording | `$(pulse)` | 0:03 | warning (yellow) | "Recording... (ESC to cancel)" |
| Processing | `$(sync~spin)` | — | default | "Processing..." |
| Error | `$(error)` | Voice | error (red) | "Error: {message}" |
| Disconnected | `$(mic-off)` | Voice | default | "Not connected (click to configure)" |

```
┌────────────────────────────────────────────────────────────────┐
│  VISUAL STATES                                                  │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐                                              │
│  │ $(mic) Voice │  Idle - ready to record                      │
│  └──────────────┘                                              │
│                                                                 │
│  ┌──────────────┐                                              │
│  │ $(pulse) 0:03│  Recording - yellow background, timer        │
│  └──────────────┘                                              │
│                                                                 │
│  ┌──────────────┐                                              │
│  │$(sync~spin)  │  Processing - spinning icon                  │
│  └──────────────┘                                              │
│                                                                 │
│  ┌──────────────┐                                              │
│  │$(error) Voice│  Error - red background                      │
│  └──────────────┘                                              │
│                                                                 │
│  ┌──────────────┐                                              │
│  │$(mic-off)    │  Disconnected - grayed out                   │
│  └──────────────┘                                              │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

## Click Actions

| Current State | Click Action |
|---------------|-------------|
| Idle | Show quick pick menu |
| Recording | Cancel recording |
| Processing | No action (wait) |
| Error | Show error details, offer retry |
| Disconnected | Open setup wizard |

## Quick Pick Menu

When clicking the status bar in idle state:

```
┌────────────────────────────────────────────────────────────────┐
│  Voice Code                                                     │
├────────────────────────────────────────────────────────────────┤
│  $(gear)  Settings              Configure Voice Code           │
│  $(plug)  Test Connection       Check backend status           │
│  $(mic)   Test Microphone       Record a test clip             │
│  $(book)  Vocabulary            Manage custom terms            │
│  $(sign-out) Sign Out           Disconnect account             │
└────────────────────────────────────────────────────────────────┘
```

## Implementation

### StatusBarUI Class

```typescript
import * as vscode from 'vscode';

type UIState = 'idle' | 'recording' | 'processing' | 'error' | 'disconnected';

class StatusBarUI {
    private item: vscode.StatusBarItem;
    private recordingTimer: NodeJS.Timeout | null = null;
    private recordingStart: number = 0;
    private currentState: UIState = 'idle';
    private errorMessage: string = '';

    constructor() {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.item.command = 'voicecode.statusBarClick';
        this.setIdle();
        this.item.show();
    }

    getState(): UIState {
        return this.currentState;
    }

    setIdle(): void {
        this.currentState = 'idle';
        this.stopTimer();
        this.item.text = '$(mic) Voice';
        this.item.tooltip = 'Voice Code - Press Ctrl+Shift+D to dictate';
        this.item.backgroundColor = undefined;
    }

    setRecording(): void {
        this.currentState = 'recording';
        this.recordingStart = Date.now();
        this.updateRecordingTime();
        this.item.tooltip = 'Recording... (ESC to cancel, click to stop)';
        this.item.backgroundColor = new vscode.ThemeColor(
            'statusBarItem.warningBackground'
        );

        this.recordingTimer = setInterval(() => {
            this.updateRecordingTime();
        }, 1000);
    }

    setProcessing(): void {
        this.currentState = 'processing';
        this.stopTimer();
        this.item.text = '$(sync~spin)';
        this.item.tooltip = 'Processing transcription...';
        this.item.backgroundColor = undefined;
    }

    setError(message: string): void {
        this.currentState = 'error';
        this.errorMessage = message;
        this.stopTimer();
        this.item.text = '$(error) Voice';
        this.item.tooltip = `Error: ${message} (click for options)`;
        this.item.backgroundColor = new vscode.ThemeColor(
            'statusBarItem.errorBackground'
        );

        // Auto-clear error after 10 seconds
        setTimeout(() => {
            if (this.currentState === 'error') {
                this.setIdle();
            }
        }, 10000);
    }

    setDisconnected(): void {
        this.currentState = 'disconnected';
        this.stopTimer();
        this.item.text = '$(mic-off) Voice';
        this.item.tooltip = 'Not connected - click to configure';
        this.item.backgroundColor = undefined;
    }

    private updateRecordingTime(): void {
        const elapsed = Math.floor((Date.now() - this.recordingStart) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        this.item.text = `$(pulse) ${mins}:${secs.toString().padStart(2, '0')}`;
    }

    private stopTimer(): void {
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
    }

    dispose(): void {
        this.stopTimer();
        this.item.dispose();
    }
}
```

### Click Handler

```typescript
async function handleStatusBarClick(ui: StatusBarUI): Promise<void> {
    const state = ui.getState();

    switch (state) {
        case 'idle':
            await showMainMenu();
            break;

        case 'recording':
            // Cancel current recording
            vscode.commands.executeCommand('voicecode.cancel');
            break;

        case 'error':
            await showErrorMenu();
            break;

        case 'disconnected':
            await showSetupWizard();
            break;

        case 'processing':
            // Do nothing - wait for completion
            break;
    }
}

async function showMainMenu(): Promise<void> {
    const items: vscode.QuickPickItem[] = [
        {
            label: '$(gear) Settings',
            description: 'Configure Voice Code'
        },
        {
            label: '$(plug) Test Connection',
            description: 'Check backend status'
        },
        {
            label: '$(mic) Test Microphone',
            description: 'Record a short test clip'
        },
        {
            label: '$(book) Vocabulary',
            description: 'Manage custom terms'
        },
        {
            label: '$(sign-out) Sign Out',
            description: 'Disconnect your account'
        },
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Voice Code'
    });

    if (!selected) return;

    switch (selected.label) {
        case '$(gear) Settings':
            vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'voicecode'
            );
            break;

        case '$(plug) Test Connection':
            vscode.commands.executeCommand('voicecode.testConnection');
            break;

        case '$(mic) Test Microphone':
            vscode.commands.executeCommand('voicecode.testMicrophone');
            break;

        case '$(book) Vocabulary':
            vscode.commands.executeCommand('voicecode.manageVocabulary');
            break;

        case '$(sign-out) Sign Out':
            vscode.commands.executeCommand('voicecode.signOut');
            break;
    }
}

async function showErrorMenu(): Promise<void> {
    const items: vscode.QuickPickItem[] = [
        { label: '$(refresh) Retry Connection', description: 'Try connecting again' },
        { label: '$(gear) Check Settings', description: 'Verify configuration' },
        { label: '$(output) View Logs', description: 'Open output channel' },
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Connection Error'
    });

    if (!selected) return;

    switch (selected.label) {
        case '$(refresh) Retry Connection':
            vscode.commands.executeCommand('voicecode.reconnect');
            break;

        case '$(gear) Check Settings':
            vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'voicecode.backend'
            );
            break;

        case '$(output) View Logs':
            vscode.commands.executeCommand('voicecode.showOutput');
            break;
    }
}
```

### Vocabulary Quick Pick

Simple inline editing via quick pick:

```typescript
async function showVocabularyMenu(): Promise<void> {
    const vocab = await getVocabulary(); // From backend

    const items: vscode.QuickPickItem[] = [
        { label: '$(add) Add Term', description: 'Add a new vocabulary term' },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        ...vocab.map(term => ({
            label: term,
            description: 'Click to remove'
        }))
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Vocabulary - technical terms for better accuracy'
    });

    if (!selected) return;

    if (selected.label === '$(add) Add Term') {
        const term = await vscode.window.showInputBox({
            prompt: 'Enter technical term (e.g., "FastAPI", "kubectl")',
            placeHolder: 'Term'
        });
        if (term) {
            await addVocabularyTerm(term);
            vscode.window.showInformationMessage(`Added "${term}" to vocabulary`);
        }
    } else if (selected.label) {
        const confirm = await vscode.window.showWarningMessage(
            `Remove "${selected.label}" from vocabulary?`,
            'Remove',
            'Cancel'
        );
        if (confirm === 'Remove') {
            await removeVocabularyTerm(selected.label);
        }
    }
}
```

### Test Microphone

Quick audio test with playback:

```typescript
async function testMicrophone(ui: StatusBarUI): Promise<void> {
    const result = await vscode.window.showInformationMessage(
        'Press OK and speak for 3 seconds to test your microphone',
        'OK',
        'Cancel'
    );

    if (result !== 'OK') return;

    ui.setRecording();

    // Record for 3 seconds
    const audio = await recordAudio(3000);

    ui.setProcessing();

    // Send to backend for quick transcription
    const text = await transcribeAudio(audio);

    ui.setIdle();

    // Show result
    const action = await vscode.window.showInformationMessage(
        `Heard: "${text}"`,
        'Sounds Good',
        'Try Again'
    );

    if (action === 'Try Again') {
        testMicrophone(ui);
    }
}
```

## Package.json Configuration

```json
{
    "contributes": {
        "commands": [
            {
                "command": "voicecode.statusBarClick",
                "title": "Voice Code: Menu"
            },
            {
                "command": "voicecode.testConnection",
                "title": "Voice Code: Test Connection"
            },
            {
                "command": "voicecode.testMicrophone",
                "title": "Voice Code: Test Microphone"
            },
            {
                "command": "voicecode.manageVocabulary",
                "title": "Voice Code: Manage Vocabulary"
            },
            {
                "command": "voicecode.showOutput",
                "title": "Voice Code: Show Output"
            },
            {
                "command": "voicecode.reconnect",
                "title": "Voice Code: Reconnect"
            },
            {
                "command": "voicecode.signOut",
                "title": "Voice Code: Sign Out"
            }
        ]
    }
}
```

## Notifications

Use sparingly - only for important events:

```typescript
// Connection lost during recording
vscode.window.showErrorMessage(
    'Connection lost. Your recording was not processed.',
    'Retry'
);

// First successful transcription
vscode.window.showInformationMessage(
    'Voice Code is working! Your text was inserted.',
    'Great'
);

// After sign in
vscode.window.showInformationMessage(
    'Signed in successfully. Press Ctrl+Shift+D to dictate.'
);
```

## No WebView Panels

For MVP, avoid custom webview panels for settings. Use:

1. **VS Code Settings UI** - `vscode.commands.executeCommand('workbench.action.openSettings', 'voicecode')`
2. **Quick Picks** - For simple selections
3. **Input Boxes** - For text input
4. **Notifications** - For alerts

This keeps the extension lightweight and consistent with VS Code conventions.

## Future Enhancements (Post-MVP)

If needed later:
- **Sidebar panel**: Recording history, statistics
- **Webview settings**: Complex configuration UI
- **Inline decorations**: Show confidence levels in inserted text
- **Audio waveform**: Visual feedback during recording

## Consequences

### Positive
- **Minimal footprint**: Single status bar item
- **Non-intrusive**: Doesn't steal focus or space
- **Consistent**: Uses native VS Code UI patterns
- **Fast**: No webview overhead

### Negative
- **Limited feedback**: No waveform or audio level indicator
- **Settings via VS Code UI**: Less polished than custom webview
- **No history view**: Can't see past transcriptions

### Acceptable for MVP
The limitations are acceptable for MVP. Users primarily need:
1. Know when recording is active
2. Access settings
3. See errors clearly

All achievable with status bar + quick picks.

## Related ADRs
- ADR-012: Activation Strategy (recording states)
- ADR-007: Text Insertion (interim text display)
- ADR-017: First-Run Setup Flow (onboarding)
