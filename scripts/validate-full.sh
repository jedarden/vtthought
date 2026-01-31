#!/bin/bash
# VTThought Full System Validation
# Run this to confirm all components work together
#
# Usage: ./scripts/validate-full.sh
#
# Exit codes:
#   0 - All validations passed
#   1 - Validation failed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_PID=""
BACKEND_PORT=8765  # Use non-standard port to avoid conflicts

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT

log_section() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

log_pass() {
    echo -e "${GREEN}✓ $1${NC}"
}

log_fail() {
    echo -e "${RED}✗ $1${NC}"
}

log_info() {
    echo -e "${YELLOW}→ $1${NC}"
}

# Track results
RESULTS=()
record_result() {
    RESULTS+=("$1:$2")
}

#######################################
# PHASE 1: Static Analysis
#######################################
log_section "PHASE 1: Static Analysis"

# Backend lint
log_info "Linting backend (ruff)..."
cd "$PROJECT_ROOT/backend"
if ruff check app/ --quiet 2>/dev/null; then
    log_pass "Backend lint passed"
    record_result "backend-lint" "pass"
else
    log_fail "Backend lint failed"
    record_result "backend-lint" "fail"
fi

# Backend type check
log_info "Type checking backend (mypy)..."
if mypy app/ --ignore-missing-imports --no-error-summary 2>/dev/null; then
    log_pass "Backend type check passed"
    record_result "backend-typecheck" "pass"
else
    log_fail "Backend type check failed (non-blocking)"
    record_result "backend-typecheck" "warn"
fi

# Extension compile
log_info "Compiling extension (tsc)..."
cd "$PROJECT_ROOT/extension"
if npm run compile --silent 2>/dev/null; then
    log_pass "Extension compile passed"
    record_result "extension-compile" "pass"
else
    log_fail "Extension compile failed"
    record_result "extension-compile" "fail"
fi

# Extension lint
log_info "Linting extension (eslint)..."
if npm run lint --silent 2>/dev/null; then
    log_pass "Extension lint passed"
    record_result "extension-lint" "pass"
else
    log_fail "Extension lint failed (non-blocking)"
    record_result "extension-lint" "warn"
fi

#######################################
# PHASE 2: Unit Tests
#######################################
log_section "PHASE 2: Unit Tests"

cd "$PROJECT_ROOT/backend"
source venv/bin/activate 2>/dev/null || true

log_info "Running backend unit tests..."
if python -m pytest -x -q --tb=no 2>/dev/null; then
    log_pass "Backend unit tests passed"
    record_result "backend-unit-tests" "pass"
else
    log_fail "Backend unit tests failed"
    record_result "backend-unit-tests" "fail"
fi

#######################################
# PHASE 3: Backend Integration
#######################################
log_section "PHASE 3: Backend Integration Tests"

cd "$PROJECT_ROOT/backend"

# Start backend in background
log_info "Starting backend on port $BACKEND_PORT..."
SINGLE_USER_MODE=true \
HOST=127.0.0.1 \
PORT=$BACKEND_PORT \
STT_DEVICE=cpu \
STT_COMPUTE_TYPE=int8 \
uvicorn app.main:app --host 127.0.0.1 --port $BACKEND_PORT &>/dev/null &
BACKEND_PID=$!

# Wait for backend to be ready
log_info "Waiting for backend to start..."
for i in {1..30}; do
    if curl -s "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
        log_pass "Backend started successfully"
        break
    fi
    if [ $i -eq 30 ]; then
        log_fail "Backend failed to start within 30 seconds"
        record_result "backend-start" "fail"
        exit 1
    fi
    sleep 1
done
record_result "backend-start" "pass"

# Test health endpoint
log_info "Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s "http://127.0.0.1:$BACKEND_PORT/api/health")
if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
    log_pass "Health endpoint: $HEALTH_RESPONSE"
    record_result "health-endpoint" "pass"
else
    log_fail "Health endpoint failed: $HEALTH_RESPONSE"
    record_result "health-endpoint" "fail"
fi

# Test version endpoint
log_info "Testing version endpoint..."
VERSION_RESPONSE=$(curl -s "http://127.0.0.1:$BACKEND_PORT/api/version")
if echo "$VERSION_RESPONSE" | grep -q "backend_version"; then
    log_pass "Version endpoint working"
    record_result "version-endpoint" "pass"
else
    log_fail "Version endpoint failed"
    record_result "version-endpoint" "fail"
