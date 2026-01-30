# ADR-009: Docker Container Architecture

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

The backend must be packaged as a Docker container that can be deployed and accessed from the internet. It needs to handle authentication, audio streaming, STT, and LLM processing.

## Decision Drivers

- **Security**: No exposed ports (zero attack surface)
- **Simplicity**: Easy to deploy and configure
- **Performance**: GPU acceleration for STT/LLM
- **Scalability**: Handle multiple concurrent users
- **Cost**: Efficient resource usage

## Architecture Overview

**Key principles:**
1. **Single Docker image** - everything in one container
2. **No exposed ports** - all external access via Cloudflare Tunnel
3. **Minimal dependencies** - SQLite + in-memory cache, no Redis/Postgres

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      SINGLE CONTAINER DEPLOYMENT                         │
│                      (No exposed ports)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    VOICECODE CONTAINER                           │    │
│  │                    (Single Docker Image)                         │    │
│  │                                                                  │    │
│  │  ┌─────────────────────────────────────────────────────────┐    │    │
│  │  │  cloudflared (tunnel client)                             │    │    │
│  │  │  - Runs as background process (supervisord)              │    │    │
│  │  │  - Outbound connection only                              │    │    │
│  │  └──────────────────────────┬──────────────────────────────┘    │    │
│  │                             │                                    │    │
│  │                             ▼                                    │    │
│  │  ┌─────────────────────────────────────────────────────────┐    │    │
│  │  │  FastAPI Application                                     │    │    │
│  │  │  ├── Auth (JWT/OAuth)                                   │    │    │
│  │  │  ├── WebSocket Handler                                   │    │    │
│  │  │  ├── faster-whisper (STT)                               │    │    │
│  │  │  ├── Ollama client (LLM)                                │    │    │
│  │  │  ├── In-memory cache (TTLCache)                         │    │    │
│  │  │  └── SQLite (user data)                                 │    │    │
│  │  └─────────────────────────────────────────────────────────┘    │    │
│  │                                                                  │    │
│  │  Volumes:                                                        │    │
│  │  ├── /data/voicecode.db (SQLite)                                │    │
│  │  └── /models/ (Whisper models)                                  │    │
│  │                                                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  External (separate deployment):                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Ollama Server (GPU) - can be same host or remote               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

                                 ▲
                                 │
┌────────────────────────────────┴────────────────────────────────────────┐
│                      CLOUDFLARE EDGE                                     │
├─────────────────────────────────────────────────────────────────────────┤
│  • TLS termination (automatic certificates)                              │
│  • DDoS protection                                                       │
│  • WebSocket support                                                     │
│  • Zero Trust access policies (optional)                                 │
│  • WAF rules (optional)                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Why Single Container?

| Multi-Container | Single Container |
|-----------------|------------------|
| docker-compose complexity | `docker run` simplicity |
| Inter-container networking | Localhost only |
| Multiple images to update | One image to update |
| Redis/Postgres overhead | SQLite + in-memory |
| More attack surface | Minimal surface |

## Why No Exposed Ports?

Lessons learned from previous projects (clawdbot/moltbot):

| Exposed Ports | Cloudflare Tunnel |
|---------------|-------------------|
| Firewall management required | All ports closed |
| DDoS vulnerable | Cloudflare protection |
| TLS cert management | Automatic |
| Static IP / port forwarding | Not needed |
| Direct attack surface | Zero attack surface |
| Self-managed WAF | Cloudflare WAF available |

## Single Container Design

### Dockerfile

```dockerfile
# Dockerfile
FROM nvidia/cuda:12.1-runtime-ubuntu22.04

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip \
    ffmpeg libsndfile1 \
    curl supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install cloudflared
RUN curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

# Install Python dependencies
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Download Whisper model at build time
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('large-v3')"

# Copy application
COPY app/ /app/
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
WORKDIR /app

# Create non-root user
RUN useradd -m appuser && \
    mkdir -p /data /models && \
    chown -R appuser:appuser /app /data /models

# Volumes
VOLUME ["/data", "/models"]

# No ports exposed - cloudflared handles external access
# EXPOSE - intentionally omitted

# Run supervisor (manages cloudflared + uvicorn)
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
```

### requirements.txt

```
fastapi==0.109.0
uvicorn[standard]==0.27.0
websockets==12.0
python-jose[cryptography]==3.3.0
httpx==0.26.0
aiosqlite==0.19.0
cachetools==5.3.2
numpy==1.26.3
soundfile==0.12.1
faster-whisper==1.0.0
```

### supervisord.conf

