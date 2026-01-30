#!/usr/bin/env python3
"""
VTThought STT Real Audio Test

Tests the Whisper STT service with actual audio data.
Generates a synthetic test audio file with speech-like content.
"""
import asyncio
import json
import sys
import logging
from pathlib import Path

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add app to path
sys.path.insert(0, str(Path(__file__).parent))


def generate_test_audio_tone(duration: float = 2.0, sample_rate: int = 16000) -> bytes:
    """
    Generate a simple test tone audio in PCM16 format.

    This generates a sine wave tone that can be used to test
    the audio pipeline. While not real speech, it verifies
    that the audio processing pipeline works.

    Args:
        duration: Duration in seconds
        sample_rate: Sample rate in Hz (default 16000)

    Returns:
        PCM16 audio bytes
    """
    import struct
    import math

    num_samples = int(sample_rate * duration)
    frequency = 440.0  # A4 note
    amplitude = 0.3  # 30% of max volume

    audio_data = bytearray()
    for i in range(num_samples):
        # Generate sine wave
        value = math.sin(2 * math.pi * frequency * i / sample_rate) * amplitude
        # Convert to PCM16 (little-endian)
        sample = int(value * 32767)
        audio_data.extend(struct.pack('<h', sample))

    return bytes(audio_data)


async def test_stt_service():
    """Test the STT service with generated audio."""
    from app.services.stt import get_stt_service
    from app.config import get_settings
    import numpy as np

    settings = get_settings()
    logger.info(f"Testing STT with model: {settings.stt_model}")

    # Generate test audio (2 seconds of tone)
    logger.info("Generating test audio...")
    audio_bytes = generate_test_audio_tone(duration=2.0)

    # Convert to numpy array for STT
    audio_array = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

    logger.info(f"Audio array shape: {audio_array.shape}, duration: {len(audio_array) / 16000:.2f}s")

    # Get STT service (this loads the model)
    logger.info("Loading Whisper model...")
    stt = get_stt_service()

    # Test transcription
    logger.info("Transcribing audio...")
    try:
        result = stt.transcribe_final(
            audio_bytes,
            sample_rate=16000,
            initial_prompt="Technical terms: programming, code, function, variable, class."
        )
        logger.info(f"Transcription result: {result.text}")
        logger.info(f"Confidence: {result.confidence:.2f}")
        logger.info(f"Language: {result.language}")
        return True
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_websocket_with_audio():
    """Test WebSocket endpoint with real audio."""
    import websockets
    from app.config import get_settings

    settings = get_settings()
    uri = f"ws://{settings.host}:{settings.port}/api/ws/audio"

    logger.info(f"Testing WebSocket with audio: {uri}")

    # Generate test audio
    audio_data = generate_test_audio_tone(duration=1.5)
    chunk_size = 3200  # 100ms chunks

    try:
        async with websockets.connect(uri) as ws:
            # Receive welcome
            msg = await ws.recv()
            logger.info(f"Connected: {json.loads(msg)}")

            # Start recording
            await ws.send('{"type": "start"}')
            response = await ws.recv()
            logger.info(f"Started recording: {json.loads(response)}")

            # Send audio chunks in real-time
            logger.info(f"Sending {len(audio_data)} bytes of audio...")
            chunks_sent = 0
            for i in range(0, len(audio_data), chunk_size):
                chunk = audio_data[i:i + chunk_size]
                await ws.send(chunk)
                chunks_sent += 1
                await asyncio.sleep(0.05)  # Simulate real-time streaming

            logger.info(f"Sent {chunks_sent} audio chunks")

            # Stop recording
            await ws.send('{"type": "stop"}')
            logger.info("Stopped recording, waiting for transcription...")

            # Collect all responses
            messages = []
            while True:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                    messages.append(msg)
                except asyncio.TimeoutError:
                    break

            logger.info(f"Received {len(messages)} messages")
            for i, msg in enumerate(messages[:10]):  # Show first 10
                parsed = json.loads(msg)
                msg_type = parsed.get("type", "unknown")
                if msg_type in ("interim", "final"):
                    text = parsed.get("text", "")
                    logger.info(f"  Message {i+1}: type={msg_type}, text='{text}'")
                else:
                    logger.info(f"  Message {i+1}: type={msg_type}")

            return True

    except Exception as e:
        logger.error(f"WebSocket audio test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_stt_model_availability():
    """Test if Whisper model is available and can be loaded."""
    from app.services.stt import get_stt_service

    logger.info("Testing Whisper model availability...")

    try:
        stt = get_stt_service()
        # Access model property to trigger lazy loading
        _ = stt.model
        logger.info("Whisper model loaded successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to load Whisper model: {e}")
        import traceback
        traceback.print_exc()
        return False


async def main():
    """Run all STT real audio tests."""
    print("=" * 60)
    print("VTThought STT Real Audio Tests")
    print("=" * 60)

    results = {}

    # Test 1: Model availability
    print("\n[Test 1] Whisper Model Availability")
    print("-" * 40)
    results["model_available"] = await test_stt_model_availability()

    # Test 2: Direct STT service test
    print("\n[Test 2] Direct STT Service Test")
    print("-" * 40)
    results["stt_service"] = await test_stt_service()

    # Test 3: WebSocket with audio
    print("\n[Test 3] WebSocket with Real Audio")
    print("-" * 40)
    results["websocket_audio"] = await test_websocket_with_audio()

    # Summary
    print("\n" + "=" * 60)
    print("Test Results Summary")
    print("=" * 60)
    for name, passed in results.items():
        status = "PASS" if passed else "FAIL"
        print(f"  {name}: {status}")

    all_passed = all(results.values())
    print(f"\nOverall: {'ALL TESTS PASSED' if all_passed else 'SOME TESTS FAILED'}")
    print("=" * 60)

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
