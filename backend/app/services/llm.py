"""
VTThought LLM Post-Processing Service (ADR-006)

LLM-based transcription cleanup using Ollama or cloud providers.
Supports streaming responses and multiple LLM backends.
"""
from __future__ import annotations

import asyncio
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from functools import lru_cache
from typing import TYPE_CHECKING, AsyncIterator, Optional

import httpx

if TYPE_CHECKING:
    from app.models.transcription import CleanupContext, VoiceCommand

from app.errors import (
    BackendError,
    CircuitBreaker,
    ConnectionError as VTConnectionError,
    RateLimitError,
    RetryConfig,
    TimeoutError as VTTimeoutError,
    get_circuit_breaker,
    retry_with_backoff,
)

logger = logging.getLogger(__name__)


class LLMProvider(str, Enum):
    """Available LLM providers."""

    OLLAMA = "ollama"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


@dataclass
class CleanupContext:
    """Context passed to LLM for transcription cleanup."""

    # Required
    raw_transcription: str

    # User personalization (ADR-011)
    user_vocabulary: list[str] = field(default_factory=list)
    learned_corrections: dict[str, str] = field(default_factory=dict)

    # Session context (optional but improves accuracy)
    current_file: Optional[str] = None
    recent_actions: list[str] = field(default_factory=list)
    open_files: list[str] = field(default_factory=list)
    git_branch: Optional[str] = None

    # Preferences
    cleanup_level: str = "moderate"  # minimal, moderate, aggressive
    preserve_casing: bool = True


@dataclass
class CleanupResult:
    """Result from LLM cleanup."""

    cleaned_text: str
    raw_text: str
    commands: list[dict] = field(default_factory=list)


class BaseLLMProvider(ABC):
    """Abstract base for any LLM provider."""

    @abstractmethod
    async def complete(self, prompt: str) -> str:
        """Get completion from LLM."""
        pass

    @abstractmethod
    async def stream(self, prompt: str) -> AsyncIterator[str]:
        """Stream completion from LLM."""
        pass


