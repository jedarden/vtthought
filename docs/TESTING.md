# VTThought Testing Guide

This guide covers how to run tests for the VTThought backend and extension.

## Table of Contents

- [Quick Start](#quick-start)
- [Backend Tests](#backend-tests)
- [Extension Tests](#extension-tests)
- [CI/CD Testing](#cicd-testing)
- [Manual Testing](#manual-testing)
- [Writing Tests](#writing-tests)

---

## Quick Start

```bash
# Backend tests (from project root)
cd backend
source venv/bin/activate  # or create venv first
pip install pytest pytest-asyncio httpx websockets
pytest -v

# Extension tests (from project root)
cd extension
npm install
npm test
```

---

## Backend Tests

### Prerequisites

```bash
cd backend

# Create virtual environment (if not exists)
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install test dependencies
pip install pytest pytest-asyncio httpx websockets
```

### Running Tests

```bash
# Run all tests
pytest -v

# Run specific test file
pytest test_integration.py -v
pytest test_stt_real_audio.py -v

# Run with coverage
pip install pytest-cov
pytest --cov=app --cov-report=html -v

# Run tests matching a pattern
pytest -k "health" -v
pytest -k "websocket" -v
```

### Test Files

| File | Description | Requirements |
|------|-------------|--------------|
| `test_integration.py` | API endpoint and WebSocket tests | Backend running or mocked |
| `test_stt_real_audio.py` | Real audio transcription tests | Whisper model (~150MB download) |

### Integration Tests (`test_integration.py`)

Tests HTTP and WebSocket endpoints:

```bash
# Start backend first (in separate terminal)
cd backend
source venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000

# Run tests
pytest test_integration.py -v
```

**Test Cases:**
- `test_health_check` - HTTP health endpoint returns 200
- `test_websocket_connection` - WebSocket connects and responds to ping
- `test_audio_streaming` - WebSocket handles binary audio frames

### Real Audio Tests (`test_stt_real_audio.py`)

Tests actual STT transcription:

```bash
# These tests download Whisper model on first run (~150MB)
pytest test_stt_real_audio.py -v
```

**Test Cases:**
- `test_whisper_model_available` - Model loads correctly
- `test_stt_service_transcribe` - Transcribes generated audio
- `test_websocket_audio_streaming` - Full pipeline with audio

### Environment Variables for Tests

```bash
# Run in single-user mode (no auth required)
SINGLE_USER_MODE=true pytest -v

# Use specific host/port
HOST=127.0.0.1 PORT=8000 pytest -v

# Test with CPU-only STT
STT_DEVICE=cpu STT_COMPUTE_TYPE=int8 pytest test_stt_real_audio.py -v
```

---

## Extension Tests

### Prerequisites

```bash
cd extension

# Install dependencies
npm install

# Install test dependencies (already in devDependencies)
npm install --save-dev @types/mocha mocha
```

### Running Tests

```bash
# Compile TypeScript
npm run compile

# Run all tests
npm test

# Run specific test commands (defined in package.json)
npm run test:unit
npm run test:commands
```

### Test Files

| File | Description |
|------|-------------|
| `src/voiceCommands.test.ts` | Voice command parser tests |

### Voice Command Tests

The extension includes a built-in command testing utility:

```bash
# From VS Code Command Palette
> VTThought: Test Voice Commands
> VTThought: List All Commands
> VTThought: Analyze Command
```

**Test Cases:**
- Command parsing (38 commands)
- Homophone normalization
- Parameter extraction (go to line X)
- Custom command integration
- Disabled command filtering

### Manual Extension Testing

1. Open extension in VS Code:
   ```bash
   cd extension
   code .
   ```

2. Press `F5` to launch Extension Development Host

3. Test features:
   - Push-to-talk (`Ctrl+Alt+V`)
   - Voice commands
   - Status bar
   - Settings

---

## CI/CD Testing

Tests run automatically in GitHub Actions:

### On Pull Request

```yaml
# .github/workflows/test.yml (example)
name: Test
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: |
          cd backend
          pip install -r requirements.txt
          pip install pytest pytest-asyncio httpx websockets
          pytest -v
        env:
          SINGLE_USER_MODE: 'true'

  extension:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: |
          cd extension
          npm ci
          npm run compile
          npm test
```

### On Release

The release workflow (`release.yml`) runs integration tests before publishing:

1. Builds Docker images
2. Runs `test_integration.py` against container
3. Creates GitHub release only if tests pass

---

## Manual Testing

### Backend Manual Tests

```bash
# Start backend
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Test health endpoint
curl http://127.0.0.1:8000/api/health

# Test version endpoint
curl http://127.0.0.1:8000/api/version

# Test WebSocket with wscat
npm install -g wscat
wscat -c ws://127.0.0.1:8000/api/ws/audio

# In wscat, send:
{"type": "ping"}
{"type": "start"}
```

### Extension Manual Tests

| Feature | Test Steps | Expected Result |
|---------|------------|-----------------|
| Activation | Open VS Code, check status bar | VTThought icon appears |
| Push-to-talk | Press `Ctrl+Alt+V`, speak | Recording indicator shows |
| Voice commands | Say "enter" at end of phrase | Enter key pressed |
| Vocabulary | Command Palette → Manage Vocabulary | Quick pick appears |
| Settings | Command Palette → Preferences: Open Settings | VTThought settings visible |

### Docker Testing

```bash
# Build and test locally
cd backend
docker build -t vtthought-test .

# Run container
docker run -d --name vtt-test \
  -p 8000:8000 \
  -e SINGLE_USER_MODE=true \
  vtthought-test

# Run tests against container
BACKEND_URL=http://localhost:8000 pytest test_integration.py -v

# Cleanup
docker stop vtt-test && docker rm vtt-test
```

---

## Writing Tests

### Backend Test Template

```python
# test_example.py
import pytest
from app.services.example import ExampleService

@pytest.fixture
def service():
    """Create service instance for tests."""
    return ExampleService()

@pytest.mark.asyncio
async def test_example_feature(service):
    """Test description here."""
    result = await service.do_something()
    assert result == expected_value
```

### Extension Test Template

```typescript
// example.test.ts
import * as assert from 'assert';
import { ExampleClass } from './example';

describe('ExampleClass', () => {
    let instance: ExampleClass;

    beforeEach(() => {
        instance = new ExampleClass();
    });

    it('should do something', () => {
        const result = instance.doSomething();
        assert.strictEqual(result, expected);
    });
});
```

### Test Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Use fixtures/beforeEach to reset state
3. **Naming**: Use descriptive test names (`test_should_return_error_when_invalid_input`)
4. **Coverage**: Aim for 80%+ coverage on critical paths
5. **Speed**: Keep unit tests fast (<100ms each)
6. **Mocking**: Mock external services (Ollama, Whisper) for unit tests

---

## Troubleshooting

### "Backend not running" errors

```bash
# Start backend before running integration tests
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### "Module not found" errors

```bash
# Ensure you're in the virtual environment
source backend/venv/bin/activate

# Reinstall dependencies
pip install -r requirements.txt
```

### "Whisper model not found" errors

```bash
# First run downloads model (~150MB)
# Set custom cache directory if needed
export XDG_CACHE_HOME=~/.cache
pytest test_stt_real_audio.py -v
```

### Extension tests not running

```bash
# Ensure TypeScript is compiled
cd extension
npm run compile

# Check for compilation errors
npx tsc --noEmit
```
