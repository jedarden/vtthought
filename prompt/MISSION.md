# VTThought Marathon Coding Mission

> **Hot-Reload Enabled**: This file is re-read each iteration. Edit to change agent behavior without restarting.

## Project Overview

Build **VTThought** - a voice-to-code VS Code extension with a companion Docker backend for speech-to-text transcription and LLM post-processing.

## Project Root

All code paths are relative to: `/home/coder/vtthought/`

## Architecture Reference

Review the ADRs in `./ADRs/` for complete architectural decisions:
- ADR-001: System Architecture (VS Code Extension + Docker Backend)
- ADR-002: Authentication (OAuth 2.0 with GitHub, JWT)
- ADR-003: Audio Capture (WebView with Web Audio API)
- ADR-004: Audio Streaming (WebSocket with binary frames)
- ADR-005: STT Engine (faster-whisper GPU + Deepgram fallback)
- ADR-006: LLM Post-Processing (Ollama llama3.1:8b)
- ADR-007: Text Insertion (VS Code API)
- ADR-008: Voice Commands (keyword detection)
- ADR-009: Docker Container (Cloudflare Tunnel)
- ADR-010: Security Model (TLS, JWT, rate limiting)
- ADR-011: User Personalization (multi-user, vocabulary)
- ADR-012: Activation Strategy (push-to-talk)
- ADR-013: Extension UI (status bar, quick picks)
- ADR-015: Error Handling (circuit breaker, recovery)
- ADR-017: First-Run Setup (3-click onboarding)
- ADR-019: Observability (health endpoints, metrics)
- ADR-024: Versioning (API compatibility)

## Current Phase: Project Scaffolding

### Priority 1: VS Code Extension Skeleton
1. Initialize TypeScript project in `extension/`
2. Create `package.json` with extension manifest
3. Set up basic extension activation
4. Create status bar item
5. Implement push-to-talk hotkey registration

### Priority 2: Backend Skeleton
1. Initialize FastAPI project in `backend/`
2. Create project structure:
   - `backend/app/main.py` - FastAPI application
   - `backend/app/api/` - API routes
   - `backend/app/services/` - Business logic
   - `backend/app/models/` - Data models
3. Add WebSocket endpoint stub
4. Add health check endpoint

### Priority 3: Docker Setup
1. Create `backend/Dockerfile` for GPU-enabled container
2. Create `docker-compose.yml` for local development
3. Include faster-whisper and cloudflared

## Progress Tracking

Update `./PROGRESS.md` (in this prompt folder) after each significant milestone.

## Completion Criteria

- [ ] Extension activates and shows status bar
- [ ] Backend starts and serves health endpoint
- [ ] Docker container builds successfully
- [ ] Basic WebSocket connection between extension and backend

## Git Workflow

- Commit after each completed component
- Use conventional commit messages (feat:, fix:, docs:, etc.)
- Do NOT push unless explicitly instructed
