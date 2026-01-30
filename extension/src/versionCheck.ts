/**
 * Version Checking and Compatibility (ADR-024)
 *
 * Provides version negotiation between extension and backend.
 * Checks compatibility and enables feature detection.
 */

import * as vscode from 'vscode';

/**
 * Extension version (from package.json)
 */
export const EXTENSION_VERSION = '0.1.0';

/**
 * Required API and protocol versions
 */
const REQUIRED_API_VERSION = 'v1';
const REQUIRED_PROTOCOL_VERSION = '1.0';

/**
 * Backend version information from /api/version endpoint
 */
export interface BackendVersion {
    backend_version: string;
    api_versions: string[];
    protocol_versions: string[];
    min_extension_version: string;
    features: string[];
}

/**
 * Compatibility check result
 */
export interface CompatibilityResult {
    compatible: boolean;
    issues: string[];
    backendVersion: string;
    extensionVersion: string;
    features: string[];
}

/**
 * Version checker for backend compatibility (ADR-024)
 */
export class VersionChecker {
    private readonly extensionVersion: string;
    private readonly requiredApiVersion: string;
    private readonly requiredProtocolVersion: string;

    constructor(
        extensionVersion: string = EXTENSION_VERSION,
        requiredApiVersion: string = REQUIRED_API_VERSION,
        requiredProtocolVersion: string = REQUIRED_PROTOCOL_VERSION
    ) {
        this.extensionVersion = extensionVersion;
        this.requiredApiVersion = requiredApiVersion;
        this.requiredProtocolVersion = requiredProtocolVersion;
    }

    /**
     * Check compatibility with backend by fetching version info
     *
     * @param apiUrl - Backend API URL (e.g., "http://localhost:8000")
     * @param authHeader - Optional authorization header
     * @returns Compatibility check result
     */
    async checkCompatibility(
        apiUrl: string,
        authHeader?: string
    ): Promise<CompatibilityResult> {
        const issues: string[] = [];
        let backendVersion: BackendVersion | null = null;

        try {
            // Fetch version info from backend
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (authHeader) {
                headers['Authorization'] = authHeader;
            }

            const response = await fetch(`${apiUrl}/api/version`, { headers });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            backendVersion = await response.json() as BackendVersion;

            // Check if extension meets minimum version requirement
            if (this.compareSemver(this.extensionVersion, backendVersion.min_extension_version) < 0) {
                issues.push(
                    `Extension version ${this.extensionVersion} is too old. ` +
                    `Backend requires at least ${backendVersion.min_extension_version}. ` +
                    `Please update your extension.`
                );
            }

            // Check if backend supports required API version
            if (!backendVersion.api_versions.includes(this.requiredApiVersion)) {
                issues.push(
                    `Backend does not support API ${this.requiredApiVersion}. ` +
                    `Supported: ${backendVersion.api_versions.join(', ')}. ` +
                    `Please update your backend.`
                );
            }

            // Check if backend supports required protocol version
            if (!backendVersion.protocol_versions.includes(this.requiredProtocolVersion)) {
                issues.push(
                    `Backend does not support protocol ${this.requiredProtocolVersion}. ` +
                    `Supported: ${backendVersion.protocol_versions.join(', ')}. ` +
                    `Please update your backend.`
                );
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            issues.push(`Failed to fetch version information: ${message}`);
        }

        return {
            compatible: issues.length === 0,
            issues,
            backendVersion: backendVersion?.backend_version || 'unknown',
            extensionVersion: this.extensionVersion,
            features: backendVersion?.features || [],
        };
    }

    /**
     * Compare two semantic version strings
     *
     * @param a - First version (e.g., "1.2.3")
     * @param b - Second version (e.g., "1.0.0")
     * @returns Negative if a < b, 0 if equal, positive if a > b
     */
    private compareSemver(a: string, b: string): number {
        const parseVersion = (v: string): [number, number, number] => {
            const parts = v.split('.').map(Number);
            const major = parts[0] || 0;
            const minor = parts[1] || 0;
            const patch = parts[2] || 0;
            return [major, minor, patch];
        };

        const [aMajor, aMinor, aPatch] = parseVersion(a);
        const [bMajor, bMinor, bPatch] = parseVersion(b);

        if (aMajor !== bMajor) return aMajor - bMajor;
        if (aMinor !== bMinor) return aMinor - bMinor;
        return aPatch - bPatch;
    }
}

/**
 * Feature detector for graceful degradation (ADR-024)
 *
 * Uses feature flags from backend version endpoint to enable/disable features.
 */
export class FeatureDetector {
    private readonly features: Set<string>;

