# VTThought Troubleshooting Guide

Solutions to common issues with VTThought.

## Table of Contents

- [Backend Issues](#backend-issues)
- [Extension Issues](#extension-issues)
- [Audio/Microphone Issues](#audiomicrophone-issues)
- [Transcription Accuracy](#transcription-accuracy)
- [Performance Issues](#performance-issues)
- [Authentication Issues](#authentication-issues)
- [Docker Issues](#docker-issues)

---

## Backend Issues

### Backend won't start

**Symptoms:** Container exits immediately, logs show errors

**Diagnosis:**
```bash
docker logs vtthought-backend
```

**Common causes and solutions:**

#### 1. Missing JWT_SECRET_KEY

**Error:** `RuntimeError: JWT_SECRET_KEY not set`

**Solution:**
```bash
# In .env file, add a secure key:
JWT_SECRET_KEY=your-secure-random-key-here

# Generate one with:
openssl rand -hex 32
```

#### 2. Port 8000 already in use

**Error:** `OSError: [Errno 48] Address already in use`

**Solution:**
```bash
# Find what's using the port
lsof -i :8000  # macOS/Linux
netstat -ano | findstr :8000  # Windows

# Either stop the other service or change the port:
# In .env:
PORT=8001
```

#### 3. GPU not available

**Error:** `CUDA not available` when using GPU configuration

**Solution:** Use CPU-only configuration:
```bash
docker compose -f docker-compose.cpu.yml up -d
```

### Backend is slow to respond

**Symptoms:** Long delays before transcription starts

**Possible causes:**

#### 1. Model not loaded

First run requires downloading the Whisper model (~1-3GB).

**Check model status:**
```bash
docker exec -it vtthought-backend ls -la ~/.cache/whisper
```

**Solution:** Wait for download to complete. Progress is in logs:
```bash
docker logs -f vtthought-backend
```

#### 2. Ollama still starting

Ollama may be pulling the LLM model on first run.

**Check Ollama status:**
```bash
docker logs vtthought-ollama
```

**Solution:** Wait for model pull to complete.

### Backend health check failing

**Symptoms:** `/api/health` returns error or times out

**Diagnosis:**
```bash
curl http://localhost:8000/api/health
```

**Solutions:**

1. **Check if container is running:**
   ```bash
   docker ps | grep vtthought
   ```

2. **Restart the backend:**
   ```bash
   docker compose restart backend
   ```

3. **Check for port conflicts** (see above)

---

## Extension Issues

### Extension can't connect to backend

**Symptoms:** "Cannot connect to backend" error

**Diagnosis:**

1. **Check backend is running:**
   ```bash
   curl http://localhost:8000/api/health
   ```

2. **Check extension logs:**
   - View → Output → "VTThought"

**Solutions:**

#### 1. Incorrect backend URL

**Check:** VS Code Settings → search "vtthought.backendUrl"

**Correct values:**
- Local: `ws://localhost:8000/api/ws/audio`
- Remote: `wss://your-domain.com/api/ws/audio`

#### 2. CORS blocking

**Error:** `CORS policy blocked the request`

**Solution:** Add your extension origin to CORS settings in `.env`:
```bash
CORS_ORIGINS=vscode-webview://*,http://localhost:3000
```

#### 3. Network/firewall blocking

**Solution:** Ensure port 8000 is accessible:
```bash
# Test from another terminal
telnet localhost 8000
```

### Extension not activating

**Symptoms:** VTThought doesn't appear in status bar

**Diagnosis:**
- View → Output → "Extension Host"
- Look for VTThought errors

**Solutions:**

#### 1. VS Code version too old

**Requirement:** VS Code 1.80.0 or newer

**Solution:** Update VS Code

#### 2. Conflicting extension

**Solution:** Disable other voice-to-text extensions temporarily

#### 3. Reload VS Code

```
Ctrl+Shift+P → "Developer: Reload Window"
```

### Commands not working

**Symptoms:** Voice commands are not executed

**Diagnosis:**
- Command Palette → "VTThought: Analyze Voice Command"
- Type text to see what commands are detected

**Solutions:**

#### 1. Command detection mode

**Setting:** `vtthought.commandDetection`

**Options:**
- `trailing` (default): Commands only at end of speech
- `anywhere`: Commands anywhere in speech

**Try changing to "anywhere" if commands aren't detected.**

#### 2. Command is disabled

**Check:** `vtthought.disabledCommands` setting

**Solution:** Remove the command from the disabled list

#### 3. Command feedback off

**Check:** `vtthought.showCommandFeedback` is `true`

This shows notifications when commands execute.

---

## Audio/Microphone Issues

### Microphone permission denied

**Symptoms:** "Microphone access denied" error

**macOS Solution:**
1. System Preferences → Security & Privacy → Privacy → Microphone
2. Enable "Visual Studio Code" or "Code Helper"

**Windows Solution:**
1. Settings → Privacy → Microphone
2. Allow apps to access microphone
3. Enable "Visual Studio Code"

**Linux Solution:**
```bash
# Check PulseAudio
pactl list sources short

# Test microphone
arecord -f cd -d 5 test.wav
aplay test.wav
```

### No audio detected

**Symptoms:** Audio level meter doesn't move when speaking

**Diagnosis:**

1. **Check system mic:**
   - macOS: System Preferences → Sound → Input
   - Windows: Settings → System → Sound → Input
   - Linux: Sound settings

2. **Check VS Code WebView permissions:**
   - Look for microphone prompt in WebView
   - Allow when prompted

**Solutions:**

#### 1. Wrong microphone selected

**Solution:** Change system default microphone or select correct one in system settings.

#### 2. Microphone muted

**Check:** System microphone is not muted (hardware or software)

#### 3. USB microphone issue

**Solution:** Unplug and replug USB microphone, then reload VS Code.

### Audio quality poor

**Symptoms:** Transcription has many errors or misses words

**Solutions:**

#### 1. Background noise

**Solution:** Use a quiet environment or noise-canceling microphone

#### 2. Microphone too far/quiet

**Solution:** Move closer to microphone or increase input gain in system settings

#### 3. Low-quality microphone

**Solution:** Use a headset or dedicated microphone (not laptop built-in)

---

## Transcription Accuracy

### Technical terms not recognized

**Symptoms:** "API" transcribed as "a p i", "TypeScript" as "type script"

**Solution:** Add to vocabulary:
1. Command Palette → "VTThought: Manage Vocabulary"
2. Add term with appropriate category
3. Optionally add phonetic hint

**Example:**
```
Term: TypeScript
Category: technical
Phonetic: type-script
```

### Code syntax issues

**Symptoms:** Variable names have spaces, wrong case

**Solutions:**

#### 1. Use camelCase/phrases

Instead of: "create variable user name"
Try: "create variable userName"

#### 2. Spell out special characters

"create variable user underscore id" → `user_id`
"create variable user dot name" → `user.name`

#### 3. Use style preferences

VTThought learns from your edits. Make corrections and it will learn patterns.

### Punctuation not correct

**Symptoms:** Missing commas, periods, quotes

**Solutions:**

#### 1. Speak punctuation explicitly

"print hello world comma new line" → `print("hello world"),\n`

#### 2. LLM cleanup level

Adjust cleanup in backend `.env`:
```bash
LLM_TEMPERATURE=0.3  # Lower = more conservative cleanup
```

---

## Performance Issues

### Slow transcription

**Symptoms:** Long delay after releasing hotkey

**Diagnosis:**
```bash
# Check backend logs
docker logs vtthought-backend | grep -i "transcribe\|process"

# Check GPU usage
nvidia-smi  # Should show GPU utilization during transcription
```

**Solutions:**

#### 1. Use GPU acceleration

Ensure GPU is being used:
```bash
docker exec -it vtthought-backend nvidia-smi
```

#### 2. Reduce model size

In `.env`:
```bash
STT_MODEL=tiny  # Faster but less accurate
# or
STT_MODEL=base  # Balance of speed and accuracy
```

#### 3. Increase compute precision

On GPU:
```bash
STT_COMPUTE_TYPE=float16  # Faster
```

On CPU:
```bash
STT_COMPUTE_TYPE=int8  # Faster
```

### High memory usage

**Symptoms:** System runs out of RAM

**Diagnosis:**
```bash
docker stats vtthought-backend
```

**Solutions:**

#### 1. Limit Docker memory

In Docker Desktop: Settings → Resources → Memory (increase to 8GB+)

#### 2. Use smaller models

```bash
STT_MODEL=tiny  # ~70MB vs ~1GB for base model
```

#### 3. Restart containers

```bash
docker compose restart
```

---

## Authentication Issues

### Invalid token error

**Symptoms:** "Invalid token" when connecting

**Solutions:**

#### 1. Regenerate token

1. Open backend web UI (http://localhost:8000)
2. Settings → Extension Token
3. Click "Regenerate"
4. Copy new token and update in extension

#### 2. Clear extension authentication

Command Palette → "VTThought: Clear Authentication"

Then run "VTThought: Setup Authentication" again.

### Can't log in to backend

**Symptoms:** Backend web UI shows login error

**Solutions:**

#### 1. Check OAuth configuration

In `.env`:
```bash
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

#### 2. Use single-user mode (development)

In `.env`:
```bash
ENVIRONMENT=development
```

This bypasses OAuth for testing.

---

## Docker Issues

### Docker build fails

**Symptoms:** `docker build` returns errors

**Common errors:**

#### 1. No space left on device

**Solution:** Free up disk space or change Docker storage location

#### 2. Network timeout during build

**Solution:** Check internet connection or try again later

#### 3. Base image pull fails

**Solution:** Manually pull base image:
```bash
docker pull nvidia/cuda:11.8.0-runtime-ubuntu22.04
```

### Container won't stop

**Symptoms:** `docker stop` hangs

**Solution:**
```bash
docker kill vtthought-backend
docker rm vtthought-backend
```

### Volume mounting issues (Linux)

**Symptoms:** Permission denied errors, files not visible in container

**Solution:**
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Logout and login again
```

---

## Getting Additional Help

If none of these solutions work:

1. **Check logs:**
   ```bash
   docker logs vtthought-backend
   docker logs vtthought-ollama
   ```

2. **Check extension output:**
   - View → Output → "VTThought"

3. **Create an issue on GitHub:**
   - https://github.com/jedarden/vtthought/issues
   - Include: OS, VS Code version, error logs, steps to reproduce

4. **See additional documentation:**
   - [Installation Guide](./INSTALL.md)
   - [User Guide](./USER_GUIDE.md)
   - [Architecture Decisions](../ADRs/)
