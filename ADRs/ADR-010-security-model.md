# ADR-010: Security Model

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

The voice-to-code system handles sensitive data (voice recordings, code context) and is exposed to the internet. Security must be comprehensive.

## Decision Drivers

- **Data protection**: Voice recordings are sensitive
- **Authentication**: Only authorized users access the service
- **Transport security**: All data encrypted in transit
- **Abuse prevention**: Rate limiting, resource protection
- **Compliance**: GDPR, privacy regulations

## Threat Model

```
┌──────────────────────────────────────────────────────────────────────┐
│                         THREAT MODEL                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  EXTERNAL THREATS                                                     │
│  ├─ Unauthorized access (stolen/leaked tokens)                       │
│  ├─ Man-in-the-middle attacks                                        │
│  ├─ Denial of service                                                │
│  ├─ Injection attacks (prompt injection)                             │
│  └─ Data exfiltration                                                │
│                                                                       │
│  INTERNAL THREATS                                                     │
│  ├─ Insider access to voice recordings                               │
│  ├─ Cross-tenant data leakage                                        │
│  └─ Privilege escalation                                             │
│                                                                       │
│  COMPLIANCE REQUIREMENTS                                              │
│  ├─ Audio data retention policies                                    │
│  ├─ User data deletion (right to be forgotten)                       │
│  └─ Audit logging                                                    │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Security Controls

### 1. Transport Security

```
┌──────────────────────────────────────────────────────────────────────┐
│                      TRANSPORT SECURITY                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Client ────────────────────────────────────────────────▶ Server     │
│          │                                              │            │
│          │  TLS 1.3                                     │            │
│          │  HSTS enabled                                │            │
│          │  Certificate pinning (optional)              │            │
│          │                                              │            │
│          └──────────────────────────────────────────────┘            │
│                                                                       │
│  WebSocket Security:                                                  │
│  - wss:// only (no ws://)                                            │
│  - Origin validation                                                  │
│  - Token in query parameter (not header for WS)                      │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Traefik TLS Configuration:**

```yaml
# traefik.yml
tls:
  options:
    default:
      minVersion: VersionTLS12
      sniStrict: true
      cipherSuites:
        - TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384
        - TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
        - TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305
        - TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305
```

### 2. Authentication & Authorization

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer
from jose import jwt, JWTError
from datetime import datetime, timedelta

security = HTTPBearer()

async def get_current_user(token: str = Depends(security)) -> User:
    try:
        payload = jwt.decode(
            token.credentials,
            SECRET_KEY,
            algorithms=["HS256"]
        )

        user_id = payload.get("user_id")
        exp = payload.get("exp")

        if not user_id or datetime.utcnow() > datetime.fromtimestamp(exp):
            raise HTTPException(status_code=401)

        user = await get_user(user_id)
        if not user:
            raise HTTPException(status_code=401)

        return user

    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )
```

**Token Security:**

```python
def create_access_token(user_id: str) -> str:
    return jwt.encode(
        {
            "user_id": user_id,
            "exp": datetime.utcnow() + timedelta(days=30),
            "iat": datetime.utcnow(),
            "jti": str(uuid.uuid4()),  # Unique token ID for revocation
        },
        SECRET_KEY,
        algorithm="HS256"
    )
```

### 3. Rate Limiting

```python
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@app.websocket("/ws/transcribe")
@limiter.limit("60/minute")  # 60 transcriptions per minute
async def websocket_transcribe(websocket: WebSocket, token: str):
    # ...
    pass

# Per-user limits
class RateLimiter:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def check_limit(self, user_id: str, limit: int = 100) -> bool:
        key = f"rate_limit:{user_id}:{datetime.now().minute}"
        count = await self.redis.incr(key)
        await self.redis.expire(key, 60)
        return count <= limit
```

### 4. Audio Data Handling

```
┌──────────────────────────────────────────────────────────────────────┐
│                    AUDIO DATA LIFECYCLE                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  1. TRANSMISSION                                                      │
│     - Encrypted via TLS                                              │
│     - No logging of audio content                                    │
│                                                                       │
│  2. PROCESSING                                                        │
│     - Audio held in memory only                                      │
│     - Processed immediately, then discarded                          │
│     - No disk persistence by default                                 │
│                                                                       │
│  3. OPTIONAL RETENTION (user opt-in)                                 │
│     - Encrypted at rest (AES-256)                                    │
│     - User-controlled deletion                                       │
│     - Automatic expiry (7 days default)                              │
│                                                                       │
│  4. TRANSCRIPTION OUTPUT                                              │
│     - Not stored unless user enables history                         │
│     - Anonymized for analytics (no PII)                              │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```python
class AudioProcessor:
    def __init__(self, store_audio: bool = False):
        self.store_audio = store_audio

    async def process(self, audio: bytes, user_id: str) -> str:
        try:
            # Process in memory
            transcription = await self.transcribe(audio)

            if self.store_audio and user_consents(user_id):
                # Encrypt and store with expiry
                encrypted = self.encrypt_audio(audio)
                await self.store_with_expiry(user_id, encrypted, ttl=7*24*3600)

            return transcription

        finally:
            # Ensure audio is cleared from memory
            del audio

    def encrypt_audio(self, audio: bytes) -> bytes:
        from cryptography.fernet import Fernet
        return Fernet(ENCRYPTION_KEY).encrypt(audio)
```

