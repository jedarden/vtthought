# VTThought Installation Guide

This guide will help you install and configure VTThought - a voice-to-code VS Code extension powered by a Docker backend.

## Table of Contents

- [System Requirements](#system-requirements)
- [Quick Start (Docker Desktop)](#quick-start-docker-desktop)
- [Manual Installation](#manual-installation)
- [Platform-Specific Notes](#platform-specific-notes)
- [Post-Installation Setup](#post-installation-setup)
- [Troubleshooting](#troubleshooting)

---

## System Requirements

### Backend Requirements

**For GPU Acceleration (Recommended):**
- NVIDIA GPU with CUDA support (GTX 1650 or newer)
- NVIDIA Driver 470+ with CUDA 11.4+
- 8GB+ RAM dedicated to GPU
- Docker with NVIDIA Container Toolkit

**For CPU-Only Operation:**
- Modern CPU (4+ cores recommended)
- 8GB+ RAM (16GB+ recommended)
- Docker Engine

**Common Requirements:**
- Docker 20.10+ or Docker Desktop 4.0+
- 10GB free disk space (for models and cache)
- Linux, macOS, or Windows with WSL2

### Extension Requirements

- VS Code 1.80.0 or newer
- Microphone access
- Network connection to backend

---

## Quick Start (Docker Desktop)

### 1. Clone the Repository

```bash
git clone https://github.com/jedarden/vtthought.git
cd vtthought
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` to configure your settings. The defaults work for local development:

```bash
# Required: Authentication
JWT_SECRET_KEY=generate-a-secure-random-key-here

# Optional: Google OAuth (for production)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

**Generate a secure JWT secret:**

```bash
# On Linux/macOS
openssl rand -hex 32

# On Windows (PowerShell)
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

### 3. Start the Backend

**With GPU Support:**

```bash
docker compose up -d
```

**CPU-Only (no GPU):**

```bash
docker compose -f docker-compose.cpu.yml up -d
```

This will:
- Build the backend container
- Pull and start Ollama LLM service
- Download the Whisper model on first run (~1-3GB)
- Start the health check endpoint

### 4. Verify Backend is Running

```bash
curl http://localhost:8000/api/health
```

Expected response:
```json
{"status": "healthy", "version": "0.1.0"}
```

### 5. Install the Extension

**Option A: Install from VSIX (Recommended for Testing)**

```bash
cd extension
npm install
npm run compile
npm run package  # Generates vtthought-0.1.0.vsix
```

Then in VS Code:
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type "Install from VSIX"
3. Select the generated `vtthought-0.1.0.vsix` file

**Option B: Development Mode**

1. Open VS Code
2. File → Open Folder → Select the `extension/` directory
3. Press `F5` to launch the Extension Development Host

### 6. Run First-Time Setup

The extension will automatically detect it's the first run and guide you through:

1. **Backend URL**: Enter `http://localhost:8000`
2. **Authentication**: Get a token from the backend
   - Open http://localhost:8000 in your browser
   - Log in (Google OAuth or username/password)
   - Copy the token from Settings → Extension Token
3. **Microphone Permission**: Allow microphone access
4. **Connection Test**: Verify everything works

---

## Manual Installation

### Building the Docker Image

```bash
cd backend
docker build -t vtthought-backend:latest .
```

**CPU-only variant:**

```bash
docker build -f Dockerfile.cpu -t vtthought-backend:cpu .
```

### Running with Docker

```bash
docker run -d \
  --name vtthought-backend \
  --gpus all \
  -p 8000:8000 \
  -e ENVIRONMENT=production \
  -e JWT_SECRET_KEY=your-secret-key \
  -e LLM_BASE_URL=http://host.docker.internal:11434 \
  vtthought-backend:latest
```

**CPU-only (remove `--gpus all`):**

```bash
docker run -d \
  --name vtthought-backend \
  -p 8000:8000 \
  -e ENVIRONMENT=production \
  -e STT_DEVICE=cpu \
  -e STT_COMPUTE_TYPE=int8 \
  -e JWT_SECRET_KEY=your-secret-key \
  vtthought-backend:cpu
```

### Running Ollama Separately

If you have Ollama installed outside Docker:

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the model
ollama pull llama3.1:8b

# Start Ollama (runs on port 11434)
ollama serve
```

Then update your `.env`:
```bash
LLM_BASE_URL=http://host.docker.internal:11434
```

---

## Platform-Specific Notes

### Windows

**WSL2 is required** for GPU acceleration. Install Docker Desktop for Windows with WSL2 backend:

1. Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)
2. Enable WSL2 backend in Docker settings
3. Install [NVIDIA WSL](https://developer.nvidia.com/cuda/wsl) for GPU support

**Hostnames:**
- Use `host.docker.internal` instead of `localhost` in containers
- Backend URL in extension: `http://localhost:8000`

### macOS

**Apple Silicon (M1/M2/M3):**

```bash
# CPU-only mode (Ollama supports GPU acceleration)
docker compose -f docker-compose.cpu.yml up -d
```

**Intel Mac:**

- GPU acceleration not supported
- Use CPU-only configuration

### Linux

**NVIDIA GPU Setup:**

```bash
# Install NVIDIA Container Toolkit
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
```

**Verify GPU access:**

```bash
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi
```

---

## Post-Installation Setup

### 1. Configure First-Run Settings

When you first use VTThought, you'll be prompted to:

1. **Connect to Backend**: Enter your backend URL
2. **Get Token**: Open the backend web UI to get your extension token
3. **Allow Microphone**: Grant VS Code microphone permissions
4. **Test Connection**: Verify audio streaming works

### 2. Customize Settings

Open VS Code Settings (Ctrl+,) and search for "VTThought":

| Setting | Description | Default |
|---------|-------------|---------|
| `vtthought.backendUrl` | Backend WebSocket URL | `ws://localhost:8000/api/ws/audio` |
| `vtthought.pushToTalkEnabled` | Hold hotkey to record | `true` |
| `vtthought.autoConnect` | Auto-connect on startup | `true` |
| `vtthought.commandDetection` | Command detection mode | `trailing` |

### 3. Set Up Vocabulary

Add technical terms, project names, and abbreviations:

1. Open Command Palette (Ctrl+Shift+P)
2. Run "VTThought: Manage Vocabulary"
3. Add terms with categories (technical, project, names, acronyms)

---

## Troubleshooting

### Backend won't start

**Problem:** Container exits immediately

```bash
# Check logs
docker logs vtthought-backend

# Common issues:
# - Invalid JWT_SECRET_KEY (must be set)
# - Port 8000 already in use
# - GPU not available (when using GPU configuration)
```

**Solution:** Use CPU-only configuration:
```bash
docker compose -f docker-compose.cpu.yml up -d
```

### Whisper model download fails

**Problem:** Model download hangs or fails

**Solution:** The model is cached in `~/.cache/whisper`. Pre-download manually:

```bash
docker exec -it vtthought-backend python -c \
  "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu')"
```

### Extension can't connect to backend

**Problem:** "Cannot connect to backend" error

**Solutions:**

1. **Check backend is running:**
   ```bash
   curl http://localhost:8000/api/health
   ```

2. **Verify URL in extension settings:**
   - Should be `ws://localhost:8000/api/ws/audio` for local
   - Should be `wss://your-domain.com/api/ws/audio` for remote

3. **Check firewall settings:**
   - Ensure port 8000 is not blocked
   - Allow VS Code through firewall

### Microphone not working

**Problem:** "Microphone access denied" error

**Solutions:**

1. **Grant permission in browser:**
   - VS Code uses a WebView for audio capture
   - Allow microphone when prompted

2. **Check system permissions:**
   - macOS: System Preferences → Privacy → Microphone
   - Windows: Settings → Privacy → Microphone
   - Linux: Check pulseaudio/alsa settings

3. **Test microphone:**
   ```bash
   # On Linux
   arecord -f cd -d 5 test.wav
   aplay test.wav

   # On macOS
   afplay /System/Library/Sounds/Ping.aiff
   ```

### GPU not being used

**Problem:** Transcription is slow despite having a GPU

**Check GPU access:**

```bash
# Inside container
docker exec -it vtthought-backend nvidia-smi

# Check logs for device selection
docker logs vtthought-backend | grep -i "device\|gpu\|cuda"
```

**Verify environment variables:**
```bash
docker exec -it vtthought-backend env | grep STT_
# Should show STT_DEVICE=cuda or STT_DEVICE=auto
```

### Ollama connection fails

**Problem:** "LLM provider connection error"

**Solutions:**

1. **Check Ollama is running:**
   ```bash
   curl http://localhost:11434/api/tags
   ```

2. **Verify model is pulled:**
   ```bash
   docker exec -it vtthought-ollama ollama list
   # Should show llama3.1:8b
   ```

3. **Check network connectivity:**
   ```bash
   # From backend container
   docker exec -it vtthought-backend ping ollama
   ```

---

## Next Steps

- Read the [User Guide](./USER_GUIDE.md) for usage instructions
- See [Troubleshooting](./TROUBLESHOOTING.md) for common issues
- Check the [ADRs](../ADRs/) for architecture details

---

## Getting Help

- **GitHub Issues**: https://github.com/jedarden/vtthought/issues
- **Documentation**: https://github.com/jedarden/vtthought/tree/main/docs
- **Architecture Decisions**: https://github.com/jedarden/vtthought/tree/main/ADRs
