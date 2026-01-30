/**
 * VTThought Voice Commands Test Utilities
 *
 * Utilities for testing voice command parsing and execution.
 */

import { CommandParser, ParsedTranscription, VoiceCommand, normalizeCommand } from './voiceCommands';

/**
 * Test case for voice command parsing
 */
export interface CommandTestCase {
    description: string;
    input: string;
    expectedText: string;
    expectedCommands: number;
    expectedActions?: string[];
}

/**
 * Run voice command parser tests
 */
export function runCommandParserTests(parser: CommandParser): TestResult[] {
    const results: TestResult[] = [];

    const testCases: CommandTestCase[] = [
        // Execution Commands
        {
            description: 'Enter command',
            input: 'create a function called hello enter',
            expectedText: 'create a function called hello',
            expectedCommands: 1,
            expectedActions: ['terminal.send-enter']
        },
        {
            description: 'Cancel command',
            input: 'cancel that operation cancel',
            expectedText: 'cancel that operation',
            expectedCommands: 1,
            expectedActions: ['terminal.send-ctrl-c']
        },

        // Editing Commands
        {
            description: 'Undo command',
            input: 'delete that',
            expectedText: '',
            expectedCommands: 1,
            expectedActions: ['undo']
        },
        {
            description: 'Clear line command',
            input: 'some bad code clear line',
            expectedText: 'some bad code',
            expectedCommands: 1,
            expectedActions: ['editor.action.deleteLines']
        },
        {
            description: 'Select all command',
            input: 'select all',
            expectedText: '',
            expectedCommands: 1,
            expectedActions: ['editor.action.selectAll']
        },
        {
            description: 'New line command',
            input: 'if x is true new line',
            expectedText: 'if x is true',
            expectedCommands: 1,
            expectedActions: ['type']
        },
        {
            description: 'Tab command',
            input: 'for i in range tab',
            expectedText: 'for i in range',
            expectedCommands: 1,
            expectedActions: ['type']
        },
        {
            description: 'Redo command',
            input: 'bring it back redo',
            expectedText: 'bring it back',
            expectedCommands: 1,
            expectedActions: ['redo']
        },
        {
            description: 'Copy command',
            input: 'copy this line copy',
            expectedText: 'copy this line',
            expectedCommands: 1,
            expectedActions: ['editor.action.clipboardCopyAction']
        },
        {
            description: 'Cut command',
            input: 'remove this cut',
            expectedText: 'remove this',
            expectedCommands: 1,
            expectedActions: ['editor.action.clipboardCutAction']
        },
        {
            description: 'Paste command',
            input: 'paste it here paste',
            expectedText: 'paste it here',
            expectedCommands: 1,
            expectedActions: ['editor.action.clipboardPasteAction']
        },

        // Navigation Commands
        {
            description: 'Go to line with number',
            input: 'go to line 42',
            expectedText: '',
            expectedCommands: 1,
            expectedActions: ['workbench.action.gotoLine']
        },
        {
            description: 'Scroll up command',
            input: 'scroll up',
            expectedText: '',
            expectedCommands: 1,
            expectedActions: ['editorScroll']
        },
        {
            description: 'Scroll down command',
            input: 'scroll down',
            expectedText: '',
            expectedCommands: 1,
            expectedActions: ['editorScroll']
        },

        // VS Code Commands
        {
            description: 'Save file command',
            input: 'save my work save',
            expectedText: 'save my work',
            expectedCommands: 1,
            expectedActions: ['workbench.action.files.save']
        },
        {
            description: 'Close file command',
            input: 'done with this close file',
            expectedText: 'done with this',
            expectedCommands: 1,
            expectedActions: ['workbench.action.closeActiveEditor']
        },
        {
            description: 'Open terminal command',
            input: 'open terminal',
            expectedText: '',
            expectedCommands: 1,
            expectedActions: ['workbench.action.terminal.toggleTerminal']
        },

        // Dictation Control
        {
            description: 'Stop listening command',
            input: 'that\'s it stop listening',
            expectedText: 'that\'s it',
            expectedCommands: 1,
            expectedActions: ['vtthought.toggleRecording']
        },

        // No command cases
        {
            description: 'No command present',
            input: 'this is just regular text',
            expectedText: 'this is just regular text',
            expectedCommands: 0
        },
        {
            description: 'Code without command',
            input: 'function hello() { return "world"; }',
            expectedText: 'function hello() { return "world"; }',
            expectedCommands: 0
        }
    ];

    for (const testCase of testCases) {
        const result = testParsing(parser, testCase);
        results.push(result);
    }

    return results;
}

/**
 * Test a single parsing case
 */
