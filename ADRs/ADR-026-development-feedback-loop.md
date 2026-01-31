# ADR-026: Development Feedback Loop

**Status:** Proposed
**Date:** 2026-01-31
**Decision Makers:** TBD

---

## Context

VTThought is a complex system with multiple components (VS Code extension, FastAPI backend, STT service, LLM integration) that must work together seamlessly. During development, changes to one component can break others. We need a systematic approach to verify all functions work as expected before merging changes.

## Decision Drivers

- **Confidence**: Know that changes don't break existing functionality
- **Speed**: Fast feedback on code changes
- **Coverage**: Test all layers (unit, integration, end-to-end)
- **Automation**: Minimize manual testing burden
- **Isolation**: Test components independently and together

## Decision

**Implement a multi-layer feedback loop with automated validation at each stage.**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DEVELOPMENT FEEDBACK LOOP                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 1: PRE-COMMIT (Local, <30s)                                  │    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │    │
│  │  │   Linting    │  │  Type Check  │  │  Unit Tests  │              │    │
│  │  │  ruff/eslint │  │  mypy/tsc    │  │  pytest -m   │              │    │
│  │  └──────────────┘  └──────────────┘  │  "not slow"  │              │    │
│  │                                       └──────────────┘              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                       │                                      │
│                                       ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 2: PRE-PUSH (Local, <2min)                                   │    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │    │
│  │  │  Full Unit   │  │  Integration │  │   Build      │              │    │
│  │  │  Tests       │  │  Tests (mock)│  │   Verify     │              │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                       │                                      │
│                                       ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 3: CI/CD (GitHub Actions, <10min)                            │    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │    │
│  │  │  Matrix Test │  │  Docker      │  │  Security    │              │    │
│  │  │  (Py + Node) │  │  Build Test  │  │  Scan        │              │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                       │                                      │
│                                       ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 4: STAGING (On-demand, <30min)                               │    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │    │
│  │  │  E2E Tests   │  │  Real Audio  │  │  Performance │              │    │
│  │  │  (Playwright)│  │  STT Test    │  │  Benchmarks  │              │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Layer 1: Pre-Commit Hooks

Fast checks that run before every commit.

### Configuration (`.pre-commit-config.yaml`)

```yaml
repos:
  # Python
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.1.9
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.8.0
    hooks:
      - id: mypy
        additional_dependencies: [types-all]
        args: [--ignore-missing-imports]

  # TypeScript
  - repo: local
    hooks:
      - id: eslint
        name: eslint
        entry: npm run lint --prefix extension
        language: system
        files: \.tsx?$
        pass_filenames: false

      - id: tsc
        name: tsc
        entry: npm run compile --prefix extension
        language: system
        files: \.tsx?$
        pass_filenames: false

  # General
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-json
      - id: check-merge-conflict
```

### Setup

```bash
pip install pre-commit
pre-commit install
pre-commit install --hook-type pre-push
```

## Layer 2: Pre-Push Validation

More thorough tests before pushing to remote.

### Backend Validation Script (`scripts/validate-backend.sh`)

```bash
#!/bin/bash
set -e

echo "=== Backend Validation ==="
cd backend

# Activate venv
source venv/bin/activate

# Lint
echo "Running ruff..."
ruff check app/

# Type check
echo "Running mypy..."
mypy app/ --ignore-missing-imports

# Unit tests (fast)
echo "Running unit tests..."
pytest -m "not slow and not integration" -v --tb=short

# Integration tests (mocked)
echo "Running integration tests..."
pytest test_integration.py -v --tb=short

echo "✓ Backend validation passed"
```

### Extension Validation Script (`scripts/validate-extension.sh`)

```bash
#!/bin/bash
set -e

echo "=== Extension Validation ==="
cd extension

# Lint
echo "Running eslint..."
npm run lint

# Type check
echo "Running tsc..."
npx tsc --noEmit

# Build
echo "Building extension..."
npm run compile

# Package (validates manifest)
echo "Packaging extension..."
npx @vscode/vsce package --allow-missing-repository

echo "✓ Extension validation passed"
```

