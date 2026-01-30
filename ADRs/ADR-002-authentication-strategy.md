# ADR-002: Authentication Strategy

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

The voice-to-code system needs authentication to:
1. Prevent unauthorized access to the backend
2. Enable per-user settings and vocabulary
3. Secure WebSocket connections

The backend is self-hosted by users, exposed via Cloudflare Tunnel (default) or direct access.

## Decision Drivers

- **Flexibility**: Backend owner chooses auth method (Google, password, SSO)
- **Simplicity**: Extension doesn't implement OAuth
- **Security**: Tokens stored securely, easily revocable
- **Self-hosted friendly**: Works without third-party dependencies

## Decision

**Backend owns all authentication. Extension uses long-lived tokens.**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AUTH ARCHITECTURE                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  BACKEND (owns auth)                                                 │    │
│  │                                                                      │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │    │
│  │  │Google OAuth │  │ User/Pass   │  │ SSO/SAML    │  ← configurable  │    │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                  │    │
│  │         │                │                │                          │    │
│  │         └────────────────┼────────────────┘                          │    │
│  │                          ▼                                           │    │
│  │                  ┌───────────────┐                                   │    │
│  │                  │ User Session  │                                   │    │
│  │                  └───────┬───────┘                                   │    │
│  │                          │                                           │    │
│  │                          ▼                                           │    │
│  │                  ┌───────────────┐                                   │    │
│  │                  │Extension Token│ ← user copies this                │    │
│  │                  │ vct_abc123... │                                   │    │
│  │                  └───────────────┘                                   │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  EXTENSION (uses token)                                              │    │
│  │                                                                      │    │
│  │  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐          │    │
│  │  │ User pastes │ ───▶ │ Store in    │ ───▶ │ Send with   │          │    │
│  │  │ token       │      │ SecretStore │      │ all requests│          │    │
│  │  └─────────────┘      └─────────────┘      └─────────────┘          │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Backend Auth Options

The backend supports multiple auth methods. Operator chooses during deployment:

### Option A: Google OAuth (Recommended for ease)

```python
from authlib.integrations.starlette_client import OAuth

oauth = OAuth()
oauth.register(
    name='google',
    client_id=os.environ['GOOGLE_CLIENT_ID'],
    client_secret=os.environ['GOOGLE_CLIENT_SECRET'],
    authorize_url='https://accounts.google.com/o/oauth2/auth',
    access_token_url='https://oauth2.googleapis.com/token',
    client_kwargs={'scope': 'openid email profile'},
)

@app.get("/auth/google")
async def google_login(request: Request):
    redirect_uri = request.url_for('google_callback')
    return await oauth.google.authorize_redirect(request, redirect_uri)

@app.get("/auth/google/callback")
async def google_callback(request: Request):
    token = await oauth.google.authorize_access_token(request)
    user_info = token.get('userinfo')

    user = await get_or_create_user(
        email=user_info['email'],
        name=user_info.get('name'),
        provider='google',
        provider_id=user_info['sub']
    )

    # Create session and redirect to settings page
    session = await create_session(user)
    return RedirectResponse(url='/settings?new_session=true')
```

### Option B: Username/Password

```python
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

@app.post("/auth/register")
async def register(email: str, password: str):
    hashed = pwd_context.hash(password)
    user = await create_user(email=email, password_hash=hashed)
    return {"message": "Registration successful"}

@app.post("/auth/login")
async def login(email: str, password: str):
    user = await get_user_by_email(email)
    if not user or not pwd_context.verify(password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")

    session = await create_session(user)
    return RedirectResponse(url='/settings')
```

### Option C: No Auth (Single User)

For personal deployments behind Cloudflare Access or VPN:

```python
# Single user mode - trust all requests
SINGLE_USER_MODE = os.environ.get('SINGLE_USER_MODE', 'false') == 'true'

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if SINGLE_USER_MODE:
        request.state.user = await get_default_user()
        return await call_next(request)

    # Normal auth flow
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        raise HTTPException(401, "Missing token")

    user = await validate_extension_token(token)
    request.state.user = user
    return await call_next(request)
```

## Extension Token

### Token Format

```
vct_<base62-encoded-32-random-bytes>

Example: vct_7kX9mP2nQ4wR8tY6uI3oL5jH1gF0dS
```

### Token Generation

```python
import secrets
import base62

def generate_extension_token() -> str:
    """Generate a secure extension token."""
    random_bytes = secrets.token_bytes(32)
    encoded = base62.encodebytes(random_bytes)
    return f"vct_{encoded}"

@app.post("/api/tokens")
async def create_extension_token(user: User = Depends(get_current_user)):
    """Generate a new extension token for the user."""
    token_value = generate_extension_token()

    # Store hash of token (never store plaintext)
    token_hash = hashlib.sha256(token_value.encode()).hexdigest()

    await db.execute(
        """INSERT INTO extension_tokens (user_id, token_hash, created_at)
           VALUES (?, ?, ?)""",
        (user.id, token_hash, datetime.utcnow())
    )

    # Return plaintext token only once
    return {"token": token_value}

@app.delete("/api/tokens/{token_id}")
async def revoke_extension_token(
    token_id: str,
    user: User = Depends(get_current_user)
):
    """Revoke an extension token."""
    await db.execute(
        "DELETE FROM extension_tokens WHERE id = ? AND user_id = ?",
        (token_id, user.id)
    )
    return {"message": "Token revoked"}
```

