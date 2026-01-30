/**
 * Audio Streamer
 * Handles streaming audio data to the backend via WebSocket
 * Per ADR-004: Audio Streaming Protocol
 */

export interface AudioStreamerOptions {
    readonly sampleRate: number;
    readonly channels: number;
}

export interface AudioStreamerEvents {
    onConnected?: () => void;
    onDisconnected?: () => void;
    onError?: (error: Error) => void;
}

/**
 * Audio Streamer Class
 * Converts Float32Array audio samples to PCM16 and streams via WebSocket
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

            } catch (error) {
                const err = error instanceof Error ? error : new Error('Failed to create WebSocket');
                this.events.onError?.(err);
                reject(err);
            }
        });
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
     * Send end-of-stream signal
     */
    public sendEndOfStream(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        // Send empty buffer to signal end of stream
        this.ws.send(new ArrayBuffer(0));
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