### Combined Validation (`scripts/validate-all.sh`)

```bash
#!/bin/bash
set -e

echo "========================================"
echo "  VTThought Full Validation"
echo "========================================"

# Run in parallel where possible
./scripts/validate-backend.sh &
BACKEND_PID=$!

./scripts/validate-extension.sh &
EXTENSION_PID=$!

# Wait for both
wait $BACKEND_PID
BACKEND_EXIT=$?

wait $EXTENSION_PID
EXTENSION_EXIT=$?

if [ $BACKEND_EXIT -ne 0 ] || [ $EXTENSION_EXIT -ne 0 ]; then
    echo "❌ Validation failed"
    exit 1
fi

echo "========================================"
echo "  ✓ All validations passed"
echo "========================================"
```

## Layer 3: CI/CD Pipeline

Comprehensive testing in GitHub Actions.

### Test Matrix (`.github/workflows/test.yml`)

```yaml
name: Test

on: [push, pull_request]

jobs:
  backend-test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ['3.11', '3.12']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - name: Install dependencies
        run: |
          cd backend
          pip install -r requirements.txt
          pip install pytest pytest-asyncio pytest-cov httpx
      - name: Run tests with coverage
        run: |
          cd backend
          pytest --cov=app --cov-report=xml -v
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  extension-test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: ['18', '20']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - name: Install and test
        run: |
          cd extension
          npm ci
          npm run compile
          npm test

  docker-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build images
        run: |
          docker build -t vtthought:test-gpu -f backend/Dockerfile backend/
          docker build -t vtthought:test-cpu -f backend/Dockerfile.cpu backend/

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          severity: 'CRITICAL,HIGH'
```

## Layer 4: Staging Environment Tests

End-to-end tests with real services.

### E2E Test Suite (`tests/e2e/test_full_pipeline.py`)

```python
"""
End-to-end tests for the complete VTThought pipeline.
Requires running backend and extension.
"""
import pytest
import asyncio
import websockets
import httpx
import numpy as np

BACKEND_URL = "http://localhost:8000"
WS_URL = "ws://localhost:8000/api/ws/audio"


@pytest.fixture
async def backend_client():
    """HTTP client for backend API."""
    async with httpx.AsyncClient(base_url=BACKEND_URL) as client:
        yield client


@pytest.fixture
async def ws_connection():
    """WebSocket connection to backend."""
    async with websockets.connect(WS_URL) as ws:
        yield ws


class TestHealthCheck:
    """Verify backend is running and healthy."""

    @pytest.mark.asyncio
    async def test_health_endpoint(self, backend_client):
        response = await backend_client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"

    @pytest.mark.asyncio
    async def test_version_endpoint(self, backend_client):
        response = await backend_client.get("/api/version")
        assert response.status_code == 200
        data = response.json()
        assert "backend_version" in data
        assert "features" in data


class TestWebSocketConnection:
    """Verify WebSocket functionality."""

    @pytest.mark.asyncio
    async def test_connect_and_ping(self, ws_connection):
        # Should receive welcome message
        msg = await ws_connection.recv()
        assert "connected" in msg.lower() or "welcome" in msg.lower()

        # Send ping, expect pong
        await ws_connection.send('{"type": "ping"}')
        pong = await ws_connection.recv()
        assert "pong" in pong.lower()


class TestAudioPipeline:
    """Test complete audio transcription pipeline."""

    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_audio_transcription(self, ws_connection):
        """Send audio and receive transcription."""
        # Generate test audio (1 second of silence)
        sample_rate = 16000
        duration = 1.0
        audio = np.zeros(int(sample_rate * duration), dtype=np.float32)

        # Start recording
        await ws_connection.send('{"type": "start"}')

        # Send audio frames
        chunk_size = 4096
        for i in range(0, len(audio), chunk_size):
            chunk = audio[i:i+chunk_size]
            await ws_connection.send(chunk.tobytes())
            await asyncio.sleep(0.01)

        # Stop recording
        await ws_connection.send('{"type": "stop"}')

        # Wait for transcription result
        result = await asyncio.wait_for(ws_connection.recv(), timeout=30)
        assert result is not None


class TestVoiceCommands:
    """Test voice command parsing."""

    @pytest.mark.asyncio
    async def test_command_parsing(self, backend_client):
        """Verify command parser endpoint."""
        response = await backend_client.post(
            "/api/parse-commands",
            json={"text": "hello world enter"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "commands" in data
        assert any(cmd["action"] == "type" for cmd in data["commands"])


class TestUserPersonalization:
    """Test user vocabulary and preferences."""

    @pytest.mark.asyncio
    async def test_vocabulary_crud(self, backend_client):
        """Test vocabulary add/list/delete."""
        # Add term
        response = await backend_client.post(
            "/api/user/vocabulary",
            json={"word": "pytest", "category": "technical"}
        )
        assert response.status_code in [200, 201]

        # List terms
        response = await backend_client.get("/api/user/vocabulary")
        assert response.status_code == 200
        vocab = response.json()
        assert any(v["word"] == "pytest" for v in vocab)

        # Delete term
        response = await backend_client.delete(
            "/api/user/vocabulary/pytest"
        )
        assert response.status_code in [200, 204]
```

