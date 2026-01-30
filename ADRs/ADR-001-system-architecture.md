# ADR-001: System Architecture

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

We need to design a voice-to-code system for VS Code that allows users to dictate instructions into Claude Code. The system must support:

1. Remote deployment (Docker container exposed to internet)
2. Multi-user authentication
3. Audio streaming from VS Code to backend
4. STT transcription with LLM post-processing
5. Text insertion into focused VS Code window

## Decision Drivers

- **Latency**: Voice input must feel responsive (<1s end-to-end ideal)
- **Privacy**: Users should control where their audio is processed
- **Scalability**: Support multiple concurrent users
- **Simplicity**: Easy to deploy and maintain
- **Cost**: Minimize cloud compute costs

## Options Considered

### Option A: VS Code Extension + Remote Backend (Recommended)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VS CODE EXTENSION                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────────┐  │
│  │  Hotkey /   │───▶│   Audio     │───▶│  WebSocket Client           │  │
│  │  PTT Button │    │  Capture    │    │  (streams to backend)       │  │
│  └─────────────┘    └─────────────┘    └──────────────┬──────────────┘  │
│                                                        │                 │
│  ┌─────────────────────────────────────────────────────┴──────────────┐ │
│  │                    TEXT INSERTION                                   │ │
│  │  activeTerminal.sendText() / activeEditor.edit()                   │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket (wss://)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    DOCKER CONTAINER (REMOTE BACKEND)                     │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                        API GATEWAY (FastAPI)                         ││
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐  ││
│  │  │    Auth     │    │  WebSocket  │    │   Session Management    │  ││
│  │  │  Middleware │    │   Handler   │    │   (Redis)               │  ││
│  │  └─────────────┘    └─────────────┘    └─────────────────────────┘  ││
│  └──────────────────────────────┬──────────────────────────────────────┘│
│                                 │                                        │
│  ┌──────────────────────────────▼──────────────────────────────────────┐│
│  │                      PROCESSING PIPELINE                             ││
│  │  ┌───────────────┐    ┌───────────────┐    ┌───────────────────┐   ││
│  │  │  STT Engine   │───▶│  LLM Cleanup  │───▶│  Voice Commands   │   ││
│  │  │  (Whisper)    │    │  (Ollama/API) │    │  Parser           │   ││
│  │  └───────────────┘    └───────────────┘    └───────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Clear separation of concerns
- Backend can be GPU-accelerated for fast Whisper
- Multiple extensions can share one backend
- Easy to update backend without extension updates

**Cons:**
- Network latency added
- Requires hosting infrastructure
- More complex deployment

### Option B: Fully Local (Extension Only)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VS CODE EXTENSION                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────────┐  │
│  │  Hotkey /   │───▶│   Audio     │───▶│  Local Whisper.cpp          │  │
│  │  PTT Button │    │  Capture    │    │  (WASM or Native)           │  │
│  └─────────────┘    └─────────────┘    └──────────────┬──────────────┘  │
│                                                        │                 │
│                                         ┌──────────────▼──────────────┐ │
│                                         │  Local LLM (Ollama)         │ │
│                                         │  or Cloud API               │ │
│                                         └──────────────┬──────────────┘ │
│                                                        │                 │
│  ┌─────────────────────────────────────────────────────▼──────────────┐ │
│  │                    TEXT INSERTION                                   │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

**Pros:**
- No network latency
- Complete privacy
- No infrastructure needed

**Cons:**
- CPU-bound Whisper is slow (~5-10s for small model)
- WASM Whisper has limitations
- Heavy resource usage on developer machine
- No multi-user support

### Option C: Hybrid (Local Capture, Cloud Processing)

Extension captures audio locally, sends to cloud STT APIs (OpenAI, Deepgram) directly.

**Pros:**
- Low latency with cloud APIs
- Simple extension

**Cons:**
- Requires user to manage API keys
- Per-request costs passed to user
- No centralized account management

## Decision

**Option A: VS Code Extension + Remote Backend**

Rationale:
1. GPU-accelerated Whisper on backend provides best latency
2. Central authentication enables team/enterprise features
3. LLM post-processing can use larger models without client constraints
4. Backend can be updated independently
5. Aligns with user's requirement for "companion docker container"

## Consequences

### Positive
- Fast transcription with GPU Whisper
- Centralized user management
- Consistent experience across clients
- Easy to add features server-side

### Negative
- Requires hosting infrastructure
- Network dependency (offline not supported)
- Additional operational complexity

### Neutral
- Users must configure backend URL
- Authentication required before use

## Component Breakdown

### VS Code Extension
- **Language:** TypeScript
- **Responsibilities:**
  - Audio capture (WebView with Web Audio API or native)
  - WebSocket connection management
  - Authentication flow (OAuth redirect handling)
  - Settings UI (backend URL, hotkey config)
  - Text insertion into editor/terminal
  - Voice command local execution (enter, tab, etc.)

### Docker Backend
- **Language:** Python (FastAPI)
- **Responsibilities:**
  - WebSocket server for audio streaming
  - User authentication (OAuth, JWT)
  - STT processing (faster-whisper with GPU)
  - LLM post-processing (Ollama or cloud API)
  - Session management (Redis)
  - Voice command parsing

## Related ADRs
- ADR-002: Authentication Strategy
- ADR-003: Audio Capture Approach
- ADR-004: Audio Streaming Protocol
- ADR-009: Docker Container Architecture
