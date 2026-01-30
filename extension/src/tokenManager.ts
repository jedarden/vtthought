/**
 * VTThought Token Manager (ADR-002)
 *
 * Manages authentication tokens for the VTThought extension.
 * Uses VS Code's secret storage for secure token persistence.
 */

import * as vscode from 'vscode';

/**
 * Token Manager for VTThought extension authentication.
 *
 * Handles:
 * - Secure storage of extension tokens using VS Code's secret storage
 * - Backend URL configuration
 * - Token validation and refresh
 */
export class TokenManager {
    private static readonly TOKEN_KEY = 'vtthought.token';
    private static readonly BACKEND_URL_KEY = 'vtthought.backendUrl';

    private constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Create a TokenManager instance.
     *
     * @param context - VS Code extension context
     * @returns TokenManager instance
     */
    public static create(context: vscode.ExtensionContext): TokenManager {
        return new TokenManager(context);
    }

    /**
     * Store the extension token in secure storage.
     *
     * @param token - The extension token to store
     */
    public async storeToken(token: string): Promise<void> {
        await this.context.secrets.store(TokenManager.TOKEN_KEY, token);
    }

    /**
     * Get the stored extension token.
     *
     * @returns The stored token or undefined if not found
     */
    public async getToken(): Promise<string | undefined> {
        return await this.context.secrets.get(TokenManager.TOKEN_KEY);
    }

    /**
     * Clear the stored extension token.
     */
    public async clearToken(): Promise<void> {
        await this.context.secrets.delete(TokenManager.TOKEN_KEY);
    }

    /**
     * Check if a token is stored.
     *
     * @returns True if a token is stored
     */
    public async hasToken(): Promise<boolean> {
        const token = await this.getToken();
        return token !== undefined;
    }

    /**
     * Store the backend URL.
     *
     * @param url - The backend URL to store
     */
    public async storeBackendUrl(url: string): Promise<void> {
        await this.context.globalState.update(TokenManager.BACKEND_URL_KEY, url);
    }

    /**
     * Get the stored backend URL.
     *
     * @returns The stored backend URL or default
     */
    public async getBackendUrl(): Promise<string> {
        // Check global state first
        const storedUrl = this.context.globalState.get<string>(TokenManager.BACKEND_URL_KEY);
        if (storedUrl) {
            return storedUrl;
        }

        // Fall back to configuration
        const config = vscode.workspace.getConfiguration('vtthought');
        return config.get<string>('backendUrl', 'http://localhost:8000');
    }

    /**
     * Get the WebSocket URL for audio streaming.
     *
     * @returns The WebSocket URL with token parameter
     */
    public async getWebSocketUrl(): Promise<string> {
        const backendUrl = await this.getBackendUrl();
        const token = await this.getToken();

        if (!token) {
            throw new Error('No authentication token stored');
        }

        // Convert HTTP to WebSocket protocol
        const wsUrl = backendUrl
            .replace(/^https:\/\//, 'wss://')
            .replace(/^http:\/\//, 'ws://');

        // Append token as query parameter
        return `${wsUrl}/api/ws/audio?token=${encodeURIComponent(token)}`;
    }

    /**
     * Validate that authentication is configured.
     *
     * @returns True if both token and backend URL are configured
     */
    public async isConfigured(): Promise<boolean> {
        const token = await this.getToken();
        const backendUrl = await this.getBackendUrl();
        return !!token && !!backendUrl;
    }

    /**
     * Get authorization header for HTTP requests.
     *
     * @returns Authorization header value or undefined
     */
    public async getAuthHeader(): Promise<string | undefined> {
        const token = await this.getToken();
        if (!token) {
            return undefined;
        }
        return `Bearer ${token}`;
    }

    /**
     * Clear all stored authentication data.
     */
    public async clearAll(): Promise<void> {
        await this.clearToken();
        await this.context.globalState.update(TokenManager.BACKEND_URL_KEY, undefined);
    }
}

/**
 * Authentication status for the extension.
 */
export interface AuthStatus {
    isConfigured: boolean;
    hasToken: boolean;
    backendUrl: string;
}

/**
 * Get the current authentication status.
 *
 * @param tokenManager - The TokenManager instance
 * @returns Current authentication status
 */
export async function getAuthStatus(tokenManager: TokenManager): Promise<AuthStatus> {
    const [hasToken, backendUrl] = await Promise.all([
        tokenManager.hasToken(),
        tokenManager.getBackendUrl(),
    ]);

    return {
        isConfigured: hasToken && !!backendUrl,
        hasToken,
        backendUrl,
    };
}
