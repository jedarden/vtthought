# VTThought User Guide

Complete guide to using VTThought - a voice-to-code VS Code extension.

## Table of Contents

- [Getting Started](#getting-started)
- [Basic Usage](#basic-usage)
- [Voice Commands](#voice-commands)
- [Personalization](#personalization)
- [Advanced Configuration](#advanced-configuration)
- [Tips and Best Practices](#tips-and-best-practices)

---

## Getting Started

### First-Time Setup

After installing VTThought, the first-run wizard will guide you through:

1. **Backend Connection** - Enter your backend URL
2. **Authentication** - Paste your extension token
3. **Microphone Permission** - Allow microphone access
4. **Connection Test** - Verify everything works

### The Status Bar

Once connected, you'll see the VTThought status bar icon:

```
?? VTThought
```

**Status States:**
- `?? (mic-off)` - Disconnected or not recording
- `?? (mic)` - Ready to record
- `?? (record)` - Currently recording

**Click the status bar** to:
- Start/stop recording
- Open settings
- View connection status
- Manage vocabulary

---

## Basic Usage

### Push-to-Talk (Default)

**1. Position your cursor** where you want text to appear

**2. Hold the hotkey** (default: `Ctrl+Alt+V` on Windows/Linux, `Cmd+Alt+V` on Mac)

**3. Speak** clearly and naturally

**4. Release the hotkey** to stop recording

**5. Text appears** in your editor after processing

### What You'll See

While recording:
- **Status bar**: Shows recording state with ?? (record)
- **Voice Input panel**: Shows live audio level meter
- **Interim text**: Gray, italic text shows transcription in progress

After releasing:
- **Processing**: Backend transcribes and cleans up text
- **Final text**: Replaces interim text with polished result
- **Commands**: Voice commands are executed automatically

### Example Dictation

```
You say: "create a new function called calculate sum that takes two numbers"

Result:
function calculateSum(a, b) {
    return a + b;
}
```

```
You say: "add a for loop that iterates from zero to ten"

Result:
for (let i = 0; i <= 10; i++) {
}
```

---

## Voice Commands

VTThought recognizes voice commands to control your editor without touching the keyboard.

### How Commands Work

Commands are detected based on your **Command Detection** setting:

- **Trailing (default)**: Commands only detected at the **end** of your speech
  - "print hello world **new line**" ?? prints "print hello world", then moves to next line
  - "create a function called foo **enter**" ?? creates function, then adds new line

- **Anywhere**: Commands detected **anywhere** in your speech
  - "**save file**" ?? saves immediately
  - "call the function **enter** and return" ?? inserts text, then adds new line

### Command Categories

#### Editing Commands

| Phrase | Action |
|--------|--------|
| "undo" | Undo last action |
| "redo" | Redo last action |
| "copy" | Copy selection |
| "cut" | Cut selection |
| "paste" | Paste |
| "delete line" / "clear line" | Delete current line |
| "select all" | Select all text |
| "select word" | Select current word |
| "select line" | Select current line |
| "duplicate line" | Duplicate current line |
| "move line up" | Move current line up |
| "move line down" | Move current line down |
| "indent" / "tab" | Indent selection |
| "outdent" | Outdent selection |

#### Navigation Commands

| Phrase | Action |
|--------|--------|
| "go to line [number]" | Jump to line number |
| "go to start" | Go to start of file |
| "go to end" | Go to end of file |
| "scroll up" | Scroll up |
| "scroll down" | Scroll down |
| "scroll to top" | Scroll to top of file |
| "scroll to bottom" | Scroll to bottom of file |

#### Execution Commands

| Phrase | Action |
|--------|--------|
| "enter" / "new line" | Insert new line |
| "send" / "submit" | Send in terminal |
| "cancel" | Cancel current operation |

#### VS Code Commands

| Phrase | Action |
|--------|--------|
| "save" / "save file" | Save current file |
| "save all" | Save all files |
| "close" / "close file" | Close current file |
| "close all" | Close all files |
| "new terminal" | Create new terminal |
| "toggle terminal" | Show/hide terminal |
| "toggle sidebar" | Show/hide sidebar |
| "file explorer" | Show file explorer |
| "search" | Open search |
| "format document" | Format current document |
| "toggle word wrap" | Toggle word wrap |

### Custom Commands

Add your own voice commands in VS Code settings:

1. Open Settings (Ctrl+,)
2. Search for "vtthought.customCommands"
3. Add commands in JSON format:

```json
"vtthought.customCommands": [
  {
    "trigger": ["run tests", "test it", "run test"],
    "action": "workbench.action.tasks.test"
  },
  {
    "trigger": ["git push"],
    "action": "git.push"
  }
]
```

### Disable Commands

Disable specific commands you don't use:

```json
"vtthought.disabledCommands": [
  "workbench.action.closeAllEditors"
]
```

### Test Commands

**List all commands:**
- Command Palette → "VTThought: List Voice Commands"

**Test command parsing:**
- Command Palette → "VTThought: Analyze Voice Command"
- Type any text to see what commands would be detected

---

## Personalization

VTThought learns from your usage to improve accuracy.

### Vocabulary Management

Add technical terms, project names, and abbreviations that VTThought should recognize.

**Open Vocabulary Manager:**
- Command Palette → "VTThought: Manage Vocabulary"

**Vocabulary Categories:**
- **Technical**: Programming terms (API, HTTP, JSON)
- **Project**: Project-specific names (e.g., "MyApp", "DataStore")
- **Names**: People's names (e.g., "Alice", "Bob")
- **Acronyms**: Abbreviations (e.g., "API", "URL", "HTTP")
- **General**: Other words you use frequently

**Adding a Term:**
1. Select "Add vocabulary term"
2. Enter the word (e.g., "TypeScript")
3. Choose a category (e.g., "technical")
4. Optionally add phonetic hint (e.g., "type-script" for "TypeScript")

**Example Vocabulary:**
```
Term: Kubernetes, Category: technical, Phonetic: koo-ber-net-ees
Term: pytest, Category: technical, Phonetic: pie-test
Term: JSX, Category: acronyms, Phonetic: J-S-X
```

### Style Preferences

VTThought learns your punctuation, capitalization, and formatting preferences.

**View Learned Preferences:**
- Command Palette → "VTThought: Show Style Preferences"

VTThought tracks:
- **Punctuation**: Oxford comma usage, em dash preference
- **Capitalization**: How you capitalize code comments vs prose
- **Numbers**: "5" vs "five"
- **Abbreviations**: "don't" vs "do not"

### Learned Corrections

VTThought remembers corrections you make to transcriptions.

**View Learned Corrections:**
- Command Palette → "VTThought: Show Learned Corrections"

**Example:**
- If you frequently change "api" to "API", VTThought learns this pattern
- Corrections are automatically applied to future transcriptions

**Clear Corrections:**
- Select "Clear all learned corrections" to reset learning

### Edit Learning (Automatic)

VTThought tracks edits you make to transcribed text within a learning window (default: 30 seconds).

**Disable Edit Learning:**
```json
"vtthought.enableEditLearning": false
```

**Adjust Learning Window:**
```json
"vtthought.editLearningWindowMs": 60000  // 60 seconds
```

---

## Advanced Configuration

### Backend Settings

Configure in `.env` file or docker-compose.yml:

| Setting | Description | Default |
|---------|-------------|---------|
| `STT_MODEL` | Whisper model size | `base` |
| `STT_DEVICE` | Device type | `auto` |
| `STT_COMPUTE_TYPE` | Precision | `float16` |
| `LLM_MODEL` | Ollama model | `llama3.1:8b` |
| `LLM_TEMPERATURE` | LLM creativity | `0.3` |

### Extension Settings

Configure in VS Code Settings (search "vtthought"):

| Setting | Description | Default |
|---------|-------------|---------|
| `backendUrl` | Backend WebSocket URL | `ws://localhost:8000/api/ws/audio` |
| `apiUrl` | Backend API URL | `http://localhost:8000` |
| `pushToTalkEnabled` | Hold hotkey to record | `true` |
| `autoConnect` | Auto-connect on startup | `true` |
| `commandDetection` | Command detection mode | `trailing` |
| `showCommandFeedback` | Show command notifications | `true` |
| `enableEditLearning` | Learn from edits | `true` |

### Change Hotkey

1. Open VS Code Settings
2. Search for "vtthought.toggleRecording"
3. Click the pencil icon to set a new keybinding

---

## Tips and Best Practices

### For Best Accuracy

1. **Speak clearly and naturally** - Don't over-enunciate
2. **Use technical vocabulary** - Add project-specific terms
3. **Good microphone** - Use a quality headset mic
4. **Quiet environment** - Reduce background noise
5. **Consistent commands** - Use the same phrases for commands

### Efficient Workflows

**Dictate and Edit:**
```
1. Hold hotkey → "create a function called fetch user that takes user id"
2. Edit the generated code as needed
3. VTThought learns from your edits
```

**Voice Commands for Speed:**
```
"create function" → "enter" → "save" → "new terminal" → "run tests"
```

**Complex Statements:**
```
"If the user is authenticated and the token is valid then return the user data"
```
Results in properly structured code.

### Common Patterns

**Creating functions:**
```
"create a function that calculates the average of an array of numbers"
```

**Writing conditionals:**
```
"if the status code is 200 then log success otherwise log error"
```

**Adding imports:**
```
"import react from react" → "import use state from react"
```

**Writing comments:**
```
"this function fetches user data from the api end point new line it takes a user id parameter and returns a promise"
```

### Terminal Dictation

VTThought can dictate directly into terminals:

1. Focus the terminal
2. Hold hotkey and speak
3. Commands like "send" execute the terminal command

**Example:**
```
"git add dot new line git commit message feat add user login"
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+V` (Win/Linux) | Toggle recording |
| `Cmd+Alt+V` (Mac) | Toggle recording |
| `Escape` | Stop recording (extension behavior) |

---

## Data Management

### Export User Data

Export your vocabulary, corrections, and preferences:

1. Command Palette → "VTThought: Export User Data"
2. Choose a save location
3. Data is saved as JSON for backup or migration

### Delete User Data

Clear all learned data:

1. Command Palette → "VTThought: Delete User Data"
2. Confirm the deletion
3. All vocabulary, corrections, and preferences are removed

---

## Getting Help

- **Command Reference**: "VTThought: List Voice Commands"
- **Test Commands**: "VTThought: Test Voice Commands"
- **Analyze Text**: "VTThought: Analyze Voice Command"
- **Troubleshooting**: See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **GitHub Issues**: https://github.com/jedarden/vtthought/issues
