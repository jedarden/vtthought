# ADR-019: Observability

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

The backend needs observability for:
1. Extension health checks (is backend ready?)
2. Debugging issues (what went wrong?)
3. Performance monitoring (is it fast enough?)
4. Usage understanding (how is it being used?)

## Decision Drivers

- **Simplicity**: No external dependencies (Prometheus, Grafana, etc.)
- **Self-hosted friendly**: Works in single-container deployment
- **Low overhead**: Minimal performance impact
- **Actionable**: Logs and metrics that help debug issues

## Decision

**Built-in observability** with structured logging, health endpoints, and optional metrics endpoint. No external dependencies required.

## Health Endpoints

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    HEALTH ENDPOINTS                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  GET /health                                                                 │
│  └─ Basic liveness check                                                    │
│  └─ Returns 200 if process is running                                      │
│  └─ Used by: Docker healthcheck, load balancers                            │
│                                                                              │
│  GET /health/ready                                                           │
│  └─ Readiness check - all dependencies available                           │
│  └─ Checks: Whisper model loaded, Ollama reachable, SQLite accessible      │
│  └─ Used by: Extension startup, Kubernetes readiness probe                 │
│                                                                              │
│  GET /health/detailed                                                        │
│  └─ Detailed status of all components (auth required)                      │
│  └─ Used by: Admin debugging                                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation

```python
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime
import asyncio

router = APIRouter(prefix="/health", tags=["health"])

# Track startup time
START_TIME = datetime.utcnow()

@router.get("")
async def health_check():
    """Basic liveness check. Returns 200 if process is running."""
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@router.get("/ready")
async def readiness_check():
    """
    Readiness check. Returns 200 only if all dependencies are available.
    Extension should call this before attempting transcription.
    """
    checks = {}
    all_ready = True

    # Check Whisper model
    try:
        whisper_ready = await check_whisper_ready()
        checks["whisper"] = {"status": "ok" if whisper_ready else "not_ready"}
        if not whisper_ready:
            all_ready = False
    except Exception as e:
        checks["whisper"] = {"status": "error", "message": str(e)}
        all_ready = False

    # Check Ollama (if configured)
    if OLLAMA_URL:
        try:
            ollama_ready = await check_ollama_ready()
            checks["ollama"] = {"status": "ok" if ollama_ready else "not_ready"}
            if not ollama_ready:
                all_ready = False
        except Exception as e:
            checks["ollama"] = {"status": "error", "message": str(e)}
            all_ready = False

    # Check SQLite
    try:
        db_ready = await check_database_ready()
        checks["database"] = {"status": "ok" if db_ready else "not_ready"}
        if not db_ready:
            all_ready = False
    except Exception as e:
        checks["database"] = {"status": "error", "message": str(e)}
        all_ready = False

    status_code = 200 if all_ready else 503

    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ready" if all_ready else "not_ready",
            "checks": checks,
            "timestamp": datetime.utcnow().isoformat()
        }
    )


@router.get("/detailed")
async def detailed_health(user: User = Depends(get_current_user)):
    """
    Detailed health check with performance metrics.
    Requires authentication.
    """
    uptime = (datetime.utcnow() - START_TIME).total_seconds()

    # Run all checks with timing
    checks = {}

    # Whisper check with timing
    start = datetime.utcnow()
    whisper_ok = await check_whisper_ready()
    whisper_time = (datetime.utcnow() - start).total_seconds() * 1000
    checks["whisper"] = {
        "status": "ok" if whisper_ok else "error",
        "latency_ms": round(whisper_time, 2)
    }

    # Ollama check with timing
    if OLLAMA_URL:
        start = datetime.utcnow()
        ollama_ok = await check_ollama_ready()
        ollama_time = (datetime.utcnow() - start).total_seconds() * 1000
        checks["ollama"] = {
            "status": "ok" if ollama_ok else "error",
            "url": OLLAMA_URL,
            "latency_ms": round(ollama_time, 2)
        }

    # Database check
    start = datetime.utcnow()
    db_ok = await check_database_ready()
    db_time = (datetime.utcnow() - start).total_seconds() * 1000
    checks["database"] = {
        "status": "ok" if db_ok else "error",
        "latency_ms": round(db_time, 2)
    }

    # Memory usage
    import psutil
    process = psutil.Process()
    memory = process.memory_info()

    return {
        "status": "ok" if all(c["status"] == "ok" for c in checks.values()) else "degraded",
        "uptime_seconds": round(uptime, 2),
        "checks": checks,
        "memory": {
            "rss_mb": round(memory.rss / 1024 / 1024, 2),
            "vms_mb": round(memory.vms / 1024 / 1024, 2)
        },
        "version": APP_VERSION,
        "timestamp": datetime.utcnow().isoformat()
    }


# Dependency check functions
async def check_whisper_ready() -> bool:
    """Check if Whisper model is loaded and ready."""
    try:
        # Try a minimal transcription
        test_audio = generate_silence(0.1)  # 100ms silence
        result = whisper_model.transcribe(test_audio)
        return True
    except Exception:
        return False


async def check_ollama_ready() -> bool:
    """Check if Ollama is reachable."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{OLLAMA_URL}/api/tags",
                timeout=5.0
            )
            return response.status_code == 200
    except Exception:
        return False


async def check_database_ready() -> bool:
    """Check if SQLite database is accessible."""
    try:
        async with get_db() as db:
            await db.execute("SELECT 1")
            return True
    except Exception:
        return False
```