function testParsing(parser: CommandParser, testCase: CommandTestCase): TestResult {
    try {
        const result: ParsedTranscription = parser.parse(testCase.input);

        const textMatch = result.text === testCase.expectedText;
        const commandCountMatch = result.commands.length === testCase.expectedCommands;

        let actionMatch = true;
        if (testCase.expectedActions && testCase.expectedActions.length > 0) {
            const actualActions = result.commands.map(c => c.action);
            actionMatch = testCase.expectedActions.every(expected =>
                actualActions.includes(expected)
            );
        }

        const passed = textMatch && commandCountMatch && actionMatch;

        return {
            description: testCase.description,
            passed,
            input: testCase.input,
            expectedText: testCase.expectedText,
            actualText: result.text,
            expectedCommands: testCase.expectedCommands,
            actualCommands: result.commands.length,
            expectedActions: testCase.expectedActions,
            actualActions: result.commands.map(c => c.action),
            details: passed ? undefined : {
                textMatch,
                commandCountMatch,
                actionMatch
            }
        };
    } catch (error) {
        return {
            description: testCase.description,
            passed: false,
            input: testCase.input,
            expectedText: testCase.expectedText,
            actualText: '',
            expectedCommands: testCase.expectedCommands,
            actualCommands: 0,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * Test result
 */
export interface TestResult {
    description: string;
    passed: boolean;
    input: string;
    expectedText: string;
    actualText: string;
    expectedCommands: number;
    actualCommands: number;
    expectedActions?: string[];
    actualActions?: string[];
    details?: {
        textMatch: boolean;
        commandCountMatch: boolean;
        actionMatch: boolean;
    };
    error?: string;
}

/**
 * Format test results for display
 */
export function formatTestResults(results: TestResult[]): string {
    const passed = results.filter(r => r.passed).length;
    const total = results.length;

    let output = `Voice Command Test Results: ${passed}/${total} passed\n\n`;

    for (const result of results) {
        const status = result.passed ? '✓' : '✗';
        output += `${status} ${result.description}\n`;

        if (!result.passed) {
            output += `  Input: "${result.input}"\n`;
            output += `  Expected text: "${result.expectedText}"\n`;
            output += `  Actual text: "${result.actualText}"\n`;
            output += `  Expected commands: ${result.expectedCommands}\n`;
            output += `  Actual commands: ${result.actualCommands}\n`;

            if (result.expectedActions) {
                output += `  Expected actions: ${result.expectedActions.join(', ')}\n`;
            }
            if (result.actualActions && result.actualActions.length > 0) {
                output += `  Actual actions: ${result.actualActions.join(', ')}\n`;
            }

            if (result.details) {
                output += `  Details: text=${result.details.textMatch ? '✓' : '✗'}, `;
                output += `count=${result.details.commandCountMatch ? '✓' : '✗'}, `;
                output += `action=${result.details.actionMatch ? '✓' : '✗'}\n`;
            }

            if (result.error) {
                output += `  Error: ${result.error}\n`;
            }

            output += '\n';
        }
    }

    return output;
}

/**
 * Interactive command testing utility
 * Returns a function that can be used to test commands
 */
export function createCommandTester(parser: CommandParser) {
    return {
        /**
         * Test a single transcription
         */
        test(transcription: string): ParsedTranscription {
            return parser.parse(transcription);
        },

        /**
         * Show command breakdown for a transcription
         */
        analyze(transcription: string): CommandAnalysis {
            const result = parser.parse(transcription);

            return {
                original: transcription,
                cleaned: result.text,
                commandsFound: result.commands.length,
                commands: result.commands.map(cmd => ({
                    action: cmd.action,
                    params: cmd.params,
                    isTerminal: cmd.terminal || false
                })),
                hasTrailingCommand: result.hasTrailingCommand
            };
        },

        /**
         * Get all available command triggers
         */
        getAllTriggers(): string[] {
            const commands = parser.getCommandList();
            const triggers = new Set<string>();
            for (const cmd of commands) {
                for (const trigger of cmd.trigger) {
                    triggers.add(trigger);
                }
            }
            return Array.from(triggers).sort();
        }
    };
}

/**
 * Command analysis result
 */
export interface CommandAnalysis {
    original: string;
    cleaned: string;
    commandsFound: number;
    commands: Array<{
        action: string;
        params?: Record<string, unknown>;
        isTerminal: boolean;
    }>;
    hasTrailingCommand: boolean;
}

/**
 * Test homophone normalization
 */
export function testHomophoneNormalization(normalizeFn: (text: string) => string): HomophoneTestResult[] {
    const tests: Array<{ input: string; expected: string; description: string }> = [
        { input: 'inter that', expected: 'enter that', description: 'inter -> enter' },
        { input: 'un do that', expected: 'undo that', description: 'un do -> undo' },
        { input: 'copy that line', expected: 'copy that line', description: 'copy unchanged' },
        { input: 'select the word', expected: 'select word', description: 'select the -> select' },
        { input: 'skroll up', expected: 'scroll up', description: 'skroll -> scroll' },
    ];

    return tests.map(test => {
        const result = normalizeFn(test.input);
        return {
            description: test.description,
            input: test.input,
            expected: test.expected,
            actual: result,
            passed: result === test.expected
        };
    });
}

/**
 * Homophone test result
 */
export interface HomophoneTestResult {
    description: string;
    input: string;
    expected: string;
    actual: string;
    passed: boolean;
}
