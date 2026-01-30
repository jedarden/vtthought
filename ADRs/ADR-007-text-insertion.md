# ADR-007: Text Insertion into VS Code

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

After transcription and cleanup, the text must be inserted into VS Code at the user's cursor position. This could be in the editor, terminal, or other input fields.

## Decision Drivers

- **Target flexibility**: Support editor, terminal, search boxes, etc.
- **Accuracy**: Insert exactly where user expects
- **UX**: Smooth, non-disruptive insertion
- **Commands**: Support for special actions (Enter, Tab, etc.)

## Insertion Targets

```
┌──────────────────────────────────────────────────────────────────────┐
│                    VS CODE INSERTION TARGETS                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  1. ACTIVE EDITOR                                                     │
│     └─ Code file, markdown, JSON, etc.                               │
│                                                                       │
│  2. INTEGRATED TERMINAL                                               │
│     └─ Claude Code, shell commands, REPL                             │
│                                                                       │
│  3. INPUT BOXES                                                       │
│     ├─ Command Palette (Ctrl+Shift+P)                                │
│     ├─ Search (Ctrl+F, Ctrl+Shift+F)                                 │
│     ├─ Quick Open (Ctrl+P)                                           │
│     └─ Source Control message                                        │
│                                                                       │
│  4. WEBVIEW INPUTS                                                    │
│     └─ Extension webviews, settings                                  │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Options Considered

### Option A: VS Code API (Recommended)

```typescript
// Insert into active text editor
async function insertIntoEditor(text: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    await editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, text);
    });
}

// Insert into active terminal
function insertIntoTerminal(text: string, execute: boolean = false): void {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) return;

    terminal.sendText(text, execute);  // execute=true adds Enter
}

// Insert into input box (Command Palette, etc.)
async function insertIntoInputBox(text: string): Promise<void> {
    // VS Code doesn't have direct API for this
    // Use clipboard workaround
    await vscode.env.clipboard.writeText(text);
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
}
```

**Pros:**
- Native VS Code integration
- Respects editor state (formatting, indentation)
- Works with undo/redo
- Terminal API is reliable

**Cons:**
- Limited control over input boxes
- No direct focus detection for some elements

### Option B: Simulated Keyboard Input

```typescript
// Using VS Code's built-in type command
async function simulateTyping(text: string): Promise<void> {
    for (const char of text) {
        await vscode.commands.executeCommand('type', { text: char });
        await sleep(10);  // Small delay for natural typing
    }
}
```

**Pros:**
- Works anywhere focus is
- Natural typing appearance

**Cons:**
- Slow for long text
- May trigger autocomplete unexpectedly
- Less reliable than direct API

### Option C: Clipboard Paste

```typescript
async function pasteFromClipboard(text: string): Promise<void> {
    const originalClipboard = await vscode.env.clipboard.readText();

    await vscode.env.clipboard.writeText(text);
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');

    // Restore original clipboard
    await vscode.env.clipboard.writeText(originalClipboard);
}
```

**Pros:**
- Works in most contexts
- Fast for large text

**Cons:**
- Clobbers clipboard (need to restore)
- User might notice clipboard change

## Decision

**Hybrid approach based on focus:**

```typescript
async function insertText(text: string, options: InsertOptions = {}): Promise<void> {
    const { execute = false } = options;

    // Priority 1: Active terminal
    const terminal = vscode.window.activeTerminal;
    if (isTerminalFocused()) {
        terminal?.sendText(text, execute);
        return;
    }

    // Priority 2: Active text editor
    const editor = vscode.window.activeTextEditor;
    if (editor && isEditorFocused()) {
        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, text);
        });
        return;
    }

    // Priority 3: Fallback to clipboard paste
    await pasteFromClipboard(text);
}
```

## Implementation Details

### Focus Detection

```typescript
// Track focus state
let currentFocus: 'editor' | 'terminal' | 'other' = 'other';

// Listen for focus changes
vscode.window.onDidChangeActiveTextEditor(() => {
    currentFocus = 'editor';
});

vscode.window.onDidChangeActiveTerminal(() => {
    currentFocus = 'terminal';
});

vscode.window.onDidChangeWindowState((state) => {
    if (!state.focused) {
        currentFocus = 'other';
    }
});
```

### Terminal-Specific Handling

For Claude Code terminal integration:

```typescript
interface TerminalInsertOptions {
    execute: boolean;        // Press Enter after text
    clearLine: boolean;      // Clear current line first
    newLine: boolean;        // Add newline before text
}