class OllamaProvider(BaseLLMProvider):
    """Ollama local LLM provider."""

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model: str = "llama3.1:8b",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._client: Optional[httpx.AsyncClient] = None
        self._circuit_breaker = get_circuit_breaker(
            name="ollama",
            failure_threshold=3,
            reset_timeout=60.0,
        )

    @property
    def client(self) -> httpx.AsyncClient:
        """Lazy-create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=120.0)
        return self._client

    async def close(self) -> None:
        """Close HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    async def complete(self, prompt: str) -> str:
        """Get completion from Ollama with error handling."""
        async def _do_complete() -> str:
            try:
                response = await self.client.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {
                            "temperature": 0.1,
                            "num_predict": 200,
                        }
                    },
                )
                response.raise_for_status()
                data = response.json()
                return data.get("response", "").strip()
            except httpx.ConnectError as e:
                raise VTConnectionError(
                    message=f"Cannot connect to Ollama at {self.base_url}",
                    code="OLLAMA_CONNECTION_ERROR",
                    retryable=True,
                ) from e
            except httpx.TimeoutException as e:
                raise VTTimeoutError(
                    message=f"Ollama request timed out",
                    code="OLLAMA_TIMEOUT",
                ) from e
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429:
                    raise RateLimitError(
                        message="Ollama is rate limited",
                        retry_after=30.0,
                    ) from e
                raise BackendError(
                    message=f"Ollama returned error: {e.response.status_code}",
                    code="OLLAMA_HTTP_ERROR",
                    retryable=e.response.status_code >= 500,
                ) from e

        return await retry_with_backoff(
            _do_complete,
            config=RetryConfig(max_attempts=3, base_delay=1.0),
        )

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        """Stream completion from Ollama with error handling."""
        try:
            async with self.client.stream(
                "POST",
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": True,
                    "options": {
                        "temperature": 0.1,
                        "num_predict": 200,
                    }
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        try:
                            data = json.loads(line)
                            if "response" in data:
                                yield data["response"]
                        except json.JSONDecodeError:
                            continue
        except httpx.ConnectError as e:
            logger.error(f"Ollama connection error during streaming: {e}")
            raise VTConnectionError(
                message=f"Cannot connect to Ollama at {self.base_url}",
                code="OLLAMA_CONNECTION_ERROR",
                retryable=True,
            ) from e
        except httpx.TimeoutException as e:
            logger.error(f"Ollama timeout during streaming: {e}")
            raise VTTimeoutError(
                message=f"Ollama request timed out",
                code="OLLAMA_TIMEOUT",
            ) from e
        except httpx.HTTPStatusError as e:
            logger.error(f"Ollama HTTP error during streaming: {e}")
            if e.response.status_code == 429:
                raise RateLimitError(
                    message="Ollama is rate limited",
                    retry_after=30.0,
                ) from e
            raise BackendError(
                message=f"Ollama returned error: {e.response.status_code}",
                code="OLLAMA_HTTP_ERROR",
            ) from e


class OpenAIProvider(BaseLLMProvider):
    """OpenAI API provider."""

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o-mini",
        base_url: str = "https://api.openai.com/v1",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=120.0,
            )
        return self._client

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def complete(self, prompt: str) -> str:
        response = await self.client.post(
            "/chat/completions",
            json={
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 200,
            },
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"].strip()

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        async with self.client.stream(
            "POST",
            "/chat/completions",
            json={
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 200,
                "stream": True,
            },
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        delta = data["choices"][0].get("delta", {})
                        if "content" in delta:
                            yield delta["content"]
                    except (json.JSONDecodeError, KeyError):
                        continue


class AnthropicProvider(BaseLLMProvider):
    """Anthropic Claude API provider."""

    def __init__(
        self,
        api_key: str,
        model: str = "claude-3-5-haiku-20241022",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url="https://api.anthropic.com",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                timeout=120.0,
            )
        return self._client

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def complete(self, prompt: str) -> str:
        response = await self.client.post(
            "/v1/messages",
            json={
                "model": self.model,
                "max_tokens": 200,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        response.raise_for_status()
        data = response.json()
        return data["content"][0]["text"].strip()

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        async with self.client.stream(
            "POST",
            "/v1/messages",
            json={
                "model": self.model,
                "max_tokens": 200,
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
            },
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data_str = line[6:]
                    try:
                        data = json.loads(data_str)
                        if data["type"] == "content_block_delta":
                            yield data["delta"]["text"]
                    except (json.JSONDecodeError, KeyError):
                        continue


def build_cleanup_prompt(ctx: CleanupContext, style_prompt: str = "") -> str:
    """
    Build a prompt that works with any LLM.

    Implements the prompt from ADR-006 for cross-provider compatibility.
    Integrated with user style preferences (ADR-011).

    Args:
        ctx: Cleanup context with transcription and metadata
        style_prompt: Optional user style preferences prompt

    Returns:
        Formatted prompt for LLM
    """
    # Build vocabulary hint section
    vocab_section = ""
    if ctx.user_vocabulary:
        vocab_section = f"""
## Technical Vocabulary
These are known technical terms - preserve them exactly:
{', '.join(ctx.user_vocabulary[:30])}
"""

    # Build corrections section
    corrections_section = ""
    if ctx.learned_corrections:
        examples = [f'"{k}" → "{v}"' for k, v in list(ctx.learned_corrections.items())[:10]]
        corrections_section = f"""
## Known Corrections
Apply these learned corrections:
{chr(10).join(examples)}
"""

    # Build context section
    context_section = ""
    if ctx.current_file or ctx.recent_actions:
        context_section = "## Current Context\n"
        if ctx.current_file:
            context_section += f"- Working file: {ctx.current_file}\n"
        if ctx.git_branch:
            context_section += f"- Git branch: {ctx.git_branch}\n"
        if ctx.recent_actions:
            context_section += f"- Recent actions: {', '.join(ctx.recent_actions[-3:])}\n"
        if ctx.open_files:
            context_section += f"- Open files: {', '.join(ctx.open_files[:5])}\n"

    # Cleanup level instructions
    level_instructions = {
        "minimal": "Only remove filler words (um, uh, er). Keep everything else.",
        "moderate": "Remove filler words, fix grammar, handle corrections. Keep technical accuracy.",
        "aggressive": "Rewrite for clarity while preserving exact intent. Make it concise and professional.",
    }

    # Build style section if provided
    style_section = f"\n{style_prompt}" if style_prompt else ""

    return f"""You are a speech-to-text cleanup assistant for a developer tool. Transform the spoken transcription into clear, actionable text.

## Rules
1. REMOVE filler words: um, uh, like, you know, so, basically, actually, kind of, sort of, er, ah
2. HANDLE self-corrections: When the speaker says "actually", "wait", "no", "I mean", use ONLY the corrected version
   - "create a file wait no delete the file" → "delete the file"
   - "um add a function actually make it a class" → "add a class"
3. FIX grammar and add punctuation
4. PRESERVE technical terms, function names, file paths, and code exactly
5. OUTPUT only the cleaned text - no explanations, no quotes, no prefixes
{vocab_section}{corrections_section}{context_section}{style_section}
## Cleanup Level: {ctx.cleanup_level}
{level_instructions.get(ctx.cleanup_level, level_instructions["moderate"])}

## Examples

Input: "um can you like create a new function called uh get user data"
Output: Create a new function called getUserData

Input: "fix that bug in the uh wait no actually delete the whole file"
Output: Delete the whole file

Input: "add a try catch block to the you know the main function"
Output: Add a try-catch block to the main function

Input: "open the um what's it called the config dot yaml file"
Output: Open the config.yaml file

Input: "run the tests no wait first commit the changes then run tests"
Output: Commit the changes, then run the tests

## Transcription to Clean
{ctx.raw_transcription}

## Cleaned Output"""


async def cleanup_with_style(
    raw_text: str,
    user_id: str,
    llm: BaseLLMProvider,
    vocabulary: list[str] | None = None,
    corrections: dict[str, str] | None = None,
    session_context: dict | None = None,
) -> str:
    """
    Apply LLM cleanup with user's learned style preferences (ADR-011).

    Args:
        raw_text: Raw transcription to clean
        user_id: User ID for personalization
        llm: LLM provider instance
        vocabulary: Optional user vocabulary list
        corrections: Optional learned corrections dict
        session_context: Optional session context (file, branch, etc.)

    Returns:
        Cleaned transcription with user style applied
    """
    from app.services.style import StyleLearner

    # Get user's style preferences
    style_learner = StyleLearner(user_id)
    style_prompt = await style_learner.get_style_prompt()

    # Build cleanup context
    ctx = CleanupContext(
        raw_transcription=raw_text,
        user_vocabulary=vocabulary or [],
        learned_corrections=corrections or {},
        current_file=session_context.get("current_file") if session_context else None,
        git_branch=session_context.get("git_branch") if session_context else None,
        recent_actions=session_context.get("recent_actions", []) if session_context else [],
        open_files=session_context.get("open_files", []) if session_context else [],
        cleanup_level="moderate",
    )

    # Build prompt with style preferences
    prompt = build_cleanup_prompt(ctx, style_prompt)

    return await llm.complete(prompt)


class TranscriptionCleaner:
    """
    Transcription cleanup service using LLM.

    Implements the full cleanup pipeline from ADR-006.
    """

    def __init__(self, llm: BaseLLMProvider) -> None:
        """
        Initialize cleaner.

        Args:
            llm: LLM provider instance
        """
        self.llm = llm

    async def cleanup(self, ctx: CleanupContext) -> CleanupResult:
        """
        Clean up raw transcription.

        Args:
            ctx: Cleanup context with transcription and optional metadata

        Returns:
            CleanupResult with cleaned text and extracted voice commands
        """
        # Skip LLM for very short text
        if len(ctx.raw_transcription.split()) <= 3:
            cleaned = self._rule_based_cleanup(ctx.raw_transcription)
            return CleanupResult(cleaned_text=cleaned, raw_text=ctx.raw_transcription)

        # Build prompt and get completion
        prompt = build_cleanup_prompt(ctx)

        # For now, use non-streaming completion
        # Streaming will be integrated in the WebSocket endpoint
        cleaned = await self.llm.complete(prompt)

        # Apply learned corrections
        if ctx.learned_corrections:
            cleaned = self._apply_corrections(cleaned, ctx.learned_corrections)

        # Parse voice commands (placeholder - will be implemented with ADR-008)
        commands = []  # TODO: Implement voice command parsing

        return CleanupResult(
            cleaned_text=cleaned,
            raw_text=ctx.raw_transcription,
            commands=commands,
        )

    async def cleanup_stream(
        self, ctx: CleanupContext
    ) -> AsyncIterator[str]:
        """
        Stream cleanup tokens.

        Args:
            ctx: Cleanup context

        Yields:
            Cleaned text tokens as they arrive
        """
        if len(ctx.raw_transcription.split()) <= 3:
            # Short text: rule-based only
            yield self._rule_based_cleanup(ctx.raw_transcription)
            return

        prompt = build_cleanup_prompt(ctx)

        async for token in self.llm.stream(prompt):
            yield token

    def _rule_based_cleanup(self, text: str) -> str:
        """Fast cleanup for short text without LLM."""
        import re

        # Remove common fillers
        fillers = r'\b(um|uh|er|ah|like|you know|basically|actually|so)\b'
        text = re.sub(fillers, '', text, flags=re.IGNORECASE)
        text = re.sub(r'\s+', ' ', text).strip()
        return text.capitalize() if text else text

    def _apply_corrections(
        self, text: str, corrections: dict[str, str]
    ) -> str:
        """Apply user's learned corrections."""
        import re

        for wrong, right in corrections.items():
            text = re.sub(re.escape(wrong), right, text, flags=re.IGNORECASE)
        return text

    async def close(self) -> None:
        """Close LLM connection."""
        if hasattr(self.llm, "close"):
            await self.llm.close()


@lru_cache
def get_llm_provider() -> BaseLLMProvider:
    """
    Get LLM provider from configuration.

    Creates provider based on LLM_PROVIDER setting.
    """
    from app.config import get_settings

    settings = get_settings()

    provider_type = settings.llm_provider.lower()

    if provider_type == "ollama":
        return OllamaProvider(
            base_url=settings.llm_base_url,
            model=settings.llm_model,
        )
    elif provider_type == "openai":
        api_key = settings.llm_api_key if hasattr(settings, 'llm_api_key') else ""
        if not api_key:
            logger.warning("OpenAI API key not set, falling back to Ollama")
            return OllamaProvider(base_url=settings.llm_base_url, model=settings.llm_model)
        return OpenAIProvider(api_key=api_key, model=settings.llm_model)
    elif provider_type == "anthropic":
        api_key = settings.llm_api_key if hasattr(settings, 'llm_api_key') else ""
        if not api_key:
            logger.warning("Anthropic API key not set, falling back to Ollama")
            return OllamaProvider(base_url=settings.llm_base_url, model=settings.llm_model)
        return AnthropicProvider(api_key=api_key, model=settings.llm_model)
    else:
        logger.warning(f"Unknown LLM provider: {provider_type}, using Ollama")
        return OllamaProvider(base_url=settings.llm_base_url, model=settings.llm_model)


def get_cleaner() -> TranscriptionCleaner:
    """Get new transcription cleaner instance."""
    return TranscriptionCleaner(get_llm_provider())