```ini
[supervisord]
nodaemon=true
user=root

[program:cloudflared]
command=/usr/local/bin/cloudflared tunnel run
environment=TUNNEL_TOKEN="%(ENV_CLOUDFLARE_TUNNEL_TOKEN)s"
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:api]
command=/usr/local/bin/uvicorn main:app --host 127.0.0.1 --port 8000
directory=/app
user=appuser
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

### In-Memory Cache (replaces Redis)

```python
from cachetools import TTLCache
from threading import Lock

class InMemoryCache:
    """Simple in-memory cache with TTL - replaces Redis for single-container deployment."""

    def __init__(self, maxsize: int = 1000, ttl: int = 3600):
        self._cache = TTLCache(maxsize=maxsize, ttl=ttl)
        self._lock = Lock()

    def get(self, key: str) -> Optional[str]:
        with self._lock:
            return self._cache.get(key)

    def set(self, key: str, value: str, ttl: Optional[int] = None):
        with self._lock:
            self._cache[key] = value

    def delete(self, key: str):
        with self._lock:
            self._cache.pop(key, None)

    def clear(self):
        with self._lock:
            self._cache.clear()

# Global cache instance
cache = InMemoryCache(maxsize=1000, ttl=3600)

# Usage
cache.set(f"vocab:prompt:{user_id}", prompt)
prompt = cache.get(f"vocab:prompt:{user_id}")
```

## Running the Container

```bash
# Build
docker build -t voicecode:latest .

# Run (single command)
docker run -d \
    --name voicecode \
    --gpus all \
    -e CLOUDFLARE_TUNNEL_TOKEN=your-token \
    -e JWT_SECRET=your-secret \
    -e GITHUB_CLIENT_ID=your-client-id \
    -e GITHUB_CLIENT_SECRET=your-client-secret \
    -e OLLAMA_URL=http://host.docker.internal:11434 \
    -v voicecode-data:/data \
    -v voicecode-models:/models \
    --restart unless-stopped \
    voicecode:latest

# No ports published! Access via Cloudflare Tunnel only.
```

## Ollama Deployment Options

Ollama can run:
1. **Same host**: `OLLAMA_URL=http://host.docker.internal:11434`
2. **Remote server**: `OLLAMA_URL=http://ollama-server.local:11434`
3. **Cloud API fallback**: Use Claude/GPT API instead

```python
# app/config.py
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
LLM_FALLBACK = os.getenv("LLM_FALLBACK", "anthropic")  # anthropic, openai, none
```

## Security by Default

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SECURITY POSTURE                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  NETWORK SECURITY                                                        │
│  ├─ ✅ Zero exposed ports (no -p flag)                                  │
│  ├─ ✅ API listens on 127.0.0.1 only                                    │
│  ├─ ✅ Only cloudflared has external connectivity (outbound only)       │
│  └─ ✅ Host firewall can deny ALL inbound traffic                       │
│                                                                          │
│  CONTAINER SECURITY                                                      │
│  ├─ ✅ App runs as non-root (appuser)                                   │
│  ├─ ✅ Minimal attack surface (single container)                        │
│  └─ ✅ No unnecessary services                                          │
│                                                                          │
│  DATA SECURITY                                                           │
│  ├─ ✅ SQLite file in named volume                                      │
│  ├─ ✅ Easy backup (copy volume)                                        │
│  └─ ✅ In-memory cache (no persistence of transient data)               │
│                                                                          │
│  CLOUDFLARE PROTECTION                                                   │
│  ├─ ✅ DDoS mitigation (automatic)                                      │
│  ├─ ✅ TLS 1.3 (automatic)                                              │
│  ├─ ✅ WAF rules (optional)                                             │
│  └─ ✅ Access policies / Zero Trust (optional)                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Service Communication

### Internal Whisper Service

```python
# whisper_service.py
from flask import Flask, request, jsonify
from faster_whisper import WhisperModel
import numpy as np
import io

app = Flask(__name__)
model = WhisperModel("large-v3", device="cuda", compute_type="float16")

@app.route("/transcribe", methods=["POST"])
def transcribe():
    audio_bytes = request.data
    audio = np.frombuffer(audio_bytes, dtype=np.float32)

    segments, info = model.transcribe(audio, beam_size=5, language="en")
    text = " ".join(segment.text for segment in segments)

    return jsonify({"text": text, "language": info.language})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
```

### API Service Main