### Docker Healthcheck

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1
```

## Structured Logging

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LOGGING STRATEGY                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  FORMAT: Structured JSON                                                     │
│  ├─ Machine-parseable                                                       │
│  ├─ Easy to grep/filter                                                     │
│  └─ Compatible with log aggregators                                         │
│                                                                              │
│  LEVELS                                                                      │
│  ├─ DEBUG: Detailed troubleshooting (disabled in prod)                     │
│  ├─ INFO: Normal operations (request received, completed)                  │
│  ├─ WARNING: Recoverable issues (retry, fallback)                          │
│  └─ ERROR: Failures requiring attention                                    │
│                                                                              │
│  CONTEXT                                                                     │
│  ├─ request_id: Trace requests across logs                                 │
│  ├─ user_id: Associate with user (for debugging)                           │
│  ├─ duration_ms: How long operations took                                  │
│  └─ component: Which part of system (whisper, ollama, ws)                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation

```python
import structlog
import logging
import sys
from uuid import uuid4
from contextvars import ContextVar

# Context variable for request ID
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")

def configure_logging(log_level: str = "INFO", json_format: bool = True):
    """Configure structured logging."""

    # Processors for structlog
    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    if json_format:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=True))

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level.upper())
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

# Get logger instance
logger = structlog.get_logger()


# Middleware to add request context
@app.middleware("http")
async def logging_middleware(request: Request, call_next):
    request_id = str(uuid4())[:8]
    request_id_ctx.set(request_id)

    # Bind request context
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        path=request.url.path,
        method=request.method
    )

    start_time = time.time()

    try:
        response = await call_next(request)
        duration_ms = (time.time() - start_time) * 1000

        logger.info(
            "request_completed",
            status_code=response.status_code,
            duration_ms=round(duration_ms, 2)
        )

        # Add request ID to response headers
        response.headers["X-Request-ID"] = request_id

        return response

    except Exception as e:
        duration_ms = (time.time() - start_time) * 1000
        logger.error(
            "request_failed",
            error=str(e),
            error_type=type(e).__name__,
            duration_ms=round(duration_ms, 2)
        )
        raise