function insertIntoTerminal(text: string, options: TerminalInsertOptions): void {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) return;

    if (options.clearLine) {
        // Send Ctrl+U to clear line (bash/zsh)
        terminal.sendText('\u0015', false);
    }

    if (options.newLine) {
        terminal.sendText('\n', false);
    }

    terminal.sendText(text, options.execute);
}
```

### Streaming Text Insertion

For real-time transcription display with interim result rewriting.

## Interim Text Replacement for Streaming Dictation

The key challenge is replacing text atomically as interim results arrive with corrections. This section details the mechanics.

### Visual Mechanics

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TEXT REPLACEMENT MECHANICS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Editor state before dictation:                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  const user = await getUser(|                                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                  ↑ cursor = anchor (fixed reference point)  │
│                                                                              │
│  Interim 1: "I need an analyst"                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  const user = await getUser(I need an analyst|                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                 ├───────────────┤ interim region (gray)     │
│                                 anchor          anchor + interimLength      │
│                                                                              │
│  Interim 2: "I need analytics" (CORRECTION - "analyst" → "analytics")       │
│  Action: Replace range [anchor, anchor+17] with new text                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  const user = await getUser(I need analytics|                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                 ├─────────────┤ new interim region          │
│                                                                              │
│  LLM Cleanup streams: "Add analytics"                                       │
│  Action: Replace interim region with cleaned text (no longer gray)          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  const user = await getUser(Add analytics|                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                 ├───────────┤ final text (normal style)     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### InterimTextManager Implementation

```typescript
/**
 * Manages interim text display with rewriting support.
 *
 * Key concepts:
 * - anchor: Fixed position where dictation started (never moves)
 * - interimLength: Current length of interim text (for calculating replacement range)
 * - Atomic replacement: Uses editBuilder.replace() for flicker-free updates
 * - Undo grouping: All interim edits are one undo operation
 */
class InterimTextManager {
    // Fixed starting point - never moves during dictation
    private anchor: vscode.Position | null = null;

    // Current interim text length for calculating replacement range
    private interimLength = 0;

    // Decoration for gray/italic interim styling
    private interimStyle = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('editorGhostText.foreground'),
        fontStyle: 'italic',
        // Optional: add subtle background
        backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
    });

    /**
     * Handle an interim result from the server.
     * Replaces all existing interim text with new text.
     */
    async handleInterim(
        editor: vscode.TextEditor,
        text: string,
        isFinal: boolean
    ): Promise<void> {
        // First interim: record anchor position
        if (!this.anchor) {
            this.anchor = editor.selection.active;
        }

        // Calculate the range of existing interim text
        const interimStart = this.anchor;
        const interimEnd = this.anchor.translate(0, this.interimLength);
        const interimRange = new vscode.Range(interimStart, interimEnd);

        // Atomic edit: replace entire interim region with new text
        const success = await editor.edit(editBuilder => {
            if (this.interimLength > 0) {
                // Replace existing interim text
                editBuilder.replace(interimRange, text);
            } else {
                // First insertion
                editBuilder.insert(this.anchor!, text);
            }
        }, {
            // Undo grouping: don't create undo stops between interim edits
            undoStopBefore: false,
            undoStopAfter: false,
        });

        if (!success) {
            console.warn('InterimTextManager: edit failed');
            return;
        }

        // Update tracked length
        this.interimLength = text.length;

        // Apply or remove interim styling
        if (!isFinal) {
            const newRange = new vscode.Range(
                this.anchor,
                this.anchor.translate(0, this.interimLength)
            );
            editor.setDecorations(this.interimStyle, [newRange]);
        } else {
            // Final STT result: remove interim styling
            editor.setDecorations(this.interimStyle, []);
        }

        // Move cursor to end of inserted text
        const newCursorPos = this.anchor.translate(0, this.interimLength);
        editor.selection = new vscode.Selection(newCursorPos, newCursorPos);
    }

    /**
     * Handle streaming LLM cleanup tokens.
     * First token replaces interim text; subsequent tokens append.
     */
    async handleStreamingToken(
        editor: vscode.TextEditor,
        token: string,
        position: number  // Character position in the cleaned output
    ): Promise<void> {
        if (!this.anchor) return;

        // Clear interim styling on first token
        if (position === 0) {
            editor.setDecorations(this.interimStyle, []);
        }

        if (position === 0 && this.interimLength > 0) {
            // First token: replace entire interim text
            const interimRange = new vscode.Range(
                this.anchor,
                this.anchor.translate(0, this.interimLength)
            );
            await editor.edit(eb => eb.replace(interimRange, token), {
                undoStopBefore: false,
                undoStopAfter: false,
            });
            this.interimLength = token.length;
        } else {
            // Subsequent tokens: append
            const insertPos = this.anchor.translate(0, this.interimLength);
            await editor.edit(eb => eb.insert(insertPos, token), {
                undoStopBefore: false,
                undoStopAfter: false,
            });
            this.interimLength += token.length;
        }

        // Move cursor to end
        const newCursorPos = this.anchor.translate(0, this.interimLength);
        editor.selection = new vscode.Selection(newCursorPos, newCursorPos);
    }

    /**
     * Finalize the dictation session.
     * Creates undo stop so entire dictation is one undo operation.
     */
    async finalize(editor: vscode.TextEditor): Promise<void> {
        if (!this.anchor) return;

        // Create final undo stop - entire dictation is now one undo
        await editor.edit(() => {}, {
            undoStopBefore: false,
            undoStopAfter: true,  // End the undo group
        });

        // Clear styling
        editor.setDecorations(this.interimStyle, []);

        // Reset state
        this.reset();
    }

    /**
     * Cancel dictation and remove any interim text.
     */
    async cancel(editor: vscode.TextEditor): Promise<void> {
        if (!this.anchor || this.interimLength === 0) {
            this.reset();
            return;
        }

        // Delete the interim text
        const interimRange = new vscode.Range(
            this.anchor,
            this.anchor.translate(0, this.interimLength)
        );
        await editor.edit(eb => eb.delete(interimRange));

        // Clear styling and reset
        editor.setDecorations(this.interimStyle, []);
        this.reset();
    }

    reset(): void {
        this.anchor = null;
        this.interimLength = 0;
    }

    isActive(): boolean {
        return this.anchor !== null;
    }
}
```

### Multi-Line Interim Text

For interim text that spans multiple lines, use offset-based positioning:

```typescript
class MultiLineInterimManager extends InterimTextManager {
    private anchorOffset: number = 0;