```python
# main.py
from fastapi import FastAPI, WebSocket, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
import redis.asyncio as redis

app = FastAPI(title="VoiceCode API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependencies
redis_client = redis.from_url(os.environ["REDIS_URL"])
whisper_url = os.environ["WHISPER_URL"]
ollama_url = os.environ["OLLAMA_URL"]

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket, token: str):
    # Validate token
    user = await validate_token(token)
    if not user:
        await websocket.close(code=4001)
        return

    await websocket.accept()

    try:
        while True:
            data = await websocket.receive()

            if "bytes" in data:
                # Process audio
                audio = data["bytes"]

                # Send to Whisper
                async with httpx.AsyncClient() as client:
                    whisper_response = await client.post(
                        f"{whisper_url}/transcribe",
                        content=audio,
                        timeout=30.0
                    )
                    raw_text = whisper_response.json()["text"]

                # Send to Ollama for cleanup
                ollama_response = await client.post(
                    f"{ollama_url}/api/generate",
                    json={
                        "model": "llama3.1:8b",
                        "prompt": f"Clean up: {raw_text}",
                        "stream": False
                    },
                    timeout=30.0
                )
                enhanced_text = ollama_response.json()["response"]

                await websocket.send_json({
                    "type": "final",
                    "raw": raw_text,
                    "enhanced": enhanced_text
                })

    except Exception as e:
        await websocket.close(code=1011)
```

## GPU Sharing Strategy

When running Whisper and Ollama on the same GPU:

```yaml
# Option 1: Time-sharing (simpler)
# Both services use the same GPU, rely on CUDA scheduler

# Option 2: Memory limits
whisper:
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            capabilities: [gpu]
      limits:
        memory: 4G  # Limit GPU memory

ollama:
  environment:
    - OLLAMA_GPU_MEMORY=4G
```

## Health Checks

```bash
# Docker healthcheck in Dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://127.0.0.1:8000/health || exit 1
```

```python
# app/main.py
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "tunnel": "connected",  # cloudflared manages this
        "whisper": "loaded",
        "database": "ok"
    }
```

## Environment Variables

```bash
# Required
CLOUDFLARE_TUNNEL_TOKEN=your-tunnel-token
JWT_SECRET=your-secret-key
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Optional
OLLAMA_URL=http://host.docker.internal:11434
WHISPER_MODEL=large-v3
LOG_LEVEL=info
```

## Deployment Commands

```bash
# Build
docker build -t voicecode:latest .

# Run
docker run -d \
    --name voicecode \
    --gpus all \
    -e CLOUDFLARE_TUNNEL_TOKEN=xxx \
    -e JWT_SECRET=xxx \
    -e GITHUB_CLIENT_ID=xxx \
    -e GITHUB_CLIENT_SECRET=xxx \
    -v voicecode-data:/data \
    --restart unless-stopped \
    voicecode:latest

# View logs
docker logs -f voicecode

# Shell access
docker exec -it voicecode bash

# Update
docker pull voicecode:latest  # or rebuild
docker stop voicecode && docker rm voicecode
# Re-run with same command above

# Backup SQLite
docker run --rm -v voicecode-data:/data -v $(pwd):/backup \
    alpine cp /data/voicecode.db /backup/voicecode-$(date +%Y%m%d).db
```

## Firewall Configuration

Since no ports are exposed, the host firewall can be fully locked down:

```bash
# UFW example - deny all inbound
ufw default deny incoming
ufw default allow outgoing
ufw enable

# iptables example
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
```

## Consequences

### Positive
- **Single docker run command** - no compose needed
- GPU acceleration for STT
- Zero exposed ports (secure by default)
- TLS handled by Cloudflare (no cert management)
- DDoS protection included
- Simple backup (copy SQLite file)
- No Redis/Postgres overhead

### Negative
- Requires NVIDIA GPU for Whisper
- Ollama runs separately (or use cloud LLM API)
- Single container = single point of failure
- Dependency on Cloudflare

### Resource Requirements

| Component | CPU | RAM | GPU VRAM |
|-----------|-----|-----|----------|
| cloudflared | 0.1 cores | 50MB | - |
| FastAPI | 1 core | 500MB | - |
| faster-whisper | 2 cores | 2GB | 4GB |
| SQLite | negligible | ~10MB | - |
| In-memory cache | negligible | ~50MB | - |
| **Container Total** | **~3 cores** | **~2.6GB** | **4GB** |

**External (if using local Ollama):**

| Component | CPU | RAM | GPU VRAM |
|-----------|-----|-----|----------|
| Ollama (llama3.1:8b) | 2 cores | 8GB | 6GB |

## Related ADRs
- ADR-001: System Architecture
- ADR-005: STT Engine Selection
- ADR-006: LLM Post-Processing
- ADR-010: Security Model
- ADR-011: User Personalization
