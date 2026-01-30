# VTThought Beta Testing Program

Thank you for participating in the VTThought beta testing program! Your feedback helps us build a better voice-to-code experience.

## Table of Contents

- [How to Participate](#how-to-participate)
- [What to Test](#what-to-test)
- [Reporting Issues](#reporting-issues)
- [Feature Requests](#feature-requests)
- [Known Limitations](#known-limitations)

---

## How to Participate

### 1. Install VTThought

Follow the [Installation Guide](./INSTALL.md) to set up VTThought.

### 2. Complete First-Run Setup

Go through the first-run setup wizard to connect to your backend.

### 3. Test Core Features

Try the key features and report any issues you encounter.

### 4. Share Feedback

Report bugs, suggest improvements, and share your experience.

---

## What to Test

### Priority 1: Core Functionality

| Feature | How to Test | Expected Result |
|---------|-------------|-----------------|
| **Push-to-Talk** | Hold `Ctrl+Alt+V`, speak, release | Text appears in editor |
| **Real-time Transcription** | Speak while holding hotkey | Gray interim text updates live |
| **LLM Cleanup** | Dictate with filler words ("um", "uh") | Clean text without fillers |
| **Backend Connection** | Check status bar icon | Shows connected state |
| **Microphone Permission** | First recording attempt | Prompts for permission once |

### Priority 2: Voice Commands

| Command | Test Phrase | Expected Action |
|---------|-------------|-----------------|
| Enter | "print hello world **enter**" | Inserts "print hello world\n" |
| Save | "save file" | Saves current file |
| Undo | "undo" | Undoes last action |
| Go to line | "go to line 42" | Jumps to line 42 |
| New terminal | "new terminal" | Creates new terminal |

**Test all 38 built-in commands** by running:
```
Command Palette → "VTThought: List Voice Commands"
```

### Priority 3: Personalization

| Feature | How to Test | Expected Result |
|---------|-------------|-----------------|
| **Vocabulary** | Add "TypeScript" to vocabulary | Transcribes as one word |
| **Style Learning** | Edit transcribed text | Future transcriptions adapt |
| **Learned Corrections** | Make consistent edits | Pattern is learned |

### Priority 4: Platform-Specific

| Platform | Test Focus |
|----------|------------|
| **Windows** | WSL2 backend, GPU passthrough |
| **macOS** | Apple Silicon (M1/M2/M3) CPU mode |
| **Linux** | Native GPU support, audio systems |

---

## Reporting Issues

### Before Reporting

1. **Check existing issues** - https://github.com/jedarden/vtthought/issues
2. **Check Troubleshooting Guide** - [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
3. **Try the latest version** - `git pull` and rebuild

### Issue Report Template

When reporting an issue, include:

```markdown
## Description
Brief description of the issue

## Steps to Reproduce
1. Step one
2. Step two
3. Step three

## Expected Behavior
What should happen

## Actual Behavior
What actually happened

## Environment
- OS: [e.g., Ubuntu 22.04, macOS 13, Windows 11]
- VS Code Version: [e.g., 1.85.0]
- VTThought Version: [e.g., 0.1.0]
- Backend: [Docker Desktop / Native Docker]
- GPU: [e.g., RTX 3080 / None / Apple M1]

## Logs
Extension Output (View → Output → VTThought):
[paste logs here]

Backend Logs:
```bash
docker logs vtthought-backend
[paste logs here]
```

## Additional Context
Any other relevant information
```

### Types of Issues to Report

| Type | Examples |
|------|----------|
| **Bug** | Crash, incorrect behavior, data loss |
| **Performance** | Slow transcription, high memory/CPU |
| **Accuracy** | Consistently wrong transcription |
| **Usability** | Confusing UI, hard to use feature |
| **Documentation** | Missing or unclear instructions |

### Where to Report

- **GitHub Issues**: https://github.com/jedarden/vtthought/issues
- **Tag with**: `bug`, `performance`, `accuracy`, or `usability`

---

## Feature Requests

We welcome ideas for improving VTThought!

### Before Requesting

1. **Check ADRs** - See if it's already planned: [ADRs](../ADRs/)
2. **Check existing requests** - Search GitHub issues
3. **Consider scope** - Is it core functionality or nice-to-have?

### Feature Request Template

```markdown
## Feature Description
Clear description of the requested feature

## Problem Statement
What problem does this solve? Why is it needed?

## Proposed Solution
How should it work? User interaction, UI changes, etc.

## Alternatives Considered
What other approaches did you consider?

## Additional Context
Examples, mockups, references to similar tools
```

### Priority Areas

We're particularly interested in feedback on:

| Area | Questions |
|------|-----------|
| **Accuracy** | Are technical terms transcribed correctly? |
| **Commands** | Are there missing commands you need? |
| **Workflow** | Does it fit your development workflow? |
| **Performance** | Is transcription fast enough? |
| **Setup** | Was installation smooth? |

### Where to Request

- **GitHub Issues**: https://github.com/jedarden/vtthought/issues
- **Tag with**: `enhancement` or `feature-request`

---

## Known Limitations

### Current Limitations (as of v0.1.0)

| Area | Limitation | Planned Fix |
|------|------------|-------------|
| **Languages** | English only | Multi-language support (future) |
| **Platforms** | Desktop VS Code only | Web/github.dev support (future) |
| **LLM** | Ollama requires local setup | Cloud LLM options (future) |
| **Custom Commands UI** | Manual JSON editing | Visual editor (future) |
| **Style Preferences** | Auto-learn only | Manual editing (future) |

### Expected Behavior (Not Bugs)

| Issue | Explanation |
|-------|-------------|
| **First use is slow** | Whisper model downloads on first run (~1-3GB) |
| **GPU memory usage** | Model stays loaded for performance |
| **Command at end only** | Default "trailing" mode detects commands at speech end |
| **Interim text styling** | Gray/italic indicates interim (not final) text |

---

## Testing Scenarios

### Scenario 1: Daily Standup

```
1. Open a new file
2. Hold hotkey, say: "update user authentication to use OAuth 2.0"
3. Release, observe transcription
4. Edit if needed
5. Hold hotkey, say: "add unit tests for the login function"
6. Release, observe transcription
7. Save: hold hotkey, say: "save file"
```

### Scenario 2: Debugging

```
1. Open a code file with a bug
2. Hold hotkey, say: "add console log statement at line 42"
3. Release, observe transcription
4. Run the code: "new terminal", "npm test"
5. Add more logs as needed
```

### Scenario 3: Writing Documentation

```
1. Open README.md
2. Hold hotkey, say: "API Documentation new line The user endpoint takes a user ID and returns user details"
3. Release, observe transcription
4. Continue dictating documentation
```

---

## Feedback Channels

| Channel | Purpose |
|---------|---------|
| **GitHub Issues** | Bug reports, feature requests |
| **GitHub Discussions** | Questions, general feedback |
| **Pull Requests** | Code contributions |

---

## Beta Tester Recognition

Contributors who provide valuable feedback will be:
- Listed in the project contributors
- Eligible for early access to new features
- Invited to shape the product roadmap

Thank you for helping us build VTThought!