    async handleInterim(
        editor: vscode.TextEditor,
        text: string,
        isFinal: boolean
    ): Promise<void> {
        const document = editor.document;

        if (this.anchorOffset === 0) {
            // Record offset (character position from start of document)
            this.anchorOffset = document.offsetAt(editor.selection.active);
        }

        // Calculate positions from offsets (handles multi-line correctly)
        const startPos = document.positionAt(this.anchorOffset);
        const endPos = document.positionAt(this.anchorOffset + this.interimLength);
        const interimRange = new vscode.Range(startPos, endPos);

        await editor.edit(editBuilder => {
            if (this.interimLength > 0) {
                editBuilder.replace(interimRange, text);
            } else {
                editBuilder.insert(startPos, text);
            }
        }, {
            undoStopBefore: false,
            undoStopAfter: false,
        });

        this.interimLength = text.length;

        // Apply styling to multi-line range
        if (!isFinal) {
            const newEndPos = document.positionAt(this.anchorOffset + this.interimLength);
            const newRange = new vscode.Range(startPos, newEndPos);
            editor.setDecorations(this.interimStyle, [newRange]);
        }
    }
}
```

### Terminal Handling (No Interim Display)

Terminals don't support interim display - too disruptive. Only stream final cleaned tokens:

```typescript
class TerminalInserter {
    /**
     * Terminals receive only final cleaned tokens - no interim display.
     * Interim results are ignored since terminal text can't be "replaced".
     */
    handleMessage(terminal: vscode.Terminal, msg: ServerMessage): void {
        switch (msg.type) {
            case 'interim':
                // Ignore - terminals can't replace text
                break;

            case 'streaming':
                // Stream each cleaned token directly
                terminal.sendText(msg.token, false);
                break;

            case 'final':
                // Execute voice commands
                for (const cmd of msg.commands) {
                    this.executeCommand(terminal, cmd);
                }
                break;
        }
    }