# Example log output (JSON format)
"""
{"event": "request_completed", "request_id": "a1b2c3d4", "path": "/ws/transcribe",
 "method": "GET", "status_code": 200, "duration_ms": 1523.45, "level": "info",
 "timestamp": "2026-01-30T10:15:30.123456Z"}

{"event": "transcription_completed", "request_id": "a1b2c3d4", "user_id": "user_123",
 "audio_duration_ms": 5230, "whisper_ms": 890, "ollama_ms": 234, "level": "info",
 "timestamp": "2026-01-30T10:15:31.567890Z"}

{"event": "ollama_timeout", "request_id": "a1b2c3d4", "user_id": "user_123",
 "timeout_ms": 5000, "level": "warning", "timestamp": "2026-01-30T10:15:35.000000Z"}
"""
```

### Logging Examples

```python
# Transcription logging
async def transcribe_audio(audio: bytes, user_id: str) -> str:
    structlog.contextvars.bind_contextvars(user_id=user_id)

    logger.info("transcription_started", audio_bytes=len(audio))

    # Whisper transcription
    whisper_start = time.time()
    try:
        raw_text = await whisper.transcribe(audio)
        whisper_ms = (time.time() - whisper_start) * 1000
        logger.info("whisper_completed", duration_ms=round(whisper_ms, 2))
    except Exception as e:
        logger.error("whisper_failed", error=str(e))
        raise

    # LLM cleanup
    ollama_start = time.time()
    try:
        cleaned_text = await ollama.cleanup(raw_text)
        ollama_ms = (time.time() - ollama_start) * 1000
        logger.info("ollama_completed", duration_ms=round(ollama_ms, 2))
    except Exception as e:
        logger.warning("ollama_failed", error=str(e), fallback="using raw text")
        cleaned_text = raw_text

    logger.info(
        "transcription_completed",
        raw_length=len(raw_text),
        cleaned_length=len(cleaned_text)
    )

    return cleaned_text
```

## Metrics

Optional metrics endpoint for monitoring (no external dependencies):

```python
from dataclasses import dataclass, field
from collections import defaultdict
import threading
import time

@dataclass
class Metrics:
    """Simple in-memory metrics collector."""

    # Counters
    transcriptions_total: int = 0
    transcriptions_failed: int = 0
    websocket_connections: int = 0

    # Histograms (store recent values for percentiles)
    transcription_durations: list = field(default_factory=list)
    whisper_durations: list = field(default_factory=list)
    ollama_durations: list = field(default_factory=list)

    # Keep last N values for percentile calculation
    max_samples: int = 1000

    _lock: threading.Lock = field(default_factory=threading.Lock)

    def record_transcription(self, duration_ms: float, success: bool = True):
        with self._lock:
            self.transcriptions_total += 1
            if not success:
                self.transcriptions_failed += 1
            self._add_sample(self.transcription_durations, duration_ms)

    def record_whisper(self, duration_ms: float):
        with self._lock:
            self._add_sample(self.whisper_durations, duration_ms)

    def record_ollama(self, duration_ms: float):
        with self._lock:
            self._add_sample(self.ollama_durations, duration_ms)

    def _add_sample(self, samples: list, value: float):
        samples.append(value)
        if len(samples) > self.max_samples:
            samples.pop(0)

    def get_percentile(self, samples: list, p: float) -> float:
        if not samples:
            return 0.0
        sorted_samples = sorted(samples)
        index = int(len(sorted_samples) * p / 100)
        return sorted_samples[min(index, len(sorted_samples) - 1)]

    def to_dict(self) -> dict:
        with self._lock:
            return {
                "transcriptions": {
                    "total": self.transcriptions_total,
                    "failed": self.transcriptions_failed,
                    "success_rate": (
                        (self.transcriptions_total - self.transcriptions_failed)
                        / max(self.transcriptions_total, 1)
                    )
                },
                "websocket_connections": self.websocket_connections,
                "latency": {
                    "transcription_ms": {
                        "p50": self.get_percentile(self.transcription_durations, 50),
                        "p95": self.get_percentile(self.transcription_durations, 95),
                        "p99": self.get_percentile(self.transcription_durations, 99),
                    },
                    "whisper_ms": {
                        "p50": self.get_percentile(self.whisper_durations, 50),
                        "p95": self.get_percentile(self.whisper_durations, 95),
                    },
                    "ollama_ms": {
                        "p50": self.get_percentile(self.ollama_durations, 50),
                        "p95": self.get_percentile(self.ollama_durations, 95),
                    }
                }
            }


