/**
 * VTThought Voice Commands (ADR-008)
 *
 * Parses and executes voice commands from transcriptions.
 * Implements keyword-based command detection.
 */

import * as vscode from 'vscode';
import { CustomVoiceCommand } from './userPreferences';

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
    {
        trigger: ['redo'],
        action: 'redo'
    },
    {
        trigger: ['copy', 'copy that'],
        action: 'editor.action.clipboardCopyAction'
    },
    {
        trigger: ['cut', 'cut that'],
        action: 'editor.action.clipboardCutAction'
    },
    {
        trigger: ['paste'],
        action: 'editor.action.clipboardPasteAction'
    },
    {
        trigger: ['select word'],
        action: 'editor.action.wordSelect.drag'
    },
    {
        trigger: ['select line'],
        action: 'editor.action.selectLines'
    },
    {
        trigger: ['duplicate line'],
        action: 'editor.action.duplicateSelection'
    },
    {
        trigger: ['move line up', 'move up'],
        action: 'editor.action.moveLinesUpAction'
    },
    {
        trigger: ['move line down', 'move down'],
        action: 'editor.action.moveLinesDownAction'
    },
    {
        trigger: ['indent', 'indent line'],
        action: 'editor.action.indentLines'
    },
    {
        trigger: ['outdent', 'unindent'],
        action: 'editor.action.outdentLines'
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
    {
        trigger: ['scroll up'],
        action: 'editorScroll',
        params: () => ({ to: 'up', by: 'line' })
    },
    {
        trigger: ['scroll down'],
        action: 'editorScroll',
        params: () => ({ to: 'down', by: 'line' })
    },
    {
        trigger: ['scroll to top'],
        action: 'editorScroll',
        params: () => ({ to: 'top' })
    },
    {
        trigger: ['scroll to bottom'],
        action: 'editorScroll',
        params: () => ({ to: 'bottom' })
    },
    {
        trigger: ['go to start', 'go to beginning'],
        action: 'cursorHome'
    },
    {
        trigger: ['go to end'],
        action: 'cursorEnd'
    },

    // VS Code Commands
    {
        trigger: ['save file', 'save'],
        action: 'workbench.action.files.save'
    },
    {
        trigger: ['save all'],
        action: 'workbench.action.files.saveAll'
    },
    {
        trigger: ['close file', 'close tab'],
        action: 'workbench.action.closeActiveEditor'
    },
    {
        trigger: ['close all'],
        action: 'workbench.action.closeAllEditors'
    },
    {
        trigger: ['open terminal', 'show terminal'],
        action: 'workbench.action.terminal.toggleTerminal'
    },
    {
        trigger: ['new terminal'],
        action: 'workbench.action.terminal.new'
    },
    {
        trigger: ['command palette'],
        action: 'workbench.action.showCommands'
    },
    {
        trigger: ['file explorer', 'show sidebar'],
        action: 'workbench.view.explorer'
    },
    {
        trigger: ['search', 'find in files'],
        action: 'workbench.view.search'
    },
    {
        trigger: ['toggle sidebar', 'hide sidebar'],
        action: 'workbench.action.toggleSidebarVisibility'
    },
    {
        trigger: ['format document', 'format code'],
        action: 'editor.action.formatDocument'
    },
    {
        trigger: ['toggle word wrap'],
        action: 'editor.action.toggleWordWrap'
    },

    // Dictation Control
    {
        trigger: ['stop listening', 'pause'],
        action: 'vtthought.toggleRecording'
    }
];

/**
 * Parses voice commands from transcription.
 * Implements keyword-based command detection from ADR-008.
 */
export class CommandParser {
    private commands: VoiceCommand[];
    private detectionMode: 'trailing' | 'anywhere';
    private customCommands: CustomVoiceCommand[] = [];

    constructor(commands?: VoiceCommand[], detectionMode: 'trailing' | 'anywhere' = 'trailing') {
        this.commands = commands ?? VOICE_COMMANDS;
        this.detectionMode = detectionMode;
    }

