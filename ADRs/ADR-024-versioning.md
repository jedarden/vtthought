# ADR-024: Versioning & Compatibility

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

The system has two independently deployed components:
1. **VS Code Extension** - installed by users, auto-updates via Marketplace
2. **Backend** - self-hosted by users, manually updated

These components communicate via WebSocket and REST APIs. Version mismatches can cause:
- Silent failures
- Missing features
- Breaking changes
- Confusing error messages

## Decision Drivers

- **User experience**: Clear errors when versions incompatible
- **Flexibility**: Backend and extension update independently
- **Stability**: Don't break users on updates
- **Simplicity**: Easy to understand versioning scheme

## Decision

**Semantic versioning** with explicit API version negotiation and compatibility matrix.

## Versioning Scheme

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VERSIONING SCHEME                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  COMPONENT VERSIONS (SemVer)                                                 │
│  ├─ Extension: 1.2.3                                                        │
│  └─ Backend: 1.4.0                                                          │
│                                                                              │
│  API VERSION (separate from component version)                               │
│  └─ v1, v2, v3...                                                           │
│  └─ Backend can support multiple API versions                               │
│  └─ Extension requests specific API version                                 │
│                                                                              │
│  PROTOCOL VERSION (WebSocket handshake)                                      │
│  └─ Protocol defines message format                                         │
│  └─ Negotiated on connection                                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## API Version Negotiation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VERSION NEGOTIATION FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Extension                              Backend                              │
│     │                                      │                                 │
│     │  GET /api/version                    │                                 │
│     │ ─────────────────────────────────▶   │                                 │
│     │                                      │                                 │
│     │  {                                   │                                 │
│     │    "backend_version": "1.4.0",       │                                 │
│     │    "api_versions": ["v1", "v2"],     │                                 │
│     │    "protocol_versions": ["1.0"],     │                                 │
│     │    "min_extension": "1.0.0"          │                                 │
│     │  }                                   │                                 │
│     │ ◀─────────────────────────────────   │                                 │
│     │                                      │                                 │
│     │  Check compatibility:                │                                 │
│     │  - Extension 1.2.3 >= min 1.0.0 ✓   │                                 │
│     │  - API v1 supported ✓               │                                 │
│     │                                      │                                 │
│     │  WebSocket /ws/transcribe?api=v1     │                                 │
│     │ ─────────────────────────────────▶   │                                 │
│     │                                      │                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Backend Version Endpoint

```python
from pydantic import BaseModel
from typing import List

class VersionInfo(BaseModel):
    backend_version: str          # "1.4.0"
    api_versions: List[str]       # ["v1", "v2"]
    protocol_versions: List[str]  # ["1.0", "1.1"]
    min_extension_version: str    # "1.0.0" - minimum compatible extension
    features: List[str]           # ["streaming", "style_learning", "voice_commands"]

# Current version configuration
CURRENT_VERSION = VersionInfo(
    backend_version="1.0.0",
    api_versions=["v1"],
    protocol_versions=["1.0"],
    min_extension_version="1.0.0",
    features=["streaming", "vocabulary", "voice_commands"]
)

@app.get("/api/version")
async def get_version():
    """Return backend version and compatibility information."""
    return CURRENT_VERSION.dict()
```

### Extension Compatibility Check

```typescript
interface BackendVersion {
    backend_version: string;
    api_versions: string[];
    protocol_versions: string[];
    min_extension_version: string;
    features: string[];
}

class VersionChecker {
    private extensionVersion: string;
    private requiredApiVersion = 'v1';
    private requiredProtocolVersion = '1.0';

    constructor(extensionVersion: string) {
        this.extensionVersion = extensionVersion;
    }

    async checkCompatibility(backendUrl: string): Promise<CompatibilityResult> {
        const response = await fetch(`${backendUrl}/api/version`);
        const version: BackendVersion = await response.json();

        const issues: string[] = [];

        // Check if extension meets minimum version
        if (this.compareSemver(this.extensionVersion, version.min_extension_version) < 0) {
            issues.push(
                `Extension version ${this.extensionVersion} is too old. ` +
                `Backend requires at least ${version.min_extension_version}.`
            );
        }

        // Check if backend supports required API version
        if (!version.api_versions.includes(this.requiredApiVersion)) {
            issues.push(
                `Backend does not support API ${this.requiredApiVersion}. ` +
                `Supported: ${version.api_versions.join(', ')}.`
            );
        }

        // Check protocol version
        if (!version.protocol_versions.includes(this.requiredProtocolVersion)) {
            issues.push(
                `Backend does not support protocol ${this.requiredProtocolVersion}. ` +
                `Supported: ${version.protocol_versions.join(', ')}.`
            );
        }

        return {
            compatible: issues.length === 0,
            issues,
            backendVersion: version.backend_version,
            extensionVersion: this.extensionVersion,
            features: version.features
        };
    }

    private compareSemver(a: string, b: string): number {
        const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
        const [bMajor, bMinor, bPatch] = b.split('.').map(Number);

        if (aMajor !== bMajor) return aMajor - bMajor;
        if (aMinor !== bMinor) return aMinor - bMinor;
        return aPatch - bPatch;
    }
}

interface CompatibilityResult {
    compatible: boolean;
    issues: string[];
    backendVersion: string;
    extensionVersion: string;
    features: string[];
}
```