# Global metrics instance
metrics = Metrics()


@router.get("/metrics")
async def get_metrics(user: User = Depends(get_current_user)):
    """Get current metrics. Requires authentication."""
    return metrics.to_dict()
```

### Metrics Usage

```python
async def transcribe_audio(audio: bytes, user_id: str) -> str:
    start_time = time.time()
    success = True

    try:
        # Whisper
        whisper_start = time.time()
        raw_text = await whisper.transcribe(audio)
        metrics.record_whisper((time.time() - whisper_start) * 1000)

        # Ollama
        ollama_start = time.time()
        cleaned_text = await ollama.cleanup(raw_text)
        metrics.record_ollama((time.time() - ollama_start) * 1000)

        return cleaned_text

    except Exception as e:
        success = False
        raise

    finally:
        duration_ms = (time.time() - start_time) * 1000
        metrics.record_transcription(duration_ms, success)
```

## Extension Health Check

```typescript
class BackendHealthChecker {
    private backendUrl: string;
    private checkInterval: number = 30000;  // 30 seconds
    private timer: NodeJS.Timeout | null = null;
    private isHealthy: boolean = false;

    async start(): Promise<void> {
        await this.check();
        this.timer = setInterval(() => this.check(), this.checkInterval);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async check(): Promise<boolean> {
        try {
            const response = await fetch(`${this.backendUrl}/health/ready`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });

            const wasHealthy = this.isHealthy;
            this.isHealthy = response.ok;

            // Notify on state change
            if (!wasHealthy && this.isHealthy) {
                this.onBecameHealthy();
            } else if (wasHealthy && !this.isHealthy) {
                this.onBecameUnhealthy();
            }

            return this.isHealthy;

        } catch (error) {
            this.isHealthy = false;
            return false;
        }
    }

    private onBecameHealthy(): void {
        vscode.window.showInformationMessage('Voice Code: Connected to backend');
        vscode.commands.executeCommand('setContext', 'voicecode.backendHealthy', true);
    }

    private onBecameUnhealthy(): void {
        vscode.window.showWarningMessage('Voice Code: Backend unavailable');
        vscode.commands.executeCommand('setContext', 'voicecode.backendHealthy', false);
    }
}
```

## Log Retention

```python
# Log rotation configuration (supervisord or systemd)
# Keep last 7 days, max 100MB per file

# supervisord.conf
"""
[program:voicecode]
command=/usr/bin/python -m uvicorn main:app
stdout_logfile=/var/log/voicecode/app.log
stdout_logfile_maxbytes=100MB
stdout_logfile_backups=7
stderr_logfile=/var/log/voicecode/error.log
stderr_logfile_maxbytes=50MB
stderr_logfile_backups=7
"""
```

## Configuration

```python
class ObservabilityConfig(BaseSettings):
    # Logging
    log_level: str = "INFO"  # DEBUG, INFO, WARNING, ERROR
    log_format: str = "json"  # json, console
    log_file: Optional[str] = None  # If set, also write to file

    # Metrics
    metrics_enabled: bool = True
    metrics_retention_samples: int = 1000

    # Health checks
    health_check_timeout: int = 5  # seconds

    class Config:
        env_prefix = "VOICECODE_"
```

## Consequences

### Positive
- **Self-contained**: No external dependencies
- **Debuggable**: Structured logs with request tracing
- **Extension-aware**: Health endpoints for connection status
- **Low overhead**: Minimal performance impact

### Negative
- **No persistence**: Metrics reset on restart
- **No alerting**: Manual log monitoring required
- **Limited dashboards**: No built-in visualization

### Future Enhancements
- Prometheus metrics export (optional)
- OpenTelemetry tracing (optional)
- Log shipping to external service (optional)

## Related ADRs
- ADR-009: Docker Container Architecture (healthcheck)
- ADR-015: Error Handling (error logging)
- ADR-013: Extension UI (health status display)