### 5. Input Validation

```python
from pydantic import BaseModel, validator
import re

class TranscriptionConfig(BaseModel):
    language: str = "en"
    enhance_with_llm: bool = True
    voice_commands: bool = True

    @validator("language")
    def validate_language(cls, v):
        allowed = ["en", "es", "fr", "de", "it", "pt", "zh", "ja", "ko"]
        if v not in allowed:
            raise ValueError(f"Language must be one of {allowed}")
        return v

# Sanitize LLM inputs to prevent prompt injection
def sanitize_for_llm(text: str) -> str:
    # Remove potential prompt injection patterns
    text = re.sub(r'(ignore|forget|disregard).*instructions', '', text, flags=re.I)
    text = re.sub(r'system:', '', text, flags=re.I)
    text = re.sub(r'<\|.*?\|>', '', text)  # Remove special tokens
    return text.strip()
```

### 6. Audit Logging

```python
import structlog
from datetime import datetime

logger = structlog.get_logger()

class AuditLogger:
    async def log_event(
        self,
        event_type: str,
        user_id: str,
        details: dict,
        ip_address: str
    ):
        await logger.ainfo(
            event_type,
            user_id=user_id,
            ip_address=ip_address,
            timestamp=datetime.utcnow().isoformat(),
            **details
        )

        # Store in database for compliance
        await self.db.insert("audit_log", {
            "event_type": event_type,
            "user_id": user_id,
            "ip_address": ip_address,
            "details": details,
            "timestamp": datetime.utcnow()
        })

# Usage
@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket, token: str):
    user = await validate_token(token)

    await audit_logger.log_event(
        "transcription_session_start",
        user.id,
        {"session_id": session_id},
        websocket.client.host
    )
```

### 7. Secrets Management

```python
import os
from functools import lru_cache
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    jwt_secret: str
    github_client_id: str
    github_client_secret: str
    encryption_key: str
    redis_url: str

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings() -> Settings:
    return Settings()

# Never log secrets
def safe_log_config(config: dict) -> dict:
    sensitive_keys = ["secret", "password", "key", "token"]
    return {
        k: "***" if any(s in k.lower() for s in sensitive_keys) else v
        for k, v in config.items()
    }
```

### 8. CORS Configuration

```python
from fastapi.middleware.cors import CORSMiddleware

# Production: restrict to known origins
ALLOWED_ORIGINS = [
    "vscode-webview://",  # VS Code WebViews
    "https://voicecode.example.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=3600,
)
```

## Security Checklist

```
┌──────────────────────────────────────────────────────────────────────┐
│                    SECURITY CHECKLIST                                 │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ☐ TLS 1.2+ enforced for all connections                            │
│  ☐ JWT tokens with expiry and unique IDs                            │
│  ☐ Rate limiting per user and IP                                    │
│  ☐ Audio not persisted by default                                   │
│  ☐ Audio encrypted if stored                                        │
│  ☐ Input validation on all endpoints                                │
│  ☐ Prompt injection protection for LLM                              │
│  ☐ Audit logging for all actions                                    │
│  ☐ Secrets in environment variables, not code                       │
│  ☐ CORS restricted to known origins                                 │
│  ☐ WebSocket origin validation                                      │
│  ☐ Container runs as non-root user                                  │
│  ☐ Dependencies scanned for vulnerabilities                         │
│  ☐ Security headers (HSTS, X-Frame-Options, etc.)                   │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Incident Response

```python
class SecurityIncidentHandler:
    async def handle_suspicious_activity(self, user_id: str, reason: str):
        # Log incident
        await audit_logger.log_event(
            "security_incident",
            user_id,
            {"reason": reason, "action": "token_revoked"}
        )

        # Revoke all user tokens
        await self.revoke_user_tokens(user_id)

        # Alert administrators
        await self.send_alert(f"Suspicious activity for user {user_id}: {reason}")

    async def revoke_user_tokens(self, user_id: str):
        await redis.sadd(f"revoked_tokens:{user_id}", "*")
        await redis.expire(f"revoked_tokens:{user_id}", 30*24*3600)
```

## Consequences

### Positive
- Comprehensive security coverage
- Privacy-respecting design
- Compliance-ready architecture
- Audit trail for all actions

### Negative
- Additional complexity
- Some latency from security checks
- Storage costs for audit logs

### Security vs. Usability Tradeoffs
- Token expiry: 30 days (balance security/convenience)
- Rate limits: 60/min (allows normal use, prevents abuse)
- Audio retention: Off by default (privacy first)

## Related ADRs
- ADR-002: Authentication Strategy
- ADR-009: Docker Container Architecture
