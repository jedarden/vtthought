/**
 * VTThought Edit Detection Module (ADR-011)
 *
 * Tracks user edits to transcribed text for style learning.
 * Detects when users modify transcribed text and reports changes.
 */

import * as vscode from 'vscode';

/**
 * Edit event representing a user change to transcribed text.
 */
export interface EditEvent {
    before: string;
    after: string;
    timestamp: number;
    documentUri: string;
}

/**
 * Configuration for edit detection.
 */
export interface EditDetectionConfig {
    /**
     * Minimum time after insertion to consider edits as "learning edits".
     * Edits within this window are part of the dictation session.
     */
    learningWindowMs: number;

    /**
     * Maximum length of text to track for learning.
     * Longer texts are not tracked to avoid false positives.
     */
    maxTrackLength: number;

    /**
     * Enable/disable edit learning.
     */
    enabled: boolean;
}

/**
 * Default configuration.
 */
const DEFAULT_CONFIG: EditDetectionConfig = {
    learningWindowMs: 30000, // 30 seconds
    maxTrackLength: 500, // characters
    enabled: true,
};

/**
 * Tracks text insertions for potential edit learning.
 */
interface InsertionTrack {
    text: string;
    timestamp: number;
    documentUri: string;
    range: vscode.Range;
}

/**
 * Edit detector for learning user preferences.
 *
 * Tracks text insertions from dictation and detects subsequent edits
 * to learn user style preferences.
 */
export class EditDetector {
    private trackedInsertions = new Map<string, InsertionTrack>();
    private disposables: vscode.Disposable[] = [];
    private config: EditDetectionConfig;

    /**
     * Create an EditDetector instance.
     *
     * @param config - Configuration options
     */
    constructor(config: Partial<EditDetectionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.setupEventHandlers();
    }

    /**
     * Set up VS Code event handlers for edit detection.
     */
    private setupEventHandlers(): void {
        // Track text document changes
        const changeTracker = vscode.workspace.onDidChangeTextDocument((event) => {
            this.handleDocumentChange(event);
        });

        this.disposables.push(changeTracker);
    }

    /**
     * Handle text document change events.
     */
    private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        if (!this.config.enabled) {
            return;
        }

        // Check if this document has tracked insertions
        const uri = event.document.uri.toString();
        const relevantTracks = this.getRelevantTracks(uri, event.contentChanges);

        if (relevantTracks.length === 0) {
            return;
        }

        // Process each relevant change
        for (const change of event.contentChanges) {
            for (const track of relevantTracks) {
                if (this.doesChangeAffectTrack(change, track)) {
                    this.processEdit(track, change, event.document);
                }
            }
        }

