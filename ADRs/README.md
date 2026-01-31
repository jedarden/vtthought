# Architectural Decision Records (ADRs)

## Overview

These ADRs document the architectural decisions for building a VS Code extension with a companion backend for voice-to-code functionality.

## System Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VOICE-TO-CODE SYSTEM ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      VS CODE EXTENSION                                 │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │  WebView    │  │   Auth      │  │  WebSocket  │  │   Text      │   │  │
│  │  │  Audio      │──│   Flow      │──│   Client    │──│   Insertion │   │  │
│  │  │  Capture    │  │  (Google)   │  │  (wss://)   │  │             │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                       │                                      │
│                                       ▼ Cloudflare Edge (TLS, DDoS)         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              SINGLE DOCKER CONTAINER (No exposed ports)                │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │  │
│  │  │  cloudflared ──▶ FastAPI ──▶ faster-whisper (GPU)               │   │  │
│  │  │                     │                                            │   │  │
│  │  │                     ├──▶ SQLite (users, vocabulary)             │   │  │
│  │  │                     ├──▶ In-memory cache                        │   │  │
│  │  │                     └──▶ Ollama client (external)               │   │  │
│  │  └─────────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  External (same host or remote):  ┌─────────────┐                           │
│                                   │   Ollama    │                           │
│                                   │   (LLM)     │                           │
│                                   └─────────────┘                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## ADR Index

| ADR | Title | Status | Summary |
|-----|-------|--------|---------|
| [001](./ADR-001-system-architecture.md) | System Architecture | Proposed | VS Code Extension + Remote Docker Backend |
| [002](./ADR-002-authentication-strategy.md) | Authentication Strategy | Proposed | OAuth 2.0 with Google, JWT tokens |
| [003](./ADR-003-audio-capture.md) | Audio Capture | Proposed | WebView with Web Audio API |
| [004](./ADR-004-audio-streaming-protocol.md) | Audio Streaming Protocol | Proposed | WebSocket with binary frames |
| [005](./ADR-005-stt-engine-selection.md) | STT Engine Selection | Proposed | faster-whisper (GPU) + Deepgram fallback |
| [006](./ADR-006-llm-post-processing.md) | LLM Post-Processing | Proposed | Ollama (llama3.1:8b) for cleanup |
| [007](./ADR-007-text-insertion.md) | Text Insertion | Proposed | VS Code API (editor + terminal) |
| [008](./ADR-008-voice-commands.md) | Voice Commands | Proposed | Keyword detection for enter/send/etc |
| [009](./ADR-009-docker-container-architecture.md) | Docker Container | Proposed | Cloudflare Tunnel, no exposed ports |
| [010](./ADR-010-security-model.md) | Security Model | Proposed | TLS, JWT, rate limiting, audit logs |
| [011](./ADR-011-user-personalization.md) | User Personalization | Proposed | Multi-user, custom vocabulary, preferences |
| [012](./ADR-012-activation-strategy.md) | Activation Strategy | Proposed | Push-to-talk default, extensible mode architecture |
| [013](./ADR-013-extension-ui.md) | Extension UI | Proposed | Status bar only, quick picks for settings |
| [015](./ADR-015-error-handling.md) | Error Handling | Proposed | Recovery strategies, circuit breaker, user feedback |
| [017](./ADR-017-first-run-setup.md) | First-Run Setup | Proposed | 3-click onboarding, token auth, mic permissions |
| [019](./ADR-019-observability.md) | Observability | Proposed | Health endpoints, structured logging, metrics |
| [024](./ADR-024-versioning.md) | Versioning & Compatibility | Proposed | API versioning, feature detection, compatibility matrix |
| [025](./ADR-025-container-registry-releases.md) | Container Registry & Releases | Proposed | ghcr.io hosting, semantic versioning, changelogs |
| [026](./ADR-026-development-feedback-loop.md) | Development Feedback Loop | Proposed | Multi-layer testing, pre-commit hooks, CI validation |

## Key Decisions Summary

### Architecture
- **Split architecture**: VS Code extension handles UI/capture, Docker backend handles processing
- **Zero exposed ports**: All external access via Cloudflare Tunnel (learned from clawdbot/moltbot)
- **GPU acceleration**: Whisper and Ollama run on GPU for sub-second latency

### Data Flow
1. User activates via hotkey (push-to-talk)
2. WebView captures audio via Web Audio API
3. Audio streams to backend via WebSocket (through Cloudflare Tunnel)
4. User vocabulary loaded for personalized transcription
5. Whisper transcribes (GPU, ~0.5s for 5s audio)
6. Ollama cleans up filler words (~0.5s)
7. User corrections applied
8. Commands parsed (enter, send, etc.)
9. Clean text + commands sent back to extension
10. Extension inserts text into focused window

### Security
- **No exposed ports** - Cloudflare Tunnel only
- OAuth 2.0 (Google) for user authentication
- JWT tokens for session management
- TLS via Cloudflare (automatic)
- DDoS protection via Cloudflare
- Audio not persisted by default
- Rate limiting to prevent abuse
- Row-level security for multi-tenancy

### Multi-User Support
- Per-user custom vocabulary (improves accuracy)
- Learned corrections (auto-improves over time)
- User preferences (language, cleanup level, hotkey mode)
- Custom voice commands
- GDPR compliant (export/delete)

### Simplicity
- Single Docker container (one `docker run` command)
- SQLite for persistence (file-based, easy backup)
- In-memory cache (no external dependencies)
- Ollama runs separately (can be same host or remote)

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Extension | TypeScript | VS Code native |
| Audio Capture | Web Audio API | Cross-platform in WebView |
| Backend API | FastAPI (Python) | Async, WebSocket support |
| STT | faster-whisper | GPU-optimized Whisper |
| LLM | Ollama (external) | Local, privacy-preserving |
| Cache | In-memory (cachetools) | No Redis needed |
| Database | SQLite | No Postgres needed, simple backup |
| Tunnel | Cloudflare Tunnel | Zero exposed ports, DDoS protection |
| Container | Single Docker image | `docker run` simplicity |

## Open Questions

1. **Model selection UI**: Should users choose Whisper model size?
2. **Offline mode**: Support local-only mode without backend?
3. **Custom vocabulary**: How to handle user-specific terms?
4. **Multi-language**: Support transcription in multiple languages?
5. **Pricing model**: Free tier limits? Pro features?

## Next Steps

1. ☐ Review and approve ADRs
2. ☐ Create VS Code extension skeleton
3. ☐ Implement backend services
4. ☐ Integration testing
5. ☐ Beta deployment

## Contributing

To propose changes to an ADR:
1. Create a new ADR with status "Proposed"
2. Reference the ADR being superseded
3. Document the rationale for changes