fi

# Test WebSocket connectivity
log_info "Testing WebSocket connectivity..."
WS_TEST=$(timeout 5 python3 -c "
import asyncio
import websockets
import json

async def test_ws():
    try:
        async with websockets.connect('ws://127.0.0.1:$BACKEND_PORT/api/ws/audio') as ws:
            # Wait for welcome
            msg = await asyncio.wait_for(ws.recv(), timeout=2)
            # Send ping
            await ws.send(json.dumps({'type': 'ping'}))
            pong = await asyncio.wait_for(ws.recv(), timeout=2)
            if 'pong' in pong.lower():
                print('OK')
            else:
                print('FAIL: no pong')
    except Exception as e:
        print(f'FAIL: {e}')

asyncio.run(test_ws())
" 2>&1)

if echo "$WS_TEST" | grep -q "OK"; then
    log_pass "WebSocket connectivity working"
    record_result "websocket" "pass"
else
    log_fail "WebSocket test failed: $WS_TEST"
    record_result "websocket" "fail"
fi

# Test auth mode endpoint
log_info "Testing auth mode endpoint..."
AUTH_RESPONSE=$(curl -s "http://127.0.0.1:$BACKEND_PORT/api/auth/mode")
if echo "$AUTH_RESPONSE" | grep -q "mode"; then
    log_pass "Auth mode endpoint working"
    record_result "auth-mode" "pass"
else
    log_fail "Auth mode endpoint failed"
    record_result "auth-mode" "fail"
fi

# Stop backend
log_info "Stopping backend..."
kill "$BACKEND_PID" 2>/dev/null || true
wait "$BACKEND_PID" 2>/dev/null || true
BACKEND_PID=""
log_pass "Backend stopped"

#######################################
# PHASE 4: Docker Build
#######################################
log_section "PHASE 4: Docker Build Validation"

cd "$PROJECT_ROOT/backend"

# Check if Docker is available
if command -v docker &>/dev/null; then
    log_info "Building CPU Docker image..."
    if docker build -t vtthought:test-cpu -f Dockerfile.cpu . --quiet 2>/dev/null; then
        log_pass "Docker CPU image built successfully"
        record_result "docker-cpu" "pass"

        # Clean up test image
        docker rmi vtthought:test-cpu 2>/dev/null || true
    else
        log_fail "Docker CPU build failed"
        record_result "docker-cpu" "fail"
    fi
else
    log_info "Docker not available, skipping Docker build"
    record_result "docker-cpu" "skip"
fi

#######################################
# PHASE 5: Extension Package
#######################################
log_section "PHASE 5: Extension Packaging"

cd "$PROJECT_ROOT/extension"

log_info "Packaging extension..."
if npx @vscode/vsce package --allow-missing-repository --out /tmp/vtthought-test.vsix 2>/dev/null; then
    VSIX_SIZE=$(ls -lh /tmp/vtthought-test.vsix | awk '{print $5}')
    log_pass "Extension packaged successfully ($VSIX_SIZE)"
    record_result "extension-package" "pass"
    rm -f /tmp/vtthought-test.vsix
else
    log_fail "Extension packaging failed"
    record_result "extension-package" "fail"
fi

#######################################
# SUMMARY
#######################################
log_section "VALIDATION SUMMARY"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
SKIP_COUNT=0

for result in "${RESULTS[@]}"; do
    NAME="${result%%:*}"
    STATUS="${result##*:}"
    case $STATUS in
        pass) ((PASS_COUNT++)); echo -e "${GREEN}✓${NC} $NAME" ;;
        fail) ((FAIL_COUNT++)); echo -e "${RED}✗${NC} $NAME" ;;
        warn) ((WARN_COUNT++)); echo -e "${YELLOW}⚠${NC} $NAME" ;;
        skip) ((SKIP_COUNT++)); echo -e "${BLUE}○${NC} $NAME (skipped)" ;;
    esac
done

echo ""
echo -e "Results: ${GREEN}$PASS_COUNT passed${NC}, ${RED}$FAIL_COUNT failed${NC}, ${YELLOW}$WARN_COUNT warnings${NC}, ${BLUE}$SKIP_COUNT skipped${NC}"

if [ $FAIL_COUNT -gt 0 ]; then
    echo -e "\n${RED}VALIDATION FAILED${NC}"
    exit 1
else
    echo -e "\n${GREEN}VALIDATION PASSED${NC}"
    exit 0
fi
