# ADR-008: Voice Commands

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

Users need to control VS Code and trigger actions (Enter, send, delete) via voice. This requires parsing voice commands from transcription and executing appropriate VS Code actions.

## Decision Drivers

- **Natural language**: Commands should feel natural to speak
- **Reliability**: Commands must be recognized accurately
- **Extensibility**: Easy to add new commands
- **Non-interference**: Commands shouldn't trigger accidentally

## Command Categories

```
┌──────────────────────────────────────────────────────────────────────┐
│                    VOICE COMMAND CATEGORIES                           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  1. EXECUTION COMMANDS (Terminal/Claude Code)                         │
│     ├─ "enter" / "send" / "submit"    → Execute command              │
│     ├─ "run that"                     → Execute and wait             │
│     └─ "cancel"                       → Ctrl+C                       │
│                                                                       │
│  2. EDITING COMMANDS                                                  │
│     ├─ "delete that" / "undo"         → Delete last input            │
│     ├─ "clear line"                   → Clear current line           │
│     ├─ "select all"                   → Select all text              │
│     └─ "new line"                     → Insert line break            │
│                                                                       │
│  3. NAVIGATION COMMANDS                                               │
│     ├─ "go to line [N]"               → Navigate to line             │
│     ├─ "go to file [name]"            → Open file                    │
│     └─ "scroll up/down"               → Scroll view                  │
│                                                                       │
│  4. VS CODE COMMANDS                                                  │
│     ├─ "save file"                    → Ctrl+S                       │
│     ├─ "close file"                   → Close active editor          │
│     ├─ "open terminal"                → Toggle terminal              │
│     └─ "command palette"              → Ctrl+Shift+P                 │
│                                                                       │
│  5. DICTATION CONTROL                                                 │
│     ├─ "stop listening"               → Pause voice input            │
│     ├─ "scratch that"                 → Delete last dictation        │
│     └─ "correction: [word]"           → Replace last word            │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Options Considered

### Option A: Keyword Detection (Recommended)

Parse commands from the transcription using keyword matching.

```typescript
interface VoiceCommand {
    trigger: string[];           // Phrases that trigger this command
    action: string;              // VS Code command to execute
    params?: (match: string) => any;  // Extract parameters
    terminal?: boolean;          // Is this a terminal command?
}

const VOICE_COMMANDS: VoiceCommand[] = [
    // Execution
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

    // Editing
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

    // Navigation
    {
        trigger: ['go to line'],
        action: 'workbench.action.gotoLine',
        params: (match) => {
            const num = match.match(/go to line (\d+)/)?.[1];
            return num ? { lineNumber: parseInt(num) } : null;
        }
    },

    // VS Code
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

    // Dictation control
    {
        trigger: ['stop listening', 'pause'],
        action: 'voicecode.stopListening'
    }
];
```

**Pros:**
- Predictable behavior
- Fast execution
- No LLM required

**Cons:**
- Limited to predefined commands
- No fuzzy matching

### Option B: LLM-Based Command Parsing

Use the LLM to interpret intent and generate commands.

```python
COMMAND_PROMPT = """Parse voice commands from the transcription.

Available commands:
- ENTER: Send the command (trigger: "enter", "send", "submit")
- CANCEL: Cancel current operation (trigger: "cancel", "stop")
- UNDO: Undo last action (trigger: "undo", "delete that")
- GOTO_LINE: Go to line number (trigger: "go to line N")
- TEXT: Regular text to insert

Input: "{text}"

Output JSON:
{{"type": "COMMAND_TYPE", "params": {{}}, "remaining_text": "text after command"}}

Examples:
Input: "create a function called hello enter"
Output: {{"commands": [{{"type": "TEXT", "value": "create a function called hello"}}, {{"type": "ENTER"}}]}}

Input: "go to line 42"
Output: {{"commands": [{{"type": "GOTO_LINE", "params": {{"line": 42}}}}]}}
"""
```

**Pros:**
- Handles variations naturally
- Can understand context
- Extensible via prompt

**Cons:**
- Additional latency
- May misinterpret
- Requires LLM call

### Option C: Hybrid (Keyword + LLM Fallback)

Try keyword matching first, use LLM for ambiguous cases.

```typescript
async function parseCommands(text: string): Promise<ParsedResult> {
    // Try keyword matching first
    const keywordResult = parseWithKeywords(text);

    if (keywordResult.confident) {
        return keywordResult;
    }

    // Fall back to LLM for complex cases
    return await parseWithLLM(text);
}