    /**
     * Create a parser with custom commands from VS Code settings
     */
    static withSettings(customVoiceCommands?: CustomVoiceCommand[]): CommandParser {
        const config = vscode.workspace.getConfiguration('vtthought');

        // Get disabled commands
        const disabledActions = new Set(
            config.get<string[]>('disabledCommands', [])
        );

        // Start with built-in commands
        let commands = VOICE_COMMANDS.filter(cmd => !disabledActions.has(cmd.action));

        // Add custom commands from settings
        const customCommands = config.get<any[]>('customCommands', []);
        for (const custom of customCommands) {
            if (custom.trigger && custom.action) {
                commands.push({
                    trigger: custom.trigger,
                    action: custom.action,
                    params: custom.params ? () => custom.params : undefined,
                    terminal: custom.terminal || false
                });
            }
        }

        // Add custom voice commands from backend (ADR-011)
        if (customVoiceCommands) {
            for (const custom of customVoiceCommands.filter(c => c.enabled)) {
                commands.push({
                    trigger: custom.triggers,
                    action: custom.action,
                    params: custom.params && Object.keys(custom.params).length > 0
                        ? () => custom.params!
                        : undefined,
                    terminal: false
                });
            }
        }

        const detectionMode = config.get<'trailing' | 'anywhere'>('commandDetection', 'trailing');

        const parser = new CommandParser(commands, detectionMode);
        parser.customCommands = customVoiceCommands ?? [];
        return parser;
    }

    /**
     * Update custom commands after initial construction
     */
    updateCustomCommands(customVoiceCommands: CustomVoiceCommand[]): void {
        this.customCommands = customVoiceCommands;

        const config = vscode.workspace.getConfiguration('vtthought');

        // Get disabled commands
        const disabledActions = new Set(
            config.get<string[]>('disabledCommands', [])
        );

        // Start with built-in commands
        let commands = VOICE_COMMANDS.filter(cmd => !disabledActions.has(cmd.action));

        // Add custom commands from settings
        const customCommands = config.get<any[]>('customCommands', []);
        for (const custom of customCommands) {
            if (custom.trigger && custom.action) {
                commands.push({
                    trigger: custom.trigger,
                    action: custom.action,
                    params: custom.params ? () => custom.params : undefined,
                    terminal: custom.terminal || false
                });
            }
        }

        // Add custom voice commands from backend
        for (const custom of customVoiceCommands.filter(c => c.enabled)) {
            commands.push({
                trigger: custom.triggers,
                action: custom.action,
                params: custom.params && Object.keys(custom.params).length > 0
                    ? () => custom.params!
                    : undefined,
                terminal: false
            });
        }

        this.commands = commands;
    }

    parse(transcription: string): ParsedTranscription {
        let text = transcription;
        const foundCommands: Command[] = [];

        // Check for commands based on detection mode
        for (const cmd of this.commands) {
            for (const trigger of cmd.trigger) {
                const regex = this.detectionMode === 'trailing'
                    ? new RegExp(`\\s*${this.escapeRegex(trigger)}\\s*$`, 'i')
                    : new RegExp(`\\b${this.escapeRegex(trigger)}\\b`, 'gi');

                let match: RegExpExecArray | null;
                while ((match = regex.exec(text)) !== null) {
                    // Remove command from text
                    text = text.replace(regex, '').trim();

                    foundCommands.push({
                        action: cmd.action,
                        params: cmd.params?.(transcription) ?? undefined,
                        terminal: cmd.terminal
                    });

                    if (this.detectionMode === 'trailing') {
                        break; // Only check first match for trailing mode
                    }
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

    /**
     * Get all available commands for display
     */
    getCommandList(): VoiceCommand[] {
        return this.commands;
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
    'undo': ['un do', 'and do'],
    'redo': ['re do', 're-do'],
    'copy': ['copy that', 'copi'],
    'cut': ['cut that'],
    'paste': ['pace'],
    'select': ['salect', 'select the'],
    'save': ['saev'],
    'close': ['clothes', 'close the'],
    'scroll': ['skroll'],
    'format': ['form at'],
    'indent': ['in dent'],
    'tab': ['tabb']
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
