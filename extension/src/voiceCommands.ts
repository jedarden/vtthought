/**
 * VTThought Voice Commands (ADR-008)
 *
 * Parses and executes voice commands from transcriptions.
 * Implements keyword-based command detection.
 */

import * as vscode from 'vscode';

/**
 * Voice command definition.
 */
export interface VoiceCommand {
    trigger: string[];           // Phrases that trigger this command
    action: string;              // VS Code command to execute
    params?: (match: string) => Record<string, unknown> | null;  // Extract parameters
    terminal?: boolean;          // Is this a terminal command?
}

/**
 * Parsed transcription result.
 */
export interface ParsedTranscription {
    text: string;              // Text to insert (with commands removed)
    commands: Command[];       // Commands to execute
    hasTrailingCommand: boolean;  // Ends with a command
}

/**
 * Parsed command ready for execution.
 */
export interface Command {
    action: string;
    params?: Record<string, unknown>;
    terminal?: boolean;
}

/**
 * Voice command registry.
 * Based on ADR-008 command categories.
 */
const VOICE_COMMANDS: VoiceCommand[] = [
    // Execution Commands (Terminal/Claude Code)
    {
        trigger: ['enter', 'send', 'submit', 'run that', 'execute'],
        action: 'terminal.send-enter',
        terminal: true
    },
    {
        trigger: ['cancel', 'stop that', 'abort'],
        action: 'terminal.send-ctrl-c',
        terminal: true
    },

    // Editing Commands
    {
        trigger: ['delete that', 'undo', 'scratch that'],
        action: 'undo'
    },
    {
        trigger: ['clear line', 'delete line'],
        action: 'editor.action.deleteLines'
    },
    {
        trigger: ['select all'],
        action: 'editor.action.selectAll'
    },
    {
        trigger: ['new line', 'newline'],
        action: 'type',
        params: () => ({ text: '\n' })
    },
    {
        trigger: ['tab'],
        action: 'type',
        params: () => ({ text: '\t' })
    },

    // Navigation Commands
    {
        trigger: ['go to line'],
        action: 'workbench.action.gotoLine',
        params: (match) => {
            const num = match.match(/go to line (\d+)/i)?.[1];
            return num ? { lineNumber: parseInt(num) } : null;
        }
    },

    // VS Code Commands
    {
        trigger: ['save file', 'save'],
        action: 'workbench.action.files.save'
    },
    {
        trigger: ['close file', 'close tab'],
        action: 'workbench.action.closeActiveEditor'
    },
    {
        trigger: ['open terminal', 'show terminal'],
        action: 'workbench.action.terminal.toggleTerminal'
    },
    {
        trigger: ['command palette'],
        action: 'workbench.action.showCommands'
    },

    // Dictation Control
    {
        trigger: ['stop listening', 'pause'],
        action: 'voicecode.stopListening'
    }
];

/**
 * Parses voice commands from transcription.
 * Implements keyword-based command detection from ADR-008.
 */
export class CommandParser {
    private commands: VoiceCommand[];

    constructor(commands: VoiceCommand[] = VOICE_COMMANDS) {
        this.commands = commands;
    }

    parse(transcription: string): ParsedTranscription {
        let text = transcription;
        const foundCommands: Command[] = [];

        // Check for commands at the end of transcription
        for (const cmd of this.commands) {
            for (const trigger of cmd.trigger) {
                const regex = new RegExp(`\\s*${this.escapeRegex(trigger)}\\s*$`, 'i');
                if (regex.test(text)) {
                    text = text.replace(regex, '').trim();
                    foundCommands.push({
                        action: cmd.action,
                        params: cmd.params?.(transcription) ?? undefined,
                        terminal: cmd.terminal
                    });
                }
            }
        }

        return {
            text,
            commands: foundCommands.reverse(),  // Execute in order spoken
            hasTrailingCommand: foundCommands.length > 0
        };
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

/**
 * Executes parsed voice commands.
 */
export class CommandExecutor {
    async execute(command: Command): Promise<void> {
        if (command.terminal) {
            await this.executeTerminalCommand(command);
        } else {
            await vscode.commands.executeCommand(
                command.action,
                command.params
            );
        }
    }

    private async executeTerminalCommand(command: Command): Promise<void> {
        const terminal = vscode.window.activeTerminal;
        if (!terminal) {
            vscode.window.showWarningMessage('No active terminal for command');
            return;
        }

        switch (command.action) {
            case 'terminal.send-enter':
                terminal.sendText('', true);  // Empty string with execute=true
                break;
            case 'terminal.send-ctrl-c':
                terminal.sendText('\x03', false);
                break;
            case 'terminal.clear-line':
                terminal.sendText('\u0015', false);  // Ctrl+U
                break;
            default:
                vscode.window.showWarningMessage(`Unknown terminal command: ${command.action}`);
        }
    }
}

/**
 * Disambiguation for homophones (similar-sounding words).
 * From ADR-008.
 */
const HOMOPHONES: Record<string, string[]> = {
    'enter': ['inter', 'inner'],
    'send': ['sent', 'scent'],
    'delete': ['the lead', 'dilute'],
    'undo': ['un do', 'and do']
};

/**
 * Normalize text by applying homophone corrections.
 */
export function normalizeCommand(text: string): string {
    let normalized = text.toLowerCase();
    for (const [correct, variants] of Object.entries(HOMOPHONES)) {
        for (const variant of variants) {
            normalized = normalized.replace(variant, correct);
        }
    }
    return normalized;
}

/**
 * Process transcription and execute commands.
 * Full pipeline from ADR-008.
 */
export async function processTranscription(rawText: string): Promise<void> {
    const parser = new CommandParser();
    const executor = new CommandExecutor();

    // Parse commands
    const parsed = parser.parse(rawText);

    // Insert text (if any)
    if (parsed.text) {
        await insertText(parsed.text);
    }

    // Execute commands
    for (const cmd of parsed.commands) {
        await executor.execute(cmd);
    }
}

/**
 * Insert text at cursor position.
 */
async function insertText(text: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    await editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, text);
    });
}

// Export default parser instance
export const commandParser = new CommandParser();
export const commandExecutor = new CommandExecutor();
