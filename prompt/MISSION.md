# VTThought Marathon Coding Mission

> **Hot-Reload Enabled**: This file is re-read each iteration. Edit to change agent behavior without restarting.

## Iteration Rules

**ONE THING PER LOOP**: Each iteration must focus on completing exactly ONE task:
1. Read `./PROGRESS.md` to understand current state
2. Pick the next uncompleted task from "In Progress" or "Next Up"
3. Complete that ONE task fully
4. Update `./PROGRESS.md` with what was done
5. Commit with conventional commit message
6. **Push to GitHub**: `git push origin main`
7. **Verify CI**: Wait for GitHub Actions and confirm they passed

Do NOT attempt multiple tasks in a single iteration. Depth over breadth.

## Project Root

All code paths are relative to: `/home/coder/vtthought/`

## Project Overview

Build **VTThought** - a voice-to-code VS Code extension with a companion Docker backend for speech-to-text transcription and LLM post-processing.

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
- ADR-025: Container Registry and Release Process (ghcr.io)

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
