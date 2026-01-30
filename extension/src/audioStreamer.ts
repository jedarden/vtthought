/**
 * Audio Streamer
 * Handles streaming audio data to the backend via WebSocket
 * Per ADR-004: Audio Streaming Protocol
 *
 * Extended to handle interim/streaming/final messages (ADR-006, ADR-007)
 * Extended with error handling and circuit breaker (ADR-015)
 */

import type { ServerMessage } from './textInsertion';
import {
    calculateBackoff,
    CircuitBreaker,
    ConnectionError,
    ConnectionState,
    getCircuitBreaker,
    type ReconnectConfig,
} from './errorHandling';

export interface AudioStreamerOptions {
    readonly sampleRate: number;
    readonly channels: number;
    readonly reconnectConfig?: Partial<ReconnectConfig>;
}

export interface AudioStreamerEvents {
    onConnected?: () => void;
    onDisconnected?: () => void;
    onError?: (error: Error) => void;
    onMessage?: (message: ServerMessage) => void;
    onReconnecting?: (attempt: number) => void;
}

/**
 * Audio Streamer Class
 * Converts Float32Array audio samples to PCM16 and streams via WebSocket
 * Handles server messages for interim, streaming, and final results
 * Implements circuit breaker and automatic reconnection
 */
export class AudioStreamer {
    private ws: WebSocket | null = null;
    private url: string;
    private options: AudioStreamerOptions;
    private events: AudioStreamerEvents;
    private isStreaming: boolean = false;

    // Connection state and reconnection tracking
    private connectionState: ConnectionState = {
        status: 'disconnected',
        lastError: null,
        reconnectAttempts: 0,
    };

    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private circuitBreaker: CircuitBreaker;

    constructor(url: string, options: AudioStreamerOptions, events: AudioStreamerEvents = {}) {
        this.url = url;
        this.options = options;
        this.events = events;

        // Initialize circuit breaker for WebSocket connections
        this.circuitBreaker = getCircuitBreaker('websocket', {
            failureThreshold: 5,
            resetTimeout: 30000,
            successThreshold: 2,
        });
    }

    /**
     * Connect to the WebSocket server with circuit breaker protection.
     */
    public connect(): Promise<void> {
        return this.circuitBreaker.execute(async () => {
            return new Promise((resolve, reject) => {
                try {
                    this.connectionState.status = 'connecting';
                    this.ws = new WebSocket(this.url);
                    this.isStreaming = false;

                    this.ws.onopen = () => {
                        this.connectionState.status = 'connected';
                        this.connectionState.reconnectAttempts = 0;
                        this.connectionState.lastError = null;
                        this.isStreaming = true;

                        this.circuitBreaker.onSuccess();
                        this.events.onConnected?.();
                        resolve();
                    };

                    this.ws.onerror = (event) => {
                        const error = new ConnectionError('WebSocket connection error');
                        this.circuitBreaker.onFailure();
                        this.events.onError?.(error);
                        reject(error);
                    };

                    this.ws.onclose = (event) => {
                        this.isStreaming = false;
                        this.connectionState.status = 'disconnected';

                        // Attempt reconnection on abnormal close
                        if (event.code !== 1000) {
                            this.handleDisconnect(new ConnectionError(
                                `WebSocket closed: ${event.reason || 'Unknown reason'}`
                            ));
                        }

                        this.events.onDisconnected?.();
                    };

                    this.ws.onmessage = (event) => {
                        this.handleMessage(event);
                    };

                } catch (error) {
                    const err = error instanceof Error ? error : new Error('Failed to create WebSocket');
                    this.circuitBreaker.onFailure();
                    this.events.onError?.(err);
                    reject(err);
                }
            });
        });
    }

    /**
     * Handle disconnection with reconnection logic.
     */
    private handleDisconnect(error: Error): void {
        this.connectionState.lastError = error;

        // Clear any existing reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Check circuit breaker and reconnection limits
        if (!this.circuitBreaker.canExecute()) {
            this.events.onError?.(new Error('Service temporarily unavailable (circuit open)'));
            return;
        }

        const reconnectConfig = {
            maxReconnectAttempts: 5,
            baseDelay: 1000,
            maxDelay: 30000,
            ...this.options.reconnectConfig,
        };

        if (this.connectionState.reconnectAttempts >= reconnectConfig.maxReconnectAttempts) {
            this.events.onError?.(new Error('Max reconnection attempts reached'));
            return;
        }

        // Schedule reconnection with exponential backoff
        const delay = calculateBackoff(this.connectionState.reconnectAttempts, reconnectConfig);
        this.connectionState.status = 'reconnecting';
        this.connectionState.reconnectAttempts++;

        this.events.onReconnecting?.(this.connectionState.reconnectAttempts);

        this.reconnectTimer = setTimeout(() => {
            this.connect().catch(err => {
                // Will trigger handleDisconnect again if it fails
            });
        }, delay);
    }

    /**
     * Handle incoming WebSocket message
     */
    private handleMessage(event: MessageEvent): void {
        try {
            const message = JSON.parse(event.data) as ServerMessage;
            this.events.onMessage?.(message);
        } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
        }
    }

    /**
     * Send audio data to the server
     * Converts Float32Array (-1.0 to 1.0) to PCM16 Int16Array
     */
    public sendAudio(samples: Float32Array): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected');
        }

        // Convert Float32Array (-1.0 to 1.0) to Int16Array (-32768 to 32767)
        const pcm16 = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            const sample = Math.max(-1, Math.min(1, samples[i]));
            pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }

        // Send as binary frame
        this.ws.send(pcm16.buffer);
    }

    /**
     * Send control message to server
     */
    public sendControl(type: string, data?: Record<string, unknown>): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected');
        }

        const message = { type, ...data };
        this.ws.send(JSON.stringify(message));
    }

    /**
     * Send start recording signal
     */
    public startRecording(): void {
        this.sendControl('start');
    }

    /**
     * Send stop recording signal
     */
    public stopRecording(): void {
        this.sendControl('stop');
    }

    /**
     * Send ping for heartbeat
     */
    public ping(): void {
        this.sendControl('ping');
    }

    /**
     * Send end-of-stream signal (deprecated - use stopRecording)
     */
    public sendEndOfStream(): void {
        this.stopRecording();
    }

    /**
     * Close the connection and stop reconnection attempts.
     */
    public close(): void {
        // Clear reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Close WebSocket
        if (this.ws) {
            this.ws.close(1000, 'Client closing');
            this.ws = null;
        }

        this.isStreaming = false;
        this.connectionState.status = 'disconnected';
    }

    /**
     * Check if connected and streaming
     */
    public get isConnected(): boolean {
        return this.isStreaming;
    }

    /**
     * Get WebSocket ready state
     */
    public get readyState(): number {
        return this.ws?.readyState ?? WebSocket.CLOSED;
    }
}