function parseWithKeywords(text: string): ParsedResult {
    const commands: Command[] = [];
    let remainingText = text.toLowerCase();

    for (const cmd of VOICE_COMMANDS) {
        for (const trigger of cmd.trigger) {
            if (remainingText.endsWith(trigger)) {
                commands.push({
                    action: cmd.action,
                    params: cmd.params?.(remainingText)
                });
                remainingText = remainingText.slice(0, -trigger.length).trim();
            }
        }
    }

    return {
        commands,
        text: remainingText,
        confident: commands.length > 0 || !containsCommandLikeWords(remainingText)
    };
}
```

## Decision

**Option A: Keyword Detection** with well-defined command vocabulary

Rationale:
1. Predictable, consistent behavior
2. No additional latency
3. Users can learn the vocabulary
4. Commands are clearly separated from text

## Implementation Details

### Command Parser

```typescript
interface ParsedTranscription {
    text: string;              // Text to insert
    commands: Command[];       // Commands to execute
    hasTrailingCommand: boolean;  // Ends with a command
}

class CommandParser {
    private commands: VoiceCommand[];

    constructor(commands: VoiceCommand[]) {
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
                        params: cmd.params?.(transcription),
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
```

### Command Executor

```typescript
class CommandExecutor {
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
        if (!terminal) return;

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
        }
    }
}
```

### Integration with Transcription Pipeline

```typescript
async function processTranscription(rawText: string): Promise<void> {
    // 1. Clean up with LLM
    const cleanedText = await llmCleanup(rawText);

    // 2. Parse commands
    const parsed = commandParser.parse(cleanedText);

    // 3. Insert text (if any)
    if (parsed.text) {
        await insertText(parsed.text);
    }

    // 4. Execute commands
    for (const cmd of parsed.commands) {
        await commandExecutor.execute(cmd);
    }
}
```

### Configurable Commands

Allow users to customize in settings:

```json
// settings.json
{
    "voicecode.customCommands": [
        {
            "trigger": ["deploy", "ship it"],
            "action": "workbench.action.tasks.runTask",
            "params": { "task": "deploy" }
        },
        {
            "trigger": ["format code", "prettify"],
            "action": "editor.action.formatDocument"
        }
    ]
}
```

### Command Disambiguation

Handle similar-sounding words:

```typescript
const HOMOPHONES: Record<string, string[]> = {
    'enter': ['inter', 'inner'],
    'send': ['sent', 'scent'],
    'delete': ['the lead', 'dilute'],
    'undo': ['un do', 'and do']
};

function normalizeCommand(text: string): string {
    let normalized = text.toLowerCase();
    for (const [correct, variants] of Object.entries(HOMOPHONES)) {
        for (const variant of variants) {
            normalized = normalized.replace(variant, correct);
        }
    }
    return normalized;
}
```

### Claude Code Specific Commands

```typescript
const CLAUDE_CODE_COMMANDS: VoiceCommand[] = [
    {
        trigger: ['send to claude', 'ask claude', 'hey claude'],
        action: 'voicecode.sendToClaude',
        terminal: true
    },
    {
        trigger: ['accept', 'yes', 'confirm', 'approve'],
        action: 'voicecode.claudeAccept',
        terminal: true
    },
    {
        trigger: ['reject', 'no', 'deny', 'cancel'],
        action: 'voicecode.claudeReject',
        terminal: true
    },
    {
        trigger: ['show diff', 'view changes'],
        action: 'voicecode.claudeShowDiff',
        terminal: true
    }
];
```

## Consequences

### Positive
- Predictable command execution
- Fast response (no LLM needed)
- Clear command vocabulary
- User-customizable

### Negative
- Users must learn command phrases
- No natural language flexibility
- May miss variations

### Best Practices for Users
1. Say command clearly at the end: "create a function called hello **enter**"
2. Pause slightly before command
3. Use exact trigger phrases
4. Commands only recognized at end of utterance

## Related ADRs
- ADR-006: LLM Post-Processing
- ADR-007: Text Insertion