### Compatibility Error Handling

```typescript
async function connectToBackend(): Promise<void> {
    const checker = new VersionChecker(EXTENSION_VERSION);
    const result = await checker.checkCompatibility(backendUrl);

    if (!result.compatible) {
        const message = result.issues.join('\n');

        const action = await vscode.window.showErrorMessage(
            `Voice Code: Incompatible versions\n\n${message}`,
            'Update Extension',
            'Check Backend',
            'Dismiss'
        );

        if (action === 'Update Extension') {
            vscode.commands.executeCommand(
                'workbench.extensions.action.checkForUpdates'
            );
        } else if (action === 'Check Backend') {
            vscode.env.openExternal(
                vscode.Uri.parse('https://docs.voicecode.dev/updating')
            );
        }

        throw new Error('Version incompatible');
    }

    // Store available features for feature detection
    await this.context.globalState.update('voicecode.features', result.features);
}
```

## WebSocket Protocol Versioning

```typescript
// WebSocket connection with protocol version
const ws = new WebSocket(
    `${wsUrl}/ws/transcribe?token=${token}&api=v1&protocol=1.0`
);

// Server validates and responds with confirmation
ws.onopen = () => {
    // Server sends version confirmation as first message
};

// First message from server
interface ProtocolHandshake {
    type: 'handshake';
    api_version: string;
    protocol_version: string;
    features: string[];
}
```

```python
@app.websocket("/ws/transcribe")
async def websocket_transcribe(
    websocket: WebSocket,
    token: str,
    api: str = "v1",
    protocol: str = "1.0"
):
    # Validate API version
    if api not in CURRENT_VERSION.api_versions:
        await websocket.close(
            code=4001,
            reason=f"Unsupported API version: {api}"
        )
        return

    # Validate protocol version
    if protocol not in CURRENT_VERSION.protocol_versions:
        await websocket.close(
            code=4002,
            reason=f"Unsupported protocol version: {protocol}"
        )
        return

    await websocket.accept()

    # Send handshake confirmation
    await websocket.send_json({
        "type": "handshake",
        "api_version": api,
        "protocol_version": protocol,
        "features": CURRENT_VERSION.features
    })

    # Continue with normal operation...
```

## Breaking Change Policy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    BREAKING CHANGE POLICY                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MAJOR VERSION (1.x.x → 2.x.x)                                              │
│  ├─ May contain breaking changes                                            │
│  ├─ New API version (v1 → v2)                                               │
│  ├─ Backend should support previous API for transition period               │
│  └─ Minimum 30 days notice before dropping old API                          │
│                                                                              │
│  MINOR VERSION (1.1.x → 1.2.x)                                              │
│  ├─ New features, backward compatible                                       │
│  ├─ May add optional fields to messages                                     │
│  └─ Extension should handle unknown fields gracefully                       │
│                                                                              │
│  PATCH VERSION (1.1.1 → 1.1.2)                                              │
│  ├─ Bug fixes only                                                          │
│  ├─ No API changes                                                          │
│  └─ Always safe to update                                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Feature Detection

Instead of version checking for features, use capability detection:

