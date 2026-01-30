/**
 * VTThought Error Handling (ADR-015)
 *
 * Defines error types, circuit breaker, and retry logic for robust error handling.
 */

import * as vscode from 'vscode';

/**
 * Error categories for proper handling and recovery.
 */
export enum ErrorCategory {
    CONNECTION = 'connection',
    BACKEND = 'backend',
    AUTHENTICATION = 'authentication',
    DEVICE = 'device',
    RATE_LIMIT = 'rate_limit',
    TIMEOUT = 'timeout',
    VALIDATION = 'validation',
}

/**
 * Base error for VTThought.
 */
export class VTThoughtError extends Error {
    readonly category: ErrorCategory;
    readonly code: string;
    readonly retryable: boolean;
    readonly retryAfter?: number; // seconds
    readonly details: Record<string, unknown>;

    constructor(
        message: string,
        category: ErrorCategory,
        code: string,
        retryable = false,
        details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'VTThoughtError';
        this.category = category;
        this.code = code;
        this.retryable = retryable;
        this.details = details ?? {};
    }
}

/**
 * Connection-related errors.
 */
export class ConnectionError extends VTThoughtError {
    constructor(
        message: string,
        code = 'CONNECTION_ERROR',
        retryable = true,
        details?: Record<string, unknown>
    ) {
        super(message, ErrorCategory.CONNECTION, code, retryable, details);
        this.name = 'ConnectionError';
    }
}

/**
 * Backend processing errors.
 */
export class BackendError extends VTThoughtError {
    constructor(
        message: string,
        code = 'BACKEND_ERROR',
        retryable = false,
        details?: Record<string, unknown>
    ) {
        super(message, ErrorCategory.BACKEND, code, retryable, details);
        this.name = 'BackendError';
    }
}

/**
 * Authentication-related errors.
 */
export class AuthenticationError extends VTThoughtError {
    constructor(
        message: string,
        code = 'AUTH_ERROR',
        details?: Record<string, unknown>
    ) {
        super(message, ErrorCategory.AUTHENTICATION, code, false, details);
        this.name = 'AuthenticationError';
    }
}

/**
 * Rate limiting errors.
 */
export class RateLimitError extends VTThoughtError {
    declare readonly retryAfter: number;

    constructor(
        message: string,
        retryAfter = 60.0,
        details?: Record<string, unknown>
    ) {
        super(
            message,
            ErrorCategory.RATE_LIMIT,
            'RATE_LIMITED',
            true,
            { ...details, retryAfter }
        );
        this.name = 'RateLimitError';
        Object.defineProperty(this, 'retryAfter', {
            value: retryAfter,
            enumerable: true,
            writable: false,
        });
    }
}

/**
 * Timeout errors.
 */
export class TimeoutError extends VTThoughtError {
    constructor(
        message: string,
        code = 'TIMEOUT',
        retryable = true,
        details?: Record<string, unknown>
    ) {
        super(message, ErrorCategory.TIMEOUT, code, retryable, details);
        this.name = 'TimeoutError';
    }
}

/**
 * Validation errors for input data.
 */
export class ValidationError extends VTThoughtError {
    constructor(
        message: string,
        details?: Record<string, unknown>
    ) {
        super(message, ErrorCategory.VALIDATION, 'VALIDATION_ERROR', false, details);
        this.name = 'ValidationError';
    }
}

/**
 * Circuit breaker states.
 */
export enum CircuitState {
    CLOSED = 'closed',      // Normal operation
    OPEN = 'open',          // Failing, reject requests
    HALF_OPEN = 'half_open' // Testing if recovered
}

/**
 * Error raised when circuit breaker is open.
 */
export class CircuitBreakerError extends VTThoughtError {
    constructor(message = 'Service temporarily unavailable') {
        super(message, ErrorCategory.CONNECTION, 'CIRCUIT_OPEN', false);
        this.name = 'CircuitBreakerError';
    }
}

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerConfig {
    failureThreshold: number;
    resetTimeout: number; // milliseconds
    successThreshold: number;
}

/**
 * Circuit breaker to prevent cascading failures.
 *
 * Opens after consecutive failures, closes after successful recovery test.
 */
