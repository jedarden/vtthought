"""
VTThought Configuration

Configuration management using Pydantic Settings.
Supports environment variables and .env files.
"""
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "VTThought Backend"
    app_version: str = "0.1.0"
    debug: bool = False
    environment: Literal["development", "production", "testing"] = "development"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    reload: bool = True

    # CORS
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:8080",
        "vscode-webview://*",
    ]

    # WebSocket
    ws_max_connections: int = 10
    ws_message_queue_size: int = 100
    ws_heartbeat_interval: int = 30

    # Audio (ADR-003, ADR-004)
    audio_sample_rate: int = 16000
    audio_channels: int = 1
    audio_chunk_size: int = 4096
    max_audio_duration_seconds: int = 300

    # STT (ADR-005) - Configuration for faster-whisper
    stt_engine: Literal["faster-whisper", "deepgram"] = "faster-whisper"
    stt_model: str = "base"
    stt_device: Literal["cpu", "cuda", "auto"] = "auto"
    stt_compute_type: Literal["int8", "float16", "float32"] = "float16"
    stt_model_path: str = "~/.cache/whisper"  # User-writable location for models

    # STT Performance Tuning (ADR-005)
    stt_beam_size: int = 5  # Beam size for transcription quality
    stt_best_of: int = 5  # Number of candidates to consider
    stt_vad_threshold: float = 0.5  # Voice activity detection threshold
    stt_vad_min_speech_ms: int = 250  # Minimum speech duration for VAD
    stt_vad_min_silence_ms: int = 500  # Minimum silence duration for VAD
    stt_streaming_chunk_size: int = 16000  # 1 second at 16kHz
    stt_streaming_process_interval: int = 8000  # Process every 500ms

    # LLM (ADR-006) - Configuration for Ollama
    llm_provider: Literal["ollama", "openai"] = "ollama"
    llm_base_url: str = "http://localhost:11434"
    llm_model: str = "llama3.1:8b"
    llm_temperature: float = 0.3
    llm_max_tokens: int = 2048

    # LLM Performance Tuning (ADR-006)
    llm_http_timeout: float = 120.0  # HTTP request timeout in seconds
    llm_circuit_failure_threshold: int = 3  # Failures before circuit opens
    llm_circuit_reset_timeout: float = 60.0  # Seconds before retrying after circuit opens
    llm_retry_max_attempts: int = 3  # Maximum retry attempts
    llm_retry_base_delay: float = 1.0  # Base delay for exponential backoff
    llm_rate_limit_retry_after: float = 30.0  # Seconds to wait on rate limit

    # Authentication (ADR-002)
    jwt_secret_key: str = "your-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24 * 7  # 1 week

    # OAuth (ADR-002) - Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""

    # OAuth (ADR-002) - GitHub OAuth (legacy, kept for backwards compatibility)
    github_client_id: str = ""
    github_client_secret: str = ""

    # Rate Limiting (ADR-010)
    rate_limit_requests: int = 100
    rate_limit_period_seconds: int = 60

    # Cloudflare Tunnel (ADR-009)
    cloudflare_tunnel_token: str = ""

    # Observability (ADR-019)
    enable_metrics: bool = True
    enable_health_endpoint: bool = True
    log_level: str = "INFO"

    # Caching (ADR-011) - Vocabulary and style cache tuning
    vocab_cache_max_size: int = 500  # Max number of cached vocabulary prompts
    vocab_cache_ttl_seconds: int = 3600  # Cache TTL for vocabulary (1 hour)
    vocab_whisper_max_terms: int = 50  # Max terms to include in Whisper prompt
    style_learning_min_occurrences: int = 3  # Min occurrences before learning style preference
    style_learning_context_window: int = 20  # Context window for style extraction

    # Database (ADR-011)
    db_pool_size: int = 5  # Connection pool size for SQLite


@lru_cache
def get_settings() -> Settings:
    """
    Get cached settings instance.

    Uses lru_cache to ensure settings are loaded only once.
    """
    return Settings()