### Token Validation

```python
async def validate_extension_token(token: str) -> User:
    """Validate an extension token and return the user."""
    if not token.startswith('vct_'):
        raise HTTPException(401, "Invalid token format")

    token_hash = hashlib.sha256(token.encode()).hexdigest()

    result = await db.execute(
        """SELECT u.* FROM users u
           JOIN extension_tokens t ON u.id = t.user_id
           WHERE t.token_hash = ?""",
        (token_hash,)
    )

    user = result.fetchone()
    if not user:
        raise HTTPException(401, "Invalid token")

    return User(**user)
```

## WebSocket Authentication

```python
@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket, token: str = Query(...)):
    """WebSocket endpoint with token auth via query parameter."""
    try:
        user = await validate_extension_token(token)
    except HTTPException:
        await websocket.close(code=4001, reason="Invalid token")
        return

    await websocket.accept()

    # Load user preferences
    prefs = await get_user_preferences(user.id)
    vocab = await get_user_vocabulary(user.id)

    # Handle audio streaming...
```

## Extension Token Storage

```typescript
class TokenManager {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async storeToken(token: string): Promise<void> {
        // Use VS Code's secure storage
        await this.context.secrets.store('voicecode.token', token);
    }

    async getToken(): Promise<string | undefined> {
        return await this.context.secrets.get('voicecode.token');
    }

    async clearToken(): Promise<void> {
        await this.context.secrets.delete('voicecode.token');
    }

    async getBackendUrl(): Promise<string | undefined> {
        return vscode.workspace.getConfiguration('voicecode').get('backendUrl');
    }
}
```

## Extension Auth Usage

```typescript
class ApiClient {
    private tokenManager: TokenManager;

    async request(path: string, options: RequestInit = {}): Promise<Response> {
        const token = await this.tokenManager.getToken();
        const backendUrl = await this.tokenManager.getBackendUrl();

        if (!token || !backendUrl) {
            throw new Error('Not configured');
        }

        const response = await fetch(`${backendUrl}${path}`, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`,
            },
        });

        if (response.status === 401) {
            // Token invalid - prompt user to re-authenticate
            await this.tokenManager.clearToken();
            vscode.window.showErrorMessage(
                'Session expired. Please sign in again.',
                'Sign In'
            ).then(action => {
                if (action === 'Sign In') {
                    vscode.commands.executeCommand('voicecode.setup');
                }
            });
            throw new Error('Token expired');
        }

        return response;
    }

    connectWebSocket(): WebSocket {
        const token = await this.tokenManager.getToken();
        const backendUrl = await this.tokenManager.getBackendUrl();

        // Token passed as query parameter for WebSocket
        const wsUrl = backendUrl.replace('https://', 'wss://').replace('http://', 'ws://');
        return new WebSocket(`${wsUrl}/ws/transcribe?token=${encodeURIComponent(token)}`);
    }
}
```

## Backend Settings UI

The backend web UI provides token management:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Settings → Extension Tokens                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Your Extension Tokens                                                       │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Token: vct_7kX...dS (created 2 days ago)          [Revoke]          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  [+ Create New Token]                                                        │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  How to use:                                                                 │
│  1. Click "Create New Token"                                                │
│  2. Copy the token (shown only once)                                        │
│  3. Paste into VS Code extension when prompted                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Database Schema

```sql
-- Users table
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    provider TEXT,          -- 'google', 'password', 'local'
    provider_id TEXT,       -- ID from OAuth provider
    password_hash TEXT,     -- For password auth
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Extension tokens
CREATE TABLE extension_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    token_hash TEXT UNIQUE,  -- SHA-256 hash (never store plaintext)
    name TEXT,               -- Optional friendly name
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP
);

-- Sessions (for web UI)
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Consequences

### Positive
- **Flexible**: Backend owner chooses auth method
- **Simple extension**: No OAuth complexity in extension
- **Revocable**: Tokens can be revoked anytime
- **Secure**: Tokens stored encrypted, hashed in DB
- **Self-hosted friendly**: Works without external OAuth providers

### Negative
- **Copy/paste flow**: User must copy token from browser
- **Token management**: Users responsible for token security
- **No automatic refresh**: Tokens are long-lived (must manually revoke)

### Tradeoffs
- Long-lived tokens (simpler) vs short-lived + refresh (more secure)
- Backend-managed auth (flexible) vs extension OAuth (seamless)
- Token copy/paste (reliable) vs redirect flow (fragile in VS Code)

## Related ADRs
- ADR-010: Security Model (token security)
- ADR-011: User Personalization (per-user settings)
- ADR-017: First-Run Setup (token onboarding flow)