export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failures = 0;
    private lastFailure = 0;
    private successesInHalfOpen = 0;
    private readonly name: string;

    constructor(
        private readonly config: CircuitBreakerConfig,
        name = 'default'
    ) {
        this.name = name;
    }

    onSuccess(): void {
        if (this.state === CircuitState.HALF_OPEN) {
            this.successesInHalfOpen++;
            if (this.successesInHalfOpen >= this.config.successThreshold) {
                console.info(`Circuit breaker '${this.name}' closing after recovery`);
                this.state = CircuitState.CLOSED;
                this.failures = 0;
                this.successesInHalfOpen = 0;
            }
        } else {
            this.failures = 0;
        }
    }

    onFailure(): void {
        this.failures++;
        this.lastFailure = Date.now();

        if (this.state === CircuitState.HALF_OPEN) {
            console.warn(`Circuit breaker '${this.name}' opening during half-open test`);
            this.state = CircuitState.OPEN;
            this.successesInHalfOpen = 0;
        } else if (this.failures >= this.config.failureThreshold) {
            console.warn(
                `Circuit breaker '${this.name}' opening after ${this.failures} failures`
            );
            this.state = CircuitState.OPEN;
        }
    }

    canExecute(): boolean {
        if (this.state === CircuitState.OPEN) {
            if (Date.now() - this.lastFailure > this.config.resetTimeout) {
                console.info(`Circuit breaker '${this.name}' entering half-open state`);
                this.state = CircuitState.HALF_OPEN;
                return true;
            }
            return false;
        }
        return true;
    }

    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (!this.canExecute()) {
            throw new CircuitBreakerError(
                `Service '${this.name}' is temporarily unavailable (circuit open)`
            );
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    getState(): CircuitState {
        return this.state;
    }

    reset(): void {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.lastFailure = 0;
        this.successesInHalfOpen = 0;
    }
}

/**
 * Retry configuration.
 */
export interface RetryConfig {
    maxAttempts: number;
    baseDelay: number; // milliseconds
    maxDelay: number; // milliseconds
    exponentialBase: number;
    jitter: boolean;
    jitterFactor: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    exponentialBase: 2,
    jitter: true,
    jitterFactor: 0.2,
};

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry operation with exponential backoff.
 */
export async function retryWithBackoff<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
    isRetryable?: (error: unknown) => boolean
): Promise<T> {
    const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

    if (isRetryable === undefined) {
        isRetryable = (e: unknown) =>
            e instanceof VTThoughtError && e.retryable;
    }

    let lastError: unknown;

    for (let attempt = 0; attempt < fullConfig.maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (e) {
            lastError = e;

            // Don't retry if not retryable or last attempt
            if (!isRetryable!(e) || attempt === fullConfig.maxAttempts - 1) {
                throw e;
            }

            // Calculate delay with exponential backoff
            let delay = Math.min(
                fullConfig.baseDelay * Math.pow(fullConfig.exponentialBase, attempt),
                fullConfig.maxDelay
            );

            // Add jitter
            if (fullConfig.jitter) {
                const jitterAmount = delay * fullConfig.jitterFactor * (2 * Math.random() - 1);
                delay = Math.max(0, delay + jitterAmount);
            }

            console.info(`Retrying operation after ${delay}ms (attempt ${attempt + 1})`);
            await sleep(delay);
        }
    }

    throw lastError;
}

/**
 * Error logger for output channel.
 */
export class ErrorLogger {
    private readonly outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('VTThought');
    }

    logError(category: string, error: Error, context?: Record<string, unknown>): void {
        const timestamp = new Date().toISOString();
        const contextStr = context ? JSON.stringify(context) : '';

        this.outputChannel.appendLine(
            `[${timestamp}] [ERROR] [${category}] ${error.message}`
        );

        if (error.stack) {
            this.outputChannel.appendLine(error.stack);
        }

        if (contextStr) {
            this.outputChannel.appendLine(`Context: ${contextStr}`);
        }

        this.outputChannel.appendLine('---');
    }

    logInfo(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [INFO] ${message}`);
    }

    logWarn(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [WARN] ${message}`);
    }

    show(): void {
        this.outputChannel.show();
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

/**
 * Connection state with reconnection tracking.
 */
export interface ConnectionState {
    status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
    lastError: Error | null;
    reconnectAttempts: number;
}

/**
 * WebSocket reconnection configuration.
 */
export interface ReconnectConfig {
    maxReconnectAttempts: number;
    baseDelay: number; // milliseconds
    maxDelay: number; // milliseconds
}

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
    maxReconnectAttempts: 5,
    baseDelay: 1000,
    maxDelay: 30000,
};

/**
 * Calculate exponential backoff delay with jitter.
 */
export function calculateBackoff(
    attempt: number,
    config: ReconnectConfig = DEFAULT_RECONNECT_CONFIG
): number {
    const delay = Math.min(
        config.baseDelay * Math.pow(2, attempt),
        config.maxDelay
    );
    const jitter = delay * 0.2 * Math.random();
    return delay + jitter;
}

/**
 * Global circuit breakers for external services.
 */
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Get or create circuit breaker for a service.
 */
export function getCircuitBreaker(
    name: string,
    config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
    if (!circuitBreakers.has(name)) {
        const defaultConfig: CircuitBreakerConfig = {
            failureThreshold: 5,
            resetTimeout: 30000,
            successThreshold: 2,
        };
        circuitBreakers.set(name, new CircuitBreaker(
            { ...defaultConfig, ...config },
            name
        ));
    }
    return circuitBreakers.get(name)!;
}

/**
 * Reset all circuit breakers (for testing).
 */
export function resetAllCircuitBreakers(): void {
    circuitBreakers.forEach(cb => cb.reset());
}