        // Clean up old tracks
        this.cleanupOldTracks();
    }

    /**
     * Get tracks that may be affected by the content changes.
     */
    private getRelevantTracks(
        documentUri: string,
        changes: readonly vscode.TextDocumentContentChangeEvent[]
    ): InsertionTrack[] {
        const uri = documentUri;
        const tracks: InsertionTrack[] = [];

        for (const track of this.trackedInsertions.values()) {
            if (track.documentUri !== uri) {
                continue;
            }

            // Check if any change overlaps with the tracked range
            for (const change of changes) {
                const changeRange = change.range;
                const trackRange = track.range;

                if (this.rangesOverlap(changeRange, trackRange)) {
                    tracks.push(track);
                    break;
                }
            }
        }

        return tracks;
    }

    /**
     * Check if two ranges overlap.
     */
    private rangesOverlap(range1: vscode.Range, range2: vscode.Range): boolean {
        return !(range1.end.isBefore(range2.start) || range1.start.isAfter(range2.end));
    }

    /**
     * Check if a change affects a tracked insertion.
     */
    private doesChangeAffectTrack(
        change: vscode.TextDocumentContentChangeEvent,
        track: InsertionTrack
    ): boolean {
        return this.rangesOverlap(change.range, track.range);
    }

    /**
     * Process an edit to tracked text.
     */
    private processEdit(
        track: InsertionTrack,
        change: vscode.TextDocumentContentChangeEvent,
        document: vscode.TextDocument
    ): void {
        const now = Date.now();
        const timeSinceInsertion = now - track.timestamp;

        // Only process edits within the learning window
        if (timeSinceInsertion > this.config.learningWindowMs) {
            this.trackedInsertions.delete(this.getTrackKey(track));
            return;
        }

        // Get the current text in the tracked range
        let currentText: string;
        try {
            currentText = document.getText(track.range);
        } catch {
            // Range may be invalid if document was heavily edited
            this.trackedInsertions.delete(this.getTrackKey(track));
            return;
        }

        // Skip if text hasn't meaningfully changed
        if (currentText === track.text) {
            return;
        }

        // Normalize for comparison (whitespace, case for some scenarios)
        const before = this.normalizeForLearning(track.text);
        const after = this.normalizeForLearning(currentText);

        if (before === after) {
            return;
        }

        // Emit edit event
        this.onEditDetected({
            before: track.text,
            after: currentText,
            timestamp: now,
            documentUri: track.documentUri,
        });

        // Remove track after processing (one learning event per insertion)
        this.trackedInsertions.delete(this.getTrackKey(track));
    }

    /**
     * Normalize text for learning comparison.
     */
    private normalizeForLearning(text: string): string {
        return text.trim();
    }

    /**
     * Get a unique key for a track.
     */
    private getTrackKey(track: InsertionTrack): string {
        return `${track.documentUri}:${track.range.start.line}:${track.range.start.character}:${track.timestamp}`;
    }

    /**
     * Clean up old tracked insertions.
     */
    private cleanupOldTracks(): void {
        const now = Date.now();
        const maxAge = this.config.learningWindowMs * 2; // Keep for 2x the window

        for (const [key, track] of this.trackedInsertions.entries()) {
            if (now - track.timestamp > maxAge) {
                this.trackedInsertions.delete(key);
            }
        }
    }

    /**
     * Track a text insertion for potential edit learning.
     *
     * Call this when inserting transcribed text.
     *
     * @param text - The inserted text
     * @param range - The range where text was inserted
     * @param documentUri - The document URI
     */
    trackInsertion(text: string, range: vscode.Range, documentUri: string): void {
        if (!this.config.enabled) {
            return;
        }

        // Skip tracking very long texts
        if (text.length > this.config.maxTrackLength) {
            return;
        }

        // Skip tracking if text is too short
        if (text.length < 10) {
            return;
        }

        // Skip tracking if text is mostly whitespace
        const trimmed = text.trim();
        if (trimmed.length < text.length * 0.5) {
            return;
        }

        const track: InsertionTrack = {
            text,
            timestamp: Date.now(),
            documentUri,
            range,
        };

        const key = this.getTrackKey(track);
        this.trackedInsertions.set(key, track);
    }

    /**
     * Edit detected event callback.
     * Override this to handle edit events.
     */
    protected onEditDetected(event: EditEvent): void {
        // Default: do nothing, override for custom handling
    }

    /**
     * Update configuration.
     */
    updateConfig(config: Partial<EditDetectionConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration.
     */
    getConfig(): EditDetectionConfig {
        return { ...this.config };
    }

    /**
     * Clear all tracked insertions.
     */
    clearTrackedInsertions(): void {
        this.trackedInsertions.clear();
    }

    /**
     * Get count of currently tracked insertions.
     */
    getTrackedCount(): number {
        return this.trackedInsertions.size;
    }

    /**
     * Dispose resources.
     */
    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
        this.trackedInsertions.clear();
    }
}

/**
 * Edit detector with callback for reporting edits to backend.
 */
export class ReportingEditDetector extends EditDetector {
    private editCallback: (event: EditEvent) => void;

    /**
     * Create a ReportingEditDetector instance.
     *
     * @param editCallback - Callback to handle edit events (can be async)
     * @param config - Configuration options
     */
    constructor(
        editCallback: (event: EditEvent) => void | Promise<void>,
        config: Partial<EditDetectionConfig> = {}
    ) {
        super(config);
        // Wrap async callback to make it fire-and-forget
        this.editCallback = (event) => {
            // Don't await - let it run in background
            Promise.resolve(editCallback(event)).catch(err => {
                console.error('Edit callback error:', err);
            });
        };
    }

    /**
     * Handle edit detected event by calling the callback.
     */
    protected onEditDetected(event: EditEvent): void {
        this.editCallback(event);
    }
}

/**
 * Create an edit detector integrated with UserPreferencesManager.
 *
 * @param preferencesManager - The preferences manager to report edits to
 * @param config - Configuration options
 * @returns Configured edit detector
 */
export function createEditDetector(
    preferencesManager: import('./userPreferences').UserPreferencesManager,
    config: Partial<EditDetectionConfig> = {}
): ReportingEditDetector {
    return new ReportingEditDetector(
        async (event) => {
            await preferencesManager.reportEdit(event.before, event.after);
        },
        config
    );
}
