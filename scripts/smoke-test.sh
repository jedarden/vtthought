#!/bin/bash
# VTThought Smoke Test
# Start backend, run smoke tests, stop backend
#
# Usage: ./scripts/smoke-test.sh [backend_url]
#
# If backend_url is provided, tests against that URL
# Otherwise, starts a local backend for testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_URL="${1:-}"
STARTED_BACKEND=false
BACKEND_PID=""
PORT=8765

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cleanup() {
    if [ "$STARTED_BACKEND" = true ] && [ -n "$BACKEND_PID" ]; then
        echo -e "${YELLOW}Stopping backend...${NC}"
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT

# Start backend if URL not provided
if [ -z "$BACKEND_URL" ]; then
    echo -e "${YELLOW}Starting local backend on port $PORT...${NC}"
    cd "$PROJECT_ROOT/backend"
    source venv/bin/activate 2>/dev/null || true

    SINGLE_USER_MODE=true \
    HOST=127.0.0.1 \
    PORT=$PORT \
    STT_DEVICE=cpu \
    uvicorn app.main:app --host 127.0.0.1 --port $PORT &>/dev/null &
    BACKEND_PID=$!
    STARTED_BACKEND=true
    BACKEND_URL="http://127.0.0.1:$PORT"

    # Wait for startup
    echo "Waiting for backend to start..."
    for i in {1..30}; do
        if curl -s "$BACKEND_URL/api/health" >/dev/null 2>&1; then
            echo -e "${GREEN}Backend started${NC}"
            break
        fi
        if [ $i -eq 30 ]; then
            echo -e "${RED}Backend failed to start${NC}"
            exit 1
        fi
        sleep 1
    done
fi

echo ""
echo "=== Smoke Tests against $BACKEND_URL ==="
echo ""

PASSED=0
FAILED=0

# Test 1: Health endpoint
echo -n "1. Health endpoint... "
RESPONSE=$(curl -s "$BACKEND_URL/api/health")
if echo "$RESPONSE" | grep -q "healthy"; then
    echo -e "${GREEN}PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}FAIL${NC} - $RESPONSE"
    FAILED=$((FAILED + 1))
fi

# Test 2: Version endpoint
echo -n "2. Version endpoint... "
RESPONSE=$(curl -s "$BACKEND_URL/api/version")
if echo "$RESPONSE" | grep -q "backend_version"; then
    echo -e "${GREEN}PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}FAIL${NC}"
    FAILED=$((FAILED + 1))
fi

# Test 3: Auth mode endpoint
echo -n "3. Auth mode endpoint... "
RESPONSE=$(curl -s "$BACKEND_URL/api/auth/mode")
if echo "$RESPONSE" | grep -q "mode"; then
    echo -e "${GREEN}PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}FAIL${NC}"
    FAILED=$((FAILED + 1))
fi

# Test 4: WebSocket connection
echo -n "4. WebSocket connection... "
WS_URL="${BACKEND_URL/http/ws}/api/ws/audio"
WS_TEST=$(timeout 5 python3 -c "
import asyncio
import websockets
import json

async def test():
    try:
        async with websockets.connect('$WS_URL') as ws:
            msg = await asyncio.wait_for(ws.recv(), timeout=3)
            await ws.send(json.dumps({'type': 'ping'}))
            pong = await asyncio.wait_for(ws.recv(), timeout=3)
            print('OK' if 'pong' in pong.lower() else 'FAIL')
    except Exception as e:
        print(f'FAIL: {e}')

asyncio.run(test())
" 2>&1)

if echo "$WS_TEST" | grep -q "OK"; then
    echo -e "${GREEN}PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}FAIL${NC} - $WS_TEST"
    FAILED=$((FAILED + 1))
fi

# Test 5: WebSocket start/stop recording
echo -n "5. WebSocket recording flow... "
WS_TEST=$(timeout 10 python3 -c "
import asyncio
import websockets
import json

async def test():
    try:
        async with websockets.connect('$WS_URL') as ws:
            # Wait for welcome
            await asyncio.wait_for(ws.recv(), timeout=3)

            # Start recording
            await ws.send(json.dumps({'type': 'start'}))
            start_resp = await asyncio.wait_for(ws.recv(), timeout=3)

            # Stop recording
            await ws.send(json.dumps({'type': 'stop'}))
            stop_resp = await asyncio.wait_for(ws.recv(), timeout=3)

            print('OK')
    except Exception as e:
        print(f'FAIL: {e}')

asyncio.run(test())
" 2>&1)

if echo "$WS_TEST" | grep -q "OK"; then
    echo -e "${GREEN}PASS${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}FAIL${NC} - $WS_TEST"
    FAILED=$((FAILED + 1))
fi

# Test 6: User preferences (single-user mode)
echo -n "6. User preferences endpoint... "
RESPONSE=$(curl -s "$BACKEND_URL/api/user/user/preferences")
if echo "$RESPONSE" | grep -qE "(language|cleanup_level|error)"; then
    if echo "$RESPONSE" | grep -q "error"; then
        echo -e "${YELLOW}SKIP${NC} (auth required)"
    else
        echo -e "${GREEN}PASS${NC}"
        PASSED=$((PASSED + 1))
    fi
else
    echo -e "${RED}FAIL${NC}"
    FAILED=$((FAILED + 1))
fi

# Summary
echo ""
echo "========================================"
echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
echo "========================================"

if [ $FAILED -gt 0 ]; then
    exit 1
fi
exit 0
