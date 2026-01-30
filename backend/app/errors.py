"""
VTThought Error Handling (ADR-015)

Defines error types, circuit breaker, and retry logic for robust error handling.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


class ErrorCategory(str, Enum):
    """Error categories for proper handling and recovery."""

    CONNECTION = "connection"
    BACKEND = "backend"
    AUTHENTICATION = "authentication"
    DEVICE = "device"
    RATE_LIMIT = "rate_limit"
    TIMEOUT = "timeout"
    VALIDATION = "validation"


@dataclass
class VTThoughtError(Exception):
    """Base error for VTThought."""

    message: str
    category: ErrorCategory
    code: str
    retryable: bool = False
    retry_after: float | None = None  # seconds
    details: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return self.message


@dataclass
class ConnectionError(VTThoughtError):
    """Connection-related errors."""

    def __init__(
        self,
        message: str,
        code: str = "CONNECTION_ERROR",
        retryable: bool = True,
        **details: Any,
    ):
        super().__init__(
            message=message,
            category=ErrorCategory.CONNECTION,
            code=code,
            retryable=retryable,
            details=details,
        )


@dataclass
class BackendError(VTThoughtError):
    """Backend processing errors."""

    def __init__(
        self,
        message: str,
        code: str = "BACKEND_ERROR",
        retryable: bool = False,
        **details: Any,
    ):
        super().__init__(
            message=message,
            category=ErrorCategory.BACKEND,
            code=code,
            retryable=retryable,
            details=details,
        )


@dataclass
class AuthenticationError(VTThoughtError):
    """Authentication-related errors."""

    def __init__(
        self,
        message: str,
        code: str = "AUTH_ERROR",
        retryable: bool = False,
        **details: Any,
    ):
        super().__init__(
            message=message,
            category=ErrorCategory.AUTHENTICATION,
            code=code,
            retryable=retryable,
            details=details,
        )


@dataclass
class RateLimitError(VTThoughtError):
    """Rate limiting errors."""

    def __init__(
        self,
        message: str,
        retry_after: float = 60.0,
        code: str = "RATE_LIMITED",
        **details: Any,
    ):
        super().__init__(
            message=message,
            category=ErrorCategory.RATE_LIMIT,
            code=code,
            retryable=True,
            retry_after=retry_after,
            details=details,
        )


@dataclass
class TimeoutError(VTThoughtError):
    """Timeout errors."""

    def __init__(
        self,
        message: str,
        code: str = "TIMEOUT",
        retryable: bool = True,
        **details: Any,
    ):
        super().__init__(
            message=message,
            category=ErrorCategory.TIMEOUT,
            code=code,
            retryable=retryable,
            details=details,
        )


@dataclass
class ValidationError(VTThoughtError):
    """Validation errors for input data."""

    def __init__(
        self,
        message: str,
        code: str = "VALIDATION_ERROR",
        **details: Any,
    ):
        super().__init__(
            message=message,
            category=ErrorCategory.VALIDATION,
            code=code,
            retryable=False,
            details=details,
        )


class CircuitState(str, Enum):
    """Circuit breaker states."""

    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if recovered


class CircuitBreakerError(VTThoughtError):
    """Error raised when circuit breaker is open."""

    def __init__(self, message: str = "Service temporarily unavailable"):
        super().__init__(
            message=message,
            category=ErrorCategory.CONNECTION,
            code="CIRCUIT_OPEN",
            retryable=False,
        )


@dataclass
class CircuitBreaker:
    """
    Circuit breaker to prevent cascading failures.

    Opens after consecutive failures, closes after successful recovery test.
    """

    # Circuit state
    state: CircuitState = CircuitState.CLOSED
    failures: int = 0
    last_failure: float = 0.0
    successes_in_half_open: int = 0

    # Configuration
    failure_threshold: int = 5
    reset_timeout: float = 30.0  # seconds
    success_threshold: int = 2

    # Optional name for logging
    name: str = "default"

    def on_success(self) -> None:
        """Handle successful operation."""
        if self.state == CircuitState.HALF_OPEN:
            self.successes_in_half_open += 1
            if self.successes_in_half_open >= self.success_threshold:
                logger.info(f"Circuit breaker '{self.name}' closing after recovery")
                self.state = CircuitState.CLOSED
                self.failures = 0
                self.successes_in_half_open = 0
        else:
            self.failures = 0

    def on_failure(self) -> None:
        """Handle failed operation."""
        self.failures += 1
        self.last_failure = time.time()

        if self.state == CircuitState.HALF_OPEN:
            logger.warning(f"Circuit breaker '{self.name}' opening during half-open test")
            self.state = CircuitState.OPEN
            self.successes_in_half_open = 0
        elif self.failures >= self.failure_threshold:
            logger.warning(
                f"Circuit breaker '{self.name}' opening after {self.failures} failures"
            )
            self.state = CircuitState.OPEN

    def can_execute(self) -> bool:
        """Check if operation can be executed."""
        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure > self.reset_timeout:
                logger.info(f"Circuit breaker '{self.name}' entering half-open state")
                self.state = CircuitState.HALF_OPEN
                return True
            return False
        return True

    async def execute(self, operation: Callable[..., T]) -> T:
        """
        Execute operation with circuit breaker protection.

        Raises:
            CircuitBreakerError: If circuit is open
        """
        if not self.can_execute():
            raise CircuitBreakerError(
                f"Service '{self.name}' is temporarily unavailable (circuit open)"
            )

        try:
            result = await operation()
            self.on_success()
            return result
        except Exception as e:
            self.on_failure()
            raise

    def get_state(self) -> CircuitState:
        """Get current circuit state."""
        return self.state


@dataclass
class RetryConfig:
    """Configuration for retry logic."""

    max_attempts: int = 3
    base_delay: float = 1.0  # seconds
    max_delay: float = 30.0  # seconds
    exponential_base: float = 2.0
    jitter: bool = True
    jitter_factor: float = 0.2


async def retry_with_backoff(
    operation: Callable[..., T],
    config: RetryConfig | None = None,
    is_retryable: Callable[[Exception], bool] | None = None,
) -> T:
    """
    Retry operation with exponential backoff.

    Args:
        operation: Async function to retry
        config: Retry configuration
        is_retryable: Function to determine if error is retryable

    Returns:
        Result of successful operation

    Raises:
        Exception: Last exception if all retries exhausted
    """
    if config is None:
        config = RetryConfig()

    if is_retryable is None:

        def default_retryable(e: Exception) -> bool:
            return isinstance(e, VTThoughtError) and e.retryable

        is_retryable = default_retryable

    last_error: Exception | None = None

    for attempt in range(config.max_attempts):
        try:
            return await operation()
        except Exception as e:
            last_error = e

            # Don't retry if not retryable or last attempt
            if not is_retryable(e) or attempt == config.max_attempts - 1:
                raise

            # Calculate delay with exponential backoff
            delay = min(
                config.base_delay * (config.exponential_base**attempt),
                config.max_delay,
            )

            # Add jitter
            if config.jitter:
                import random

                jitter_amount = delay * config.jitter_factor * (2 * random.random() - 1)
                delay = max(0, delay + jitter_amount)

            logger.info(f"Retrying operation after {delay:.2f}s (attempt {attempt + 1})")
            await asyncio.sleep(delay)

    # Should not reach here, but mypy needs it
    if last_error:
        raise last_error
    raise RuntimeError("Retry logic exhausted without error")


# Global circuit breakers for external services
_circuit_breakers: dict[str, CircuitBreaker] = {}


def get_circuit_breaker(
    name: str,
    failure_threshold: int = 5,
    reset_timeout: float = 30.0,
    success_threshold: int = 2,
) -> CircuitBreaker:
    """
    Get or create circuit breaker for a service.

    Args:
        name: Service name
        failure_threshold: Failures before opening
        reset_timeout: Seconds before attempting recovery
        success_threshold: Successes needed in half-open to close

    Returns:
        CircuitBreaker instance
    """
    if name not in _circuit_breakers:
        _circuit_breakers[name] = CircuitBreaker(
            name=name,
            failure_threshold=failure_threshold,
            reset_timeout=reset_timeout,
            success_threshold=success_threshold,
        )
    return _circuit_breakers[name]


def reset_circuit_breakers() -> None:
    """Reset all circuit breakers (for testing)."""
    _circuit_breakers.clear()