### Performance Benchmarks (`tests/benchmarks/test_performance.py`)

```python
"""
Performance benchmarks for VTThought components.
"""
import pytest
import time
import statistics


class TestSTTPerformance:
    """Benchmark STT transcription speed."""

    @pytest.mark.benchmark
    def test_transcription_latency(self, stt_service, sample_audio):
        """Measure transcription latency for 5-second audio."""
        latencies = []

        for _ in range(10):
            start = time.perf_counter()
            result = stt_service.transcribe(sample_audio)
            latency = time.perf_counter() - start
            latencies.append(latency)

        avg_latency = statistics.mean(latencies)
        p95_latency = statistics.quantiles(latencies, n=20)[18]

        print(f"Average latency: {avg_latency:.3f}s")
        print(f"P95 latency: {p95_latency:.3f}s")

        # Assert acceptable performance
        assert avg_latency < 2.0, f"Average latency {avg_latency}s exceeds 2s threshold"
        assert p95_latency < 3.0, f"P95 latency {p95_latency}s exceeds 3s threshold"


class TestWebSocketThroughput:
    """Benchmark WebSocket message throughput."""

    @pytest.mark.benchmark
    async def test_message_throughput(self, ws_connection):
        """Measure messages per second."""
        num_messages = 1000
        start = time.perf_counter()

        for i in range(num_messages):
            await ws_connection.send(f'{{"type": "ping", "seq": {i}}}')
            await ws_connection.recv()

        elapsed = time.perf_counter() - start
        throughput = num_messages / elapsed

        print(f"Throughput: {throughput:.1f} messages/second")
        assert throughput > 100, f"Throughput {throughput} below 100 msg/s threshold"
```

## Feedback Loop Integration

