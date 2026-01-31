# VTThought Marathon Coding Mission

> **Hot-Reload Enabled**: This file is re-read each iteration. Edit to change agent behavior without restarting.

## Iteration Rules

**ONE THING PER LOOP**: Each iteration must focus on completing exactly ONE task:
1. **Change to project root**: `cd /home/coder/vtthought`
2. Read `prompt/PROGRESS.md` to understand current state
3. Pick the next uncompleted task from "In Progress" or "Next Up"
4. Complete that ONE task fully
5. **Run quick validation**: `/home/coder/vtthought/scripts/validate-quick.sh`
6. Update `prompt/PROGRESS.md` with what was done
7. Commit with conventional commit message
8. **Push to GitHub**: `git push origin main`
9. **Verify CI**: Wait for GitHub Actions and confirm they passed

Do NOT attempt multiple tasks in a single iteration. Depth over breadth.

## Project Root

**IMPORTANT**: Always work from the project root: `/home/coder/vtthought/`

Run `cd /home/coder/vtthought` at the start of each iteration.

## Project Overview

Build **VTThought** - a voice-to-code VS Code extension with a companion Docker backend for speech-to-text transcription and LLM post-processing.

## Architecture Reference

Review the ADRs in `./ADRs/` for complete architectural decisions:
- ADR-001: System Architecture (VS Code Extension + Docker Backend)
- ADR-002: Authentication (OAuth 2.0 with Google, JWT)
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
- ADR-025: Container Registry and Release Process (ghcr.io)
- ADR-026: Development Feedback Loop (testing, CI validation)
- ADR-027: VS Code Marketplace (publisher setup, CI publishing)

## Current Phase

Check `./PROGRESS.md` for the current phase and next task.

## Git Workflow

Each iteration MUST end with:
```bash
git add -A
git commit -m "feat: <description>

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

Note: The `Co-Authored-By: Claude` line enables detection by the claude-leaderboard system which searches GitHub for this exact substring.

## Verify CI Status

After pushing, **always verify GitHub Actions succeeded**:

```bash
# Wait for workflow to start (may take a few seconds)
sleep 10

# Check latest workflow run status
gh run list --repo jedarden/vtthought --limit 1

# Watch the run until completion (optional, for long runs)
gh run watch --repo jedarden/vtthought

# If a run fails, view logs:
gh run view --repo jedarden/vtthought --log-failed
```

**Expected output**: All checks should show `completed` with `success` conclusion.

If CI fails:
1. Read the failure logs: `gh run view --log-failed`
2. Fix the issue in the next iteration
3. Do NOT mark the task as complete until CI passes

## Validation Scripts

Three validation scripts are available (use absolute paths):

### Quick Validation (required before commit)
```bash
/home/coder/vtthought/scripts/validate-quick.sh
```
Fast checks (<60s): Python syntax, imports, TypeScript compilation.
**Run this before every commit.**

### Full Validation (run periodically)
```bash
/home/coder/vtthought/scripts/validate-full.sh
```
Comprehensive 5-phase validation:
1. Static analysis (ruff, mypy, eslint)
2. Unit tests (pytest)
3. Backend integration tests (starts server, tests endpoints + WebSocket)
4. Docker build verification
5. Extension packaging

Run after major changes or before releases.

### Smoke Tests (for deployed backends)
```bash
/home/coder/vtthought/scripts/smoke-test.sh [backend_url]
```
Tests a running backend. If no URL provided, starts a local backend for testing.
Tests: health, version, auth mode, WebSocket connectivity, recording flow.

## When to Use Each Script

| Scenario | Script |
|----------|--------|
| Before every commit | `/home/coder/vtthought/scripts/validate-quick.sh` |
| After major feature completion | `/home/coder/vtthought/scripts/validate-full.sh` |
| Testing deployed backend | `/home/coder/vtthought/scripts/smoke-test.sh` |
| Before creating a release | Both `validate-full.sh` + `smoke-test.sh` |