    constructor(features: string[]) {
        this.features = new Set(features);
    }

    /**
     * Check if a specific feature is available
     *
     * @param feature - Feature name to check
     * @returns True if feature is available
     */
    hasFeature(feature: string): boolean {
        return this.features.has(feature);
    }

    /**
     * Check if streaming STT with interim results is available
     */
    supportsStreaming(): boolean {
        return this.hasFeature('streaming');
    }

    /**
     * Check if user-specific vocabulary is available
     */
    supportsVocabulary(): boolean {
        return this.hasFeature('vocabulary');
    }

    /**
     * Check if voice command parsing is available
     */
    supportsVoiceCommands(): boolean {
        return this.hasFeature('voice_commands');
    }

    /**
     * Check if style learning is available
     */
    supportsStyleLearning(): boolean {
        return this.hasFeature('style_learning');
    }

    /**
     * Check if OAuth authentication is available
     */
    supportsOAuth(): boolean {
        return this.hasFeature('oauth');
    }

    /**
     * Check if learned corrections are available
     */
    supportsCorrections(): boolean {
        return this.hasFeature('corrections');
    }

    /**
     * Check if multi-user support is available
     */
    supportsMultiUser(): boolean {
        return this.hasFeature('multi_user');
    }

    /**
     * Get all available features
     */
    getAllFeatures(): string[] {
        return Array.from(this.features);
    }
}

/**
 * Handle compatibility errors with user-friendly dialog
 *
 * @param result - Compatibility check result
 * @returns Promise that resolves when user handles the error
 */
export async function handleCompatibilityError(
    result: CompatibilityResult
): Promise<void> {
    const message = result.issues.join('\n\n');

    const action = await vscode.window.showErrorMessage(
        `VTThought: Version Incompatibility\n\n${message}`,
        'Update Extension',
        'Check Backend',
        'Connect Anyway',
        'Cancel'
    );

    switch (action) {
        case 'Update Extension':
            await vscode.commands.executeCommand(
                'workbench.extensions.action.checkForUpdates'
            );
            break;

        case 'Check Backend':
            await vscode.env.openExternal(
                vscode.Uri.parse('https://github.com/jedarden/vtthought#updating')
            );
            break;

        case 'Connect Anyway':
            // User chose to proceed despite incompatibility
            return;

        case 'Cancel':
        default:
            throw new Error('Version incompatible - connection cancelled by user');
    }
}

/**
 * Log compatibility result to output channel
 *
 * @param result - Compatibility check result
 * @param outputChannel - Output channel to log to
 */
export function logCompatibilityResult(
    result: CompatibilityResult,
    outputChannel: vscode.OutputChannel
): void {
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] Version Check Result:`);
    outputChannel.appendLine(`  Compatible: ${result.compatible}`);
    outputChannel.appendLine(`  Extension: ${result.extensionVersion}`);
    outputChannel.appendLine(`  Backend: ${result.backendVersion}`);
    outputChannel.appendLine(`  Features: ${result.features.join(', ') || 'none'}`);

    if (result.issues.length > 0) {
        outputChannel.appendLine('  Issues:');
        for (const issue of result.issues) {
            outputChannel.appendLine(`    - ${issue}`);
        }
    }
}
