# VTThought Development Progress

## Project Overview

Voice-to-code VS Code extension with Docker backend for speech-to-text transcription and LLM post-processing.

## Current Phase: ADR-011 User Personalization - Final UI Tasks

**Status**: Backend ~95% complete, Extension ~80% complete

### Completed (Session 1-17)

#### Core Architecture (ADR-001)
- [x] FastAPI backend with WebSocket streaming
- [x] VS Code extension with WebView audio capture
- [x] Docker container with GPU/CPU support

#### Authentication (ADR-002)
- [x] Token-based authentication
- [x] Google OAuth integration
- [x] Token manager in extension

#### Audio Processing (ADR-003, ADR-004, ADR-005)
- [x] Web Audio API capture in WebView
- [x] WebSocket binary streaming
- [x] faster-whisper STT with GPU acceleration
- [x] Deepgram fallback for streaming

#### LLM Integration (ADR-006)
- [x] Multi-provider support (Ollama, OpenAI, Anthropic)
- [x] Text cleanup with configurable aggressiveness
- [x] Streaming responses

#### Text Insertion (ADR-007)
- [x] Interim and final result display
- [x] VS Code editor integration
- [x] Edit detection for style learning

#### Voice Commands (ADR-008)
- [x] 38 built-in commands
- [x] Homophone normalization
- [x] Command execution API

#### Error Handling (ADR-015)
- [x] Circuit breaker pattern
- [x] Automatic recovery
- [x] User-friendly error messages

#### First-Run Setup (ADR-017)
- [x] 3-click onboarding flow
- [x] Google OAuth setup
- [x] Backend URL configuration

#### Observability (ADR-019)
- [x] Health endpoints
- [x] Metrics collection
- [x] Error tracking

#### User Personalization - Backend (ADR-011)
- [x] SQLite database with 6 tables
- [x] UserRepository with scoped access
- [x] UserPreferences model (language, cleanup level, hotkey mode)
- [x] UserVocabulary service (custom words, categories, phonetic hints)
- [x] Learned corrections system (auto-learning from edits)
- [x] Whisper prompt generation with vocabulary biasing
- [x] StyleLearner engine (punctuation, capitalization, numbers, abbreviations)
- [x] LLM integration with style prompts
- [x] User API endpoints (/api/user/*)
- [x] Batch operations for performance
- [x] GDPR export/delete endpoints
- [x] TTL caching for vocabulary and style preferences
- [x] Connection pooling

#### User Personalization - Extension UI (ADR-011) - Partial
- [x] Vocabulary management UI (add, view, delete custom words)
- [x] Corrections viewing UI
- [x] Style preferences viewing UI
- [x] Data export UI
- [x] Data deletion UI
- [x] Edit detection and reporting
- [x] Integration with text insertion

### In Progress

**Current Task**: No active task - starting Session 18

### Next Up - ADR-011 Remaining UI Tasks

1. **User Preferences Editor** (Priority: HIGH)
   - [ ] Add UI to edit user preferences (language, cleanup_level, hotkey_mode)
   - [ ] Backend API exists (`/api/user/preferences` PUT)
   - [ ] Extension can view but not edit

2. **Custom Voice Commands UI** (Priority: MEDIUM)
   - [ ] Add UI to create/manage custom voice commands
   - [ ] Backend table exists (`user_voice_commands`)
   - [ ] Extension UI needed

3. **Manual Style Preferences Editor** (Priority: LOW)
   - [ ] Allow manual override of learned style preferences
   - [ ] Currently only automatic learning

### Next Up - Post ADR-011

4. **Integration Tests** (Priority: MEDIUM)
   - [ ] Tests for vocabulary/corrections/style learning
   - [ ] Tests exist for core WebSocket/STT

5. **Cleanup Technical Debt**
   - [ ] Remove outdated TODO comment in `backend/app/services/llm.py:555`

### Future Phases

- ADR-012: Push-to-Talk activation (partially done)
- ADR-013: Extension UI refinement
- ADR-024: Versioning and API compatibility

## Session History

| Session | Date | Focus | Status |
|---------|------|-------|--------|
| 1-15 | Earlier | Core architecture implementation | Complete |
| 16 | Jan 30 | Extension UI for vocabulary/style management | Complete |
| 17 | Jan 30 | Performance tuning - streaming pipeline optimization | Complete |
| 18 | Jan 30 | Current session | Starting |

## Statistics

- **Backend LOC**: ~2,500 Python
- **Extension LOC**: ~1,800 TypeScript
- **Test Coverage**: Core WebSocket/STT tested, ADR-011 features untested
- **Database Tables**: 6 (users, user_preferences, user_vocabulary, vocabulary_corrections, user_voice_commands, user_style_preferences)
- **API Endpoints**: 25+