    private executeCommand(terminal: vscode.Terminal, cmd: VoiceCommand): void {
        switch (cmd.action) {
            case 'enter':
                terminal.sendText('', true);  // Send newline
                break;
            case 'tab':
                terminal.sendText('\t', false);
                break;
            case 'clear':
                terminal.sendText('\u0015', false);  // Ctrl+U
                break;
        }
    }
}
```

### Edge Cases

| Edge Case | Handling |
|-----------|----------|
| User types during dictation | Anchor stays fixed; interim region is tracked separately |
| Rapid interim updates | Each `edit()` is atomic; VS Code queues them in order |
| Editor loses focus | Continue tracking; apply when focus returns |
| User clicks elsewhere | Cancel dictation via `cancel()` method |
| Undo during dictation | Entire dictation undone as single operation |
| Multi-cursor mode | Not supported; use primary cursor only |
| Read-only editor | Show error via status bar, don't insert |

### Complete Message Handler

```typescript
class DictationHandler {
    private editorManager = new InterimTextManager();
    private terminalInserter = new TerminalInserter();

    async handleMessage(msg: ServerMessage): Promise<void> {
        // Determine target based on focus
        if (this.isTerminalFocused()) {
            const terminal = vscode.window.activeTerminal;
            if (terminal) {
                this.terminalInserter.handleMessage(terminal, msg);
            }
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor for dictation');
            return;
        }

        switch (msg.type) {
            case 'interim':
                await this.editorManager.handleInterim(
                    editor,
                    msg.text,
                    msg.is_final
                );
                break;

            case 'streaming':
                await this.editorManager.handleStreamingToken(
                    editor,
                    msg.token,
                    msg.position
                );
                break;

            case 'final':
                await this.editorManager.finalize(editor);
                // Execute voice commands after finalization
                for (const cmd of msg.commands) {
                    await this.executeVoiceCommand(cmd);
                }
                break;

            case 'error':
                await this.editorManager.cancel(editor);
                vscode.window.showErrorMessage(`Dictation error: ${msg.message}`);
                break;
        }
    }

    private isTerminalFocused(): boolean {
        // VS Code doesn't expose this directly; track via events
        return this.currentFocus === 'terminal';
    }
}
```
```

### Special Characters and Formatting

```typescript
function processSpecialTokens(text: string): string {
    // Handle spoken punctuation
    const replacements: Record<string, string> = {
        ' period ': '. ',
        ' comma ': ', ',
        ' question mark ': '? ',
        ' exclamation point ': '! ',
        ' colon ': ': ',
        ' semicolon ': '; ',
        ' new line ': '\n',
        ' new paragraph ': '\n\n',
        ' tab ': '\t',
        ' open paren ': '(',
        ' close paren ': ')',
        ' open bracket ': '[',
        ' close bracket ': ']',
        ' open brace ': '{',
        ' close brace ': '}',
    };

    let processed = text.toLowerCase();
    for (const [spoken, char] of Object.entries(replacements)) {
        processed = processed.replace(new RegExp(spoken, 'gi'), char);
    }

    return processed;
}
```

### Editor Context Preservation

```typescript
async function insertWithContext(text: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // Detect indentation at current line
    const line = editor.document.lineAt(editor.selection.active.line);
    const indent = line.text.match(/^\s*/)?.[0] || '';

    // Apply indentation to multi-line text
    const indentedText = text
        .split('\n')
        .map((line, i) => i === 0 ? line : indent + line)
        .join('\n');

    await editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, indentedText);
    });
}
```

## User Feedback

### Visual Indicators

```typescript
// Show status bar indicator during insertion
const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
);

function showInsertionStatus(text: string): void {
    statusBarItem.text = `$(mic) ${text.substring(0, 30)}...`;
    statusBarItem.show();

    setTimeout(() => statusBarItem.hide(), 2000);
}
```

### Undo Support

```typescript
// Group edits for single undo
async function insertWithUndo(text: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // All edits in this callback are grouped
    await editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, text);
    }, {
        undoStopBefore: true,
        undoStopAfter: true
    });
}
```

## Consequences

### Positive
- Works with editor and terminal
- Respects VS Code conventions
- Undo/redo support
- Streaming display possible

### Negative
- Input box insertion is hacky (clipboard)
- Focus detection not 100% reliable
- Terminal formatting limited

### Edge Cases
- Multiple cursors: Insert at all cursor positions
- Readonly editor: Show error message
- No active element: Show picker to choose target

## Related ADRs
- ADR-001: System Architecture
- ADR-003: Audio Capture Approach
- ADR-006: LLM Post-Processing (interim results protocol, server-side streaming)
- ADR-008: Voice Commands