### Development Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│   1. Make Change                                                             │
│         │                                                                    │
│         ▼                                                                    │
│   2. git add . && git commit                                                 │
│         │                                                                    │
│         ├──────────────────────────────────────────────────────────┐        │
│         │  Pre-commit hooks run automatically                       │        │
│         │  ├─ Lint (ruff, eslint)                                  │        │
│         │  ├─ Type check (mypy, tsc)                               │        │
│         │  └─ Fast unit tests                                      │        │
│         │                                                           │        │
│         │  ❌ FAIL → Fix issues, try again                         │        │
│         │  ✓ PASS → Continue                                       │        │
│         └──────────────────────────────────────────────────────────┘        │
│         │                                                                    │
│         ▼                                                                    │
│   3. git push origin main                                                    │
│         │                                                                    │
│         ├──────────────────────────────────────────────────────────┐        │
│         │  Pre-push hooks run                                       │        │
│         │  ├─ Full unit tests                                      │        │
│         │  ├─ Integration tests (mocked)                           │        │
│         │  └─ Build verification                                   │        │
│         │                                                           │        │
│         │  ❌ FAIL → Fix locally, try again                        │        │
│         │  ✓ PASS → Push succeeds                                  │        │
│         └──────────────────────────────────────────────────────────┘        │
│         │                                                                    │
│         ▼                                                                    │
│   4. GitHub Actions triggered                                                │
│         │                                                                    │
│         ├──────────────────────────────────────────────────────────┐        │
│         │  CI Pipeline runs                                         │        │
│         │  ├─ Matrix tests (Python 3.11/3.12, Node 18/20)          │        │
│         │  ├─ Docker build verification                            │        │
│         │  ├─ Security scanning                                    │        │
│         │  └─ Coverage reporting                                   │        │
│         │                                                           │        │
│         │  ❌ FAIL → Notification, fix in next commit              │        │
│         │  ✓ PASS → Ready for staging                              │        │
│         └──────────────────────────────────────────────────────────┘        │
│         │                                                                    │
│         ▼                                                                    │
│   5. gh run watch (verify CI passed)                                         │
│         │                                                                    │
│         ▼                                                                    │
│   6. (Optional) Deploy to staging, run E2E tests                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Makefile for Easy Access

```makefile
.PHONY: test lint validate e2e

# Quick validation (pre-commit level)
lint:
	cd backend && ruff check app/
	cd extension && npm run lint

# Full local validation
validate:
	./scripts/validate-all.sh

# Run all tests
test:
	cd backend && pytest -v
	cd extension && npm test

# Run E2E tests (requires running backend)
e2e:
	pytest tests/e2e/ -v --tb=short

# Watch mode for development
watch-backend:
	cd backend && uvicorn app.main:app --reload

watch-extension:
	cd extension && npm run watch

# Check CI status
ci-status:
	gh run list --repo jedarden/vtthought --limit 5
	gh run view --repo jedarden/vtthought
```

## Test Coverage Requirements

| Component | Minimum Coverage | Target Coverage |
|-----------|-----------------|-----------------|
| Backend Core | 70% | 85% |
| Backend Services | 60% | 80% |
| Extension | 50% | 70% |
| E2E Critical Paths | 100% | 100% |

### Coverage Enforcement

```yaml
# codecov.yml
coverage:
  status:
    project:
      default:
        target: 70%
        threshold: 5%
    patch:
      default:
        target: 80%
```

## Monitoring Development Health

### Metrics to Track

1. **Test Pass Rate**: % of CI runs that pass
2. **Time to Fix**: Average time from failure to fix
3. **Coverage Trend**: Is coverage increasing over time?
4. **Flaky Tests**: Tests that sometimes pass/fail randomly
5. **Build Time**: Is CI getting slower?

### Dashboard (GitHub Actions Summary)

```yaml
# .github/workflows/metrics.yml
name: Metrics

on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly

jobs:
  collect-metrics:
    runs-on: ubuntu-latest
    steps:
      - name: Collect CI metrics
        run: |
          gh run list --repo jedarden/vtthought --limit 100 --json conclusion,createdAt \
            | jq 'group_by(.conclusion) | map({conclusion: .[0].conclusion, count: length})'
```

## Consequences

### Positive

- **High confidence**: Changes are validated at multiple levels
- **Fast feedback**: Issues caught early, before CI
- **Comprehensive**: Unit, integration, E2E, and performance tests
- **Automated**: Minimal manual testing required
- **Documented**: Clear process for developers to follow

### Negative

- **Setup overhead**: Initial configuration of hooks and CI
- **Slower commits**: Pre-commit hooks add time
- **Maintenance**: Tests need updating as code changes
- **Resource usage**: CI/CD consumes GitHub Actions minutes

### Tradeoffs

- Speed vs thoroughness (more tests = slower feedback)
- Local vs CI (some tests only feasible in CI)
- Coverage vs velocity (100% coverage slows development)

## Related ADRs

- ADR-015: Error Handling (error scenarios to test)
- ADR-019: Observability (metrics for monitoring)
- ADR-025: Container Registry & Releases (CI/CD integration)