```typescript
class FeatureDetector {
    private features: Set<string>;

    constructor(features: string[]) {
        this.features = new Set(features);
    }

    hasFeature(feature: string): boolean {
        return this.features.has(feature);
    }

    // Use feature detection instead of version checks
    supportsStreaming(): boolean {
        return this.hasFeature('streaming');
    }

    supportsStyleLearning(): boolean {
        return this.hasFeature('style_learning');
    }

    supportsVoiceCommands(): boolean {
        return this.hasFeature('voice_commands');
    }

    supportsInterimResults(): boolean {
        return this.hasFeature('interim_results');
    }
}

// Usage
if (featureDetector.supportsStyleLearning()) {
    // Enable style learning UI
} else {
    // Hide or disable style learning features
}
```

## Compatibility Matrix

Document which versions work together:

```markdown
## Compatibility Matrix

| Extension | Backend | Status |
|-----------|---------|--------|
| 1.0.x     | 1.0.x   | ✅ Full compatibility |
| 1.0.x     | 1.1.x   | ✅ Full compatibility |
| 1.1.x     | 1.0.x   | ⚠️ Missing style_learning feature |
| 1.1.x     | 1.1.x   | ✅ Full compatibility |
| 2.0.x     | 1.x.x   | ❌ Requires backend 2.0+ |
| 1.x.x     | 2.0.x   | ⚠️ Works with API v1 (deprecated) |
```

## Deprecation Warnings

```python
# Backend sends deprecation warnings in responses
@app.middleware("http")
async def deprecation_middleware(request: Request, call_next):
    response = await call_next(request)

    api_version = request.query_params.get("api", "v1")

    if api_version == "v1" and "v2" in CURRENT_VERSION.api_versions:
        response.headers["X-API-Deprecated"] = "true"
        response.headers["X-API-Sunset"] = "2026-06-01"
        response.headers["X-API-Upgrade"] = "v2"

    return response
```

```typescript
// Extension handles deprecation warnings
ws.onmessage = (event) => {
    // Check for deprecation header in handshake
    if (message.type === 'handshake' && message.deprecated) {
        vscode.window.showWarningMessage(
            `Voice Code: API ${message.api_version} is deprecated. ` +
            `Please update your extension.`,
            'Update Now'
        ).then(action => {
            if (action === 'Update Now') {
                vscode.commands.executeCommand(
                    'workbench.extensions.action.checkForUpdates'
                );
            }
        });
    }
};
```

## Version Display

Show versions in UI for debugging:

```typescript
// Status bar tooltip includes version info
statusBarItem.tooltip =
    `Voice Code\n` +
    `Extension: ${EXTENSION_VERSION}\n` +
    `Backend: ${backendVersion}\n` +
    `API: ${apiVersion}`;

// Settings page shows compatibility info
class VersionInfoProvider implements vscode.TreeDataProvider<VersionItem> {
    getTreeItem(element: VersionItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<VersionItem[]> {
        const version = await this.getBackendVersion();
        return [
            new VersionItem('Extension', EXTENSION_VERSION),
            new VersionItem('Backend', version.backend_version),
            new VersionItem('API', version.api_versions.join(', ')),
            new VersionItem('Features', version.features.join(', '))
        ];
    }
}
```

## Migration Guide Template

When releasing breaking changes, provide migration guide:

```markdown
# Migrating from v1 to v2

## Breaking Changes

### API Changes
- `POST /api/transcribe` → `POST /api/v2/transcribe`
- Request body: `audio` field renamed to `audio_data`
- Response: `text` field renamed to `transcription`

### Protocol Changes
- WebSocket messages now include `sequence_id`
- `partial` type renamed to `interim`

## Migration Steps

1. Update backend to v2.0.0
2. Backend will support both v1 and v2 APIs
3. Update extension to v2.0.0
4. Extension will use v2 API
5. After 30 days, v1 API will be removed

## Rollback

If issues occur:
1. Downgrade extension to v1.x
2. Backend v2 still supports v1 API
```

## Consequences

### Positive
- **Clear errors**: Users understand version mismatches
- **Independent updates**: Extension and backend update separately
- **Feature detection**: Graceful degradation for missing features
- **Transition period**: Old APIs supported during migration

### Negative
- **Complexity**: Version negotiation adds code
- **Maintenance**: Must maintain multiple API versions temporarily
- **Documentation**: Must document compatibility matrix

### Tradeoffs
- Support multiple API versions (more work) vs break users (bad UX)
- Strict versioning (safe) vs permissive (convenient)
- Feature detection (flexible) vs version checks (simpler)

## Related ADRs
- ADR-004: Audio Streaming Protocol (protocol version)
- ADR-017: First-Run Setup (version check during setup)
- ADR-019: Observability (version in health endpoint)
