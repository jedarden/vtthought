# VTThought

**Voice-to-Thought** - Transform speech into code with a VS Code extension powered by a Docker backend.

## Overview

VTThought is a voice-driven development system that captures your spoken words and transforms them into code. It consists of two main components:

1. **VS Code Extension** - Captures audio, displays real-time transcription, and inserts text into your editor
2. **Docker Backend** - Coordinates speech-to-text processing and LLM-powered text cleanup

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VTTHOUGHT ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      VS CODE EXTENSION                                 │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │  WebView    │  │   Auth      │  │  WebSocket  │  │   Text      │   │  │
│  │  │  Audio      │──│   Flow      │──│   Client    │──│   Insertion │   │  │
│  │  │  Capture    │  │  (Token)    │  │  (wss://)   │  │             │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                       │                                      │
│                                       ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    DOCKER BACKEND CONTAINER                            │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │  │
│  │  │  FastAPI Server                                                  │   │  │
│  │  │       │                                                          │   │  │
│  │  │       ├──▶ Speech-to-Text (faster-whisper, GPU accelerated)     │   │  │
│  │  │       │                                                          │   │  │
│  │  │       ├──▶ LLM Post-Processing (cleanup, formatting)            │   │  │
│  │  │       │    └── Ollama / Claude / OpenAI (configurable)          │   │  │
│  │  │       │                                                          │   │  │
│  │  │       ├──▶ User Personalization (vocabulary, style learning)    │   │  │
│  │  │       │                                                          │   │  │
│  │  │       └──▶ SQLite Database (users, preferences)                 │   │  │
│  │  └─────────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Features

- **Real-time Transcription** - See your words appear as you speak with interim results
- **LLM-Powered Cleanup** - Automatic removal of filler words, formatting, and punctuation
- **Voice Commands** - Say "enter", "new line", "send" to control your editor
- **Push-to-Talk** - Hold a hotkey to record, release to transcribe
- **User Personalization** - Custom vocabulary and learned style preferences
- **Self-Hosted** - Run the backend on your own infrastructure
- **GPU Accelerated** - Sub-second transcription with faster-whisper on GPU

## Components

### VS Code Extension (`extension/`)

- Audio capture via WebView and Web Audio API
- WebSocket streaming to backend
- Real-time text insertion with interim result support
- Status bar UI showing recording/processing state
- Token-based authentication

### Docker Backend (`backend/`)

- FastAPI server with WebSocket support
- faster-whisper for GPU-accelerated speech-to-text
- LLM integration (Ollama, Claude, OpenAI) for text cleanup
- SQLite database for user preferences and vocabulary
- Cloudflare Tunnel support (no exposed ports)

## Quick Start

**For detailed installation instructions, see [INSTALL.md](./docs/INSTALL.md).**

### Backend

```bash
# Clone and run the backend
docker run -d \
  --gpus all \
  -e OLLAMA_HOST=http://host.docker.internal:11434 \
  ghcr.io/jedarden/vtthought-backend:latest
```

### Extension

Install from the VS Code Marketplace (coming soon) or build from source:

```bash
cd extension
npm install
npm run compile
# Press F5 in VS Code to launch
```

## Documentation

| Document | Description |
|----------|-------------|
| [INSTALL.md](./docs/INSTALL.md) | Installation guide for all platforms |
| [USER_GUIDE.md](./docs/USER_GUIDE.md) | How to use VTThought effectively |
| [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | Common issues and solutions |
| [BETA_TESTING.md](./docs/BETA_TESTING.md) | Beta testing program and feedback |
| [ADRs](./ADRs/) | Architecture Decision Records |

See the [ADRs](./ADRs/) directory for architectural decisions covering:

- System architecture and component design
- Authentication and security model
- Audio capture and streaming protocols
- STT engine selection and LLM integration
- Text insertion and interim result handling
- Voice commands and activation modes

## Technology Stack

| Component | Technology |
|-----------|------------|
| Extension | TypeScript, VS Code API |
| Audio Capture | Web Audio API (WebView) |
| Backend | FastAPI (Python) |
| Speech-to-Text | faster-whisper (GPU) |
| LLM | Ollama / Claude / OpenAI |
| Database | SQLite |
| Tunnel | Cloudflare Tunnel |

## Status

**Beta Testing** - Core features implemented, ready for user testing. See [BETA_TESTING.md](./docs/BETA_TESTING.md) to participate.

## License

MIT
