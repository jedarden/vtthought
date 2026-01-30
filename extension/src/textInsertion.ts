/**
 * VTThought Text Insertion (ADR-007)
 *
 * Manages text insertion into VS Code editor and terminal.
 * Implements interim text display with atomic rewriting.
 */

import * as vscode from 'vscode';
import { SetupFlow } from './setupFlow';

/**
 * Server message types from backend WebSocket.
 */
export type ServerMessage =
    | { type: 'interim'; text: string; is_final: boolean; confidence: number; changes: TextChange[] }  // eslint-disable-line @typescript-eslint/naming-convention
    | { type: 'streaming'; token: string; position: number }
    | { type: 'final'; raw: string; cleaned: string; commands: VoiceCommand[] }
    | { type: 'error'; code: string; message: string };

/**
 * Text edit operation for interim updates.
 */
export interface TextChange {
    start: number;
    deleteCount: number;
    insert: string;
}

/**
 * Voice command to execute.
 */
export interface VoiceCommand {
    action: string;
    params?: Record<string, unknown>;
    terminal?: boolean;
}

/**
 * Manages interim text display with rewriting support.
 *
 * Key concepts:
 * - anchor: Fixed position where dictation started (never moves)
 * - interimLength: Current length of interim text (for calculating replacement range)
 * - Atomic replacement: Uses editBuilder.replace() for flicker-free updates
 * - Undo grouping: All interim edits are one undo operation
 *
 * Implements the interim text manager from ADR-007.
 */
export class InterimTextManager {
    // Fixed starting point - never moves during dictation
    private anchor: vscode.Position | null = null;

    // Current interim text length for calculating replacement range
    private interimLength = 0;

    // Decoration for gray/italic interim styling
    private readonly interimStyle: vscode.TextEditorDecorationType;

    constructor() {
        this.interimStyle = vscode.window.createTextEditorDecorationType({
            color: new vscode.ThemeColor('editorGhostText.foreground'),
            fontStyle: 'italic',
            // Optional: add subtle background
            backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
        });
    }

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
        if (!this.anchor) {
            return;
        }

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
        if (!this.anchor) {
            return;
        }

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

    dispose(): void {
        this.interimStyle.dispose();
    }
}

/**
 * Handles text insertion into terminal.
 */
export class TerminalInserter {
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
            case 'cancel':
                terminal.sendText('\x03', false);  // Ctrl+C
                break;
        }
    }
}

/**
 * Complete dictation handler for both editor and terminal.
 */
export class DictationHandler {
    private readonly editorManager = new InterimTextManager();
    private readonly terminalInserter = new TerminalInserter();

    private currentFocus: 'editor' | 'terminal' | 'other' = 'other';
    private context?: vscode.ExtensionContext;

    constructor(context?: vscode.ExtensionContext) {
        this.context = context;
        this.trackFocus();
    }

    /**
     * Set the extension context for first transcription celebration
     */
    public setContext(context: vscode.ExtensionContext): void {
        this.context = context;
    }

    /**
     * Track focus state between editor and terminal.
     */
    private trackFocus(): void {
        vscode.window.onDidChangeActiveTextEditor(() => {
            this.currentFocus = 'editor';
        });

        vscode.window.onDidChangeActiveTerminal(() => {
            this.currentFocus = 'terminal';
        });

        vscode.window.onDidChangeWindowState((state) => {
            if (!state.focused) {
                this.currentFocus = 'other';
            }
        });
    }

    /**
     * Handle server message and route to appropriate target.
     */
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

                // First transcription celebration (ADR-017)
                if (this.context && msg.cleaned && msg.cleaned.length > 0) {
                    await SetupFlow.onFirstTranscription(this.context, msg.cleaned);
                }

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
        // VS Code doesn't expose this directly; we track via events
        return this.currentFocus === 'terminal';
    }

    private async executeVoiceCommand(cmd: VoiceCommand): Promise<void> {
        if (cmd.terminal) {
            const terminal = vscode.window.activeTerminal;
            if (!terminal) {
                return;
            }

            switch (cmd.action) {
                case 'enter':
                    terminal.sendText('', true);
                    break;
                case 'cancel':
                    terminal.sendText('\x03', false);
                    break;
            }
        } else {
            // VS Code command
            await vscode.commands.executeCommand(cmd.action, cmd.params);
        }
    }

    dispose(): void {
        this.editorManager.dispose();
    }
}
