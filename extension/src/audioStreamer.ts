/**
 * Audio Streamer
 * Handles streaming audio data to the backend via WebSocket
 * Per ADR-004: Audio Streaming Protocol
 *
 * Extended to handle interim/streaming/final messages (ADR-006, ADR-007)
 */

import type { ServerMessage } from './textInsertion';

export interface AudioStreamerOptions {
    readonly sampleRate: number;
    readonly channels: number;
}

export interface AudioStreamerEvents {
    onConnected?: () => void;
    onDisconnected?: () => void;
    onError?: (error: Error) => void;
    onMessage?: (message: ServerMessage) => void;
}

/**
 * Audio Streamer Class
 * Converts Float32Array audio samples to PCM16 and streams via WebSocket
 * Handles server messages for interim, streaming, and final results
 */
export class AudioStreamer {
    private ws: WebSocket | null = null;
    private url: string;
    private options: AudioStreamerOptions;
    private events: AudioStreamerEvents;
    private isStreaming: boolean = false;

    constructor(url: string, options: AudioStreamerOptions, events: AudioStreamerEvents = {}) {
        this.url = url;
        this.options = options;
        this.events = events;
    }

    /**
     * Connect to the WebSocket server
     */
    public connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);
                this.isStreaming = false;

                this.ws.onopen = () => {
                    this.isStreaming = true;
                    this.events.onConnected?.();
                    resolve();
                };

                this.ws.onerror = (event) => {
                    const error = new Error('WebSocket connection error');
                    this.events.onError?.(error);
                    reject(error);
                };

                this.ws.onclose = () => {
                    this.isStreaming = false;
                    this.events.onDisconnected?.();
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event);
                };

            } catch (error) {
                const err = error instanceof Error ? error : new Error('Failed to create WebSocket');
                this.events.onError?.(err);
                reject(err);
            }
        });
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
     * Close the connection
     */
    public close(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isStreaming = false;
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
