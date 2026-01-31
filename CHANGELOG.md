# Changelog

All notable changes to VTThought will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-01-31

### Added
- Extension icon/logo (microphone with sound waves and code brackets)

### Changed
- OpenAI provider support for LLM post-processing (in addition to Ollama)

## [0.1.0] - 2026-01-31

### Added
- Initial beta release
- VS Code extension with push-to-talk activation (Ctrl+Alt+V)
- Backend with faster-whisper STT (GPU and CPU variants)
- Ollama LLM integration for text cleanup
- 38 built-in voice commands across all categories:
  - Execution: enter, cancel
  - Editing: undo, redo, copy, cut, paste, clear line, select all/word/line, duplicate line, move line up/down, indent/outdent
  - Navigation: go to line, scroll up/down/top/bottom, go to start/end
  - VS Code: save, save all, close, close all, new terminal, file explorer, search, toggle sidebar, format document, toggle word wrap
- WebSocket streaming for real-time transcription
- Docker container with GPU support (nvidia/cuda base)
- CPU-only Docker variant for non-GPU systems
- Google OAuth authentication
- Token-based authentication for extension
- User personalization (ADR-011):
  - Custom vocabulary with categories
  - Learned corrections from user edits
  - Style preference learning (punctuation, capitalization, numbers)
  - GDPR-compliant data export and deletion
  - User Preferences Editor UI for managing vocabulary, style, and corrections
  - Custom Voice Commands UI for creating and managing voice commands
- First-run setup wizard (3-click onboarding)
- Version negotiation between extension and backend (ADR-024)
- Circuit breaker pattern for error handling
- Comprehensive documentation:
  - Installation guide (docs/INSTALL.md)
  - User guide (docs/USER_GUIDE.md)
  - Troubleshooting guide (docs/TROUBLESHOOTING.md)
  - Beta testing guide (docs/BETA_TESTING.md)

### Architecture
- 21 ADRs documenting all architectural decisions
- Extension: ~6,000 lines of TypeScript
- Backend: ~6,200 lines of Python
- 6 database tables for user data
- 30+ API endpoints

[Unreleased]: https://github.com/jedarden/vtthought/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jedarden/vtthought/releases/tag/v0.1.0
