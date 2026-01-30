#!/usr/bin/env python3
"""
VTThought Backend Integration Tests

Tests the WebSocket connection and basic message flow.
"""
import asyncio
import json
import sys
from pathlib import Path

import pytest
import websockets
from websockets.exceptions import ConnectionClosed

# Add app to path
sys.path.insert(0, str(Path(__file__).parent))

from app.config import get_settings

settings = get_settings()


@pytest.mark.asyncio
async def test_health_check():
    """Test HTTP health check endpoint."""
    import httpx

    print("\n=== Testing Health Check Endpoint ===")
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(f"http://{settings.host}:{settings.port}/api/health")
            print(f"Status: {response.status_code}")
            print(f"Response: {response.json()}")
            return response.status_code == 200
        except Exception as e:
            print(f"Health check failed: {e}")
            return False


@pytest.mark.asyncio
async def test_websocket_connection():
    """Test basic WebSocket connection."""
    print("\n=== Testing WebSocket Connection ===")
    uri = f"ws://{settings.host}:{settings.port}/api/ws/audio"

    try:
        async with websockets.connect(uri) as ws:
            # Receive welcome message
            msg = await ws.recv()
            data = json.loads(msg)
            print(f"Connected: {data}")

            # Send ping
            await ws.send('{"type": "ping"}')
            pong = await ws.recv()
            print(f"Pong: {pong}")

            # Send start recording
            await ws.send('{"type": "start"}')
            response = await ws.recv()
            print(f"Start response: {response}")

            # Send stop recording
            await ws.send('{"type": "stop"}')
            # Drain all messages
            messages = []
            while True:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    messages.append(msg)
                except asyncio.TimeoutError:
                    break

            print(f"Received {len(messages)} messages after stop")
            for i, msg in enumerate(messages[:3]):  # Show first 3
                data = json.loads(msg)
                # Show truncated message
                msg_str = json.dumps(data)[:200]
                print(f"  Message {i+1}: {msg_str}...")

            return True

    except ConnectionClosed as e:
        print(f"WebSocket closed unexpectedly: {e}")
        return False
    except Exception as e:
        print(f"WebSocket test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


@pytest.mark.asyncio
async def test_audio_stream():
    """Test WebSocket with mock audio data."""
    print("\n=== Testing Audio Stream with Mock Data ===")
    uri = f"ws://{settings.host}:{settings.port}/api/ws/audio"

    # Generate mock PCM16 audio data (1 second of silence at 16kHz)
    sample_rate = 16000
    duration = 0.5  # seconds
    num_samples = int(sample_rate * duration)

    # Create silence (zeros) in PCM16 format
    audio_data = bytes(num_samples * 2)  # 2 bytes per sample

    try:
        async with websockets.connect(uri) as ws:
            # Receive welcome
            await ws.recv()

            # Start recording
            await ws.send('{"type": "start"}')
            await ws.recv()
            print("Recording started")

            # Send audio chunks
            chunk_size = 3200  # 100ms chunks
            for i in range(0, len(audio_data), chunk_size):
                chunk = audio_data[i:i + chunk_size]
                await ws.send(chunk)
                await asyncio.sleep(0.05)  # Simulate real-time

            print(f"Sent {len(audio_data)} bytes of audio data")

            # Stop recording
            await ws.send('{"type": "stop"}')

            # Collect all responses
            messages = []
            while True:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
                    messages.append(msg)
                except asyncio.TimeoutError:
                    break

            print(f"Received {len(messages)} messages")
            for i, msg in enumerate(messages[:5]):  # Show first 5
                parsed = json.loads(msg)
                msg_type = parsed.get("type", "unknown")
                print(f"  Message {i+1}: type={msg_type}")

            return True

    except Exception as e:
        print(f"Audio stream test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def main():
    """Run all integration tests."""
    print(f"Testing VTThought Backend v{settings.app_version}")
    print(f"Environment: {settings.environment}")
    print(f"Target: http://{settings.host}:{settings.port}")

    results = {
        "health": await test_health_check(),
        "websocket": await test_websocket_connection(),
        "audio": await test_audio_stream(),
    }

    print("\n=== Test Results ===")
    for name, passed in results.items():
        status = "PASS" if passed else "FAIL"
        print(f"{name}: {status}")

    all_passed = all(results.values())
    print(f"\nOverall: {'ALL TESTS PASSED' if all_passed else 'SOME TESTS FAILED'}")

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
