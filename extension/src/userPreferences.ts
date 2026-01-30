/**
 * VTThought User Preferences Module (ADR-011)
 *
 * Manages user vocabulary, style preferences, and learned corrections
 * by communicating with the backend API.
 */

import * as vscode from 'vscode';
import { createEditDetector, EditDetector } from './editDetection';

/**
 * Vocabulary term category.
 */
export type VocabularyCategory = 'technical' | 'project' | 'names' | 'acronyms' | 'general';

/**
 * A vocabulary term for Whisper biasing.
 */
export interface VocabularyTerm {
    word: string;
    category: VocabularyCategory;
    phonetic_hint?: string;
    created_at?: string;
}

/**
 * A learned correction from user edits.
 */
export interface LearnedCorrection {
    original: string;
    corrected: string;
    occurrence_count: number;
    last_seen?: string;
}

/**
 * Punctuation preference.
 */
export type PunctuationStyle = 'standard' | 'minimal' | 'oxford_comma' | 'em_dash';

/**
 * Capitalization preference.
 */
export type CapitalizationStyle = 'standard' | 'sentence' | 'title';

/**
 * Number format preference.
 */
export type NumberStyle = 'digits' | 'words' | 'scientific';

/**
 * Style preferences for text cleanup.
 */
export interface StylePreferences {
    punctuation_style: PunctuationStyle;
    capitalization: CapitalizationStyle;
    number_format: NumberStyle;
    use_abbreviations: boolean;
    oxford_comma: boolean;
    confidence_score?: number;
}

/**
 * User preferences summary.
 */
export interface UserPreferences {
    language: string;
    cleanup_level: 'light' | 'medium' | 'aggressive';
    hotkey_mode: 'push_to_talk' | 'toggle';
}

/**
 * API client for user preferences.
 */
export class UserPreferencesClient {
    private constructor(
        private readonly apiUrl: string,
        private readonly getAuthHeader: () => Promise<string | undefined>
    ) {}

    /**
     * Create a UserPreferencesClient instance.
     *
     * @param apiUrl - Base API URL
     * @param getAuthHeader - Function to get authorization header
     * @returns UserPreferencesClient instance
     */
    public static create(
        apiUrl: string,
        getAuthHeader: () => Promise<string | undefined>
    ): UserPreferencesClient {
        return new UserPreferencesClient(apiUrl, getAuthHeader);
    }

    /**
     * Make an authenticated API request.
     */
    private async request<T>(
        path: string,
        options: RequestInit = {}
    ): Promise<T> {
        const authHeader = await this.getAuthHeader();
        if (!authHeader) {
            throw new Error('Not authenticated');
        }

        const url = `${this.apiUrl}${path}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        if (!response.ok) {
            const error = await response.text().catch(() => 'Unknown error');
            throw new Error(`API error (${response.status}): ${error}`);
        }

        return response.json() as Promise<T>;
    }

    /**
     * Get all vocabulary terms.
     */
    async getVocabulary(): Promise<VocabularyTerm[]> {
        return this.request<VocabularyTerm[]>('/api/user/vocabulary');
    }

    /**
     * Add a vocabulary term.
     *
     * @param word - The word to add
     * @param category - The category of the word
     * @param phoneticHint - Optional phonetic hint
     */
    async addVocabularyTerm(
        word: string,
        category: VocabularyCategory = 'general',
        phoneticHint?: string
    ): Promise<VocabularyTerm> {
        return this.request<VocabularyTerm>('/api/user/vocabulary', {
            method: 'POST',
            body: JSON.stringify({
                word,
                category,
                phonetic_hint: phoneticHint,
            }),
        });
    }

    /**
     * Remove a vocabulary term.
     *
     * @param word - The word to remove
     */
    async removeVocabularyTerm(word: string): Promise<void> {
        await this.request(`/api/user/vocabulary?word=${encodeURIComponent(word)}`, {
            method: 'DELETE',
        });
    }

    /**
     * Get learned corrections.
     */
    async getLearnedCorrections(): Promise<LearnedCorrection[]> {
        return this.request<LearnedCorrection[]>('/api/user/corrections');
    }

    /**
     * Add a learned correction.
     *
     * @param original - The original text
     * @param corrected - The corrected text
     */
    async addLearnedCorrection(
        original: string,
        corrected: string
    ): Promise<void> {
        await this.request('/api/user/corrections', {
            method: 'POST',
            body: JSON.stringify({ original, corrected }),
        });
    }

    /**
     * Clear all learned corrections.
     */
    async clearLearnedCorrections(): Promise<void> {
        await this.request('/api/user/corrections', {
            method: 'DELETE',
        });
    }

    /**
     * Get style preferences.
     */
    async getStylePreferences(): Promise<StylePreferences> {
        return this.request<StylePreferences>('/api/user/style');
    }

    /**
     * Get user preferences.
     */
    async getUserPreferences(): Promise<UserPreferences> {
        return this.request<UserPreferences>('/api/user/preferences');
    }

    /**
     * Update user preferences.
     *
     * @param preferences - The preferences to update
     */
    async updateUserPreferences(
        preferences: Partial<UserPreferences>
    ): Promise<UserPreferences> {
        return this.request<UserPreferences>('/api/user/preferences', {
            method: 'PUT',
            body: JSON.stringify(preferences),
        });
    }

    /**
     * Report user edits for style learning.
     *
     * @param before - Text before edit
     * @param after - Text after edit
     */
    async reportEditForLearning(before: string, after: string): Promise<void> {
        await this.request('/api/user/style/learn', {
            method: 'POST',
            body: JSON.stringify({
                original: before,
                corrected: after,
                source: 'extension_edit_detection',
            }),
        });
    }

    /**
     * Export all user data (GDPR).
     */
    async exportUserData(): Promise<string> {
        const data = await this.request<{ data: string }>('/api/user/export');
        return data.data;
    }

    /**
     * Delete all user data (right to be forgotten).
     */
    async deleteUserData(): Promise<void> {
        await this.request('/api/user/data', {
            method: 'DELETE',
        });
    }
}

/**
 * Manager for vocabulary and style UI interactions.
 */
export class UserPreferencesManager {
    private client: UserPreferencesClient | null = null;
    private outputChannel: vscode.OutputChannel;

    private constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly getAuthHeader: () => Promise<string | undefined>
    ) {
        this.outputChannel = vscode.window.createOutputChannel('VTThought Preferences');
    }

    /**
     * Create a UserPreferencesManager instance.
     */
    public static create(
        context: vscode.ExtensionContext,
        getAuthHeader: () => Promise<string | undefined>
    ): UserPreferencesManager {
        return new UserPreferencesManager(context, getAuthHeader);
    }

    /**
     * Get the API client, initializing if necessary.
     */
    private async getClient(): Promise<UserPreferencesClient> {
        if (!this.client) {
            const config = vscode.workspace.getConfiguration('vtthought');
            const apiUrl = config.get<string>('apiUrl', 'http://localhost:8000');
            this.client = UserPreferencesClient.create(apiUrl, this.getAuthHeader);
        }
        return this.client;
    }

    /**
     * Log to output channel.
     */
    private log(message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    /**
     * Show vocabulary management QuickPick.
     */
    async manageVocabulary(): Promise<void> {
        const client = await this.getClient();

        try {
            const vocabulary = await client.getVocabulary();

            if (vocabulary.length === 0) {
                const result = await vscode.window.showQuickPick(
                    ['Add a vocabulary term', 'Cancel'],
                    {
                        title: 'VTThought Vocabulary',
                        placeHolder: 'No vocabulary terms yet. Add one to get started.',
                    }
                );

                if (result === 'Add a vocabulary term') {
                    await this.addVocabularyTerm();
                }
                return;
            }

            // Create QuickPick items with categories
            const items: vscode.QuickPickItem[] = vocabulary.map((term) => ({
                label: term.word,
                description: this.getCategoryIcon(term.category) + ' ' + term.category,
                detail: term.phonetic_hint ? `Phonetic: ${term.phonetic_hint}` : undefined,
            }));

            // Add management options at the top
            items.unshift(
                { label: '$(plus) Add Vocabulary Term', description: 'Add a new word or phrase' },
                { label: '$(x) Remove Multiple Terms', description: 'Bulk remove vocabulary terms' },
                { label: '$(refresh) Refresh', description: 'Reload vocabulary from server' }
            );

            const selection = await vscode.window.showQuickPick(items, {
                title: `VTThought Vocabulary (${vocabulary.length} terms)`,
                placeHolder: 'Select a term to manage or add a new one',
            });

            if (!selection) {
                return;
            }

            if (selection.label === '$(plus) Add Vocabulary Term') {
                await this.addVocabularyTerm();
            } else if (selection.label === '$(x) Remove Multiple Terms') {
                await this.removeMultipleVocabularyTerms(vocabulary);
            } else if (selection.label === '$(refresh) Refresh') {
                vscode.window.showInformationMessage('Vocabulary refreshed');
            } else {
                // Show term details
                await this.manageVocabularyTerm(selection.label);
            }
        } catch (error) {
            this.log(`Error loading vocabulary: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to load vocabulary: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Get icon for vocabulary category.
     */
    private getCategoryIcon(category: VocabularyCategory): string {
        const icons: Record<VocabularyCategory, string> = {
            technical: '$(symbol-code)',
            project: '$(folder)',
            names: '$(account)',
            acronyms: '$(symbol-keyword)',
            general: '$(tag)',
        };
        return icons[category] || '$(tag)';
    }

    /**
     * Add a new vocabulary term.
     */
    private async addVocabularyTerm(): Promise<void> {
        // Get word from user
        const word = await vscode.window.showInputBox({
            title: 'Add Vocabulary Term',
            placeHolder: 'Enter the word or phrase',
            prompt: 'Enter the word or phrase to add to your vocabulary',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Please enter a word or phrase';
                }
                return null;
            },
        });

        if (!word) {
            return;
        }

        // Get category from user
        const categoryItems: vscode.QuickPickItem[] = [
            { label: 'Technical', description: 'Code terms, APIs, libraries' },
            { label: 'Project', description: 'Project-specific terms' },
            { label: 'Names', description: 'People, usernames' },
            { label: 'Acronyms', description: 'Abbreviations and acronyms' },
            { label: 'General', description: 'Other vocabulary' },
        ];

        const categorySelection = await vscode.window.showQuickPick(categoryItems, {
            title: 'Select Category',
            placeHolder: 'Choose a category for this term',
        });

        if (!categorySelection) {
            return;
        }

        const category = categorySelection.label.toLowerCase() as VocabularyCategory;

        // Optionally get phonetic hint
        const addPhonetic = await vscode.window.showQuickPick(
            ['Yes, add phonetic hint', 'No, skip'],
            {
                title: 'Add Phonetic Hint',
                placeHolder: 'Would you like to add a phonetic hint?',
            }
        );

        let phoneticHint: string | undefined;
        if (addPhonetic === 'Yes, add phonetic hint') {
            phoneticHint = await vscode.window.showInputBox({
                title: 'Phonetic Hint',
                placeHolder: 'Enter phonetic pronunciation (e.g., "GOO-gul")',
                prompt: 'Enter how the word should be pronounced',
            });
        }

        try {
            const client = await this.getClient();
            await client.addVocabularyTerm(word.trim(), category, phoneticHint);
            this.log(`Added vocabulary term: ${word}`);
            vscode.window.showInformationMessage(`Added "${word}" to vocabulary`);
        } catch (error) {
            this.log(`Error adding vocabulary term: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to add vocabulary term: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Manage a specific vocabulary term.
     */
    private async manageVocabularyTerm(word: string): Promise<void> {
        const options = [
            { label: '$(x) Remove', description: 'Remove this term from vocabulary' },
            { label: '$(pencil) Edit Phonetic Hint', description: 'Change the phonetic hint' },
        ];

        const selection = await vscode.window.showQuickPick(options, {
            title: word,
            placeHolder: 'What would you like to do with this term?',
        });

        if (!selection) {
            return;
        }

        if (selection.label.startsWith('$(x)')) {
            const confirmed = await vscode.window.showWarningMessage(
                `Remove "${word}" from vocabulary?`,
                { modal: true },
                'Remove',
                'Cancel'
            );

            if (confirmed === 'Remove') {
                try {
                    const client = await this.getClient();
                    await client.removeVocabularyTerm(word);
                    this.log(`Removed vocabulary term: ${word}`);
                    vscode.window.showInformationMessage(`Removed "${word}" from vocabulary`);
                } catch (error) {
                    this.log(`Error removing vocabulary term: ${error}`);
                    vscode.window.showErrorMessage(
                        `Failed to remove vocabulary term: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        } else if (selection.label.startsWith('$(pencil)')) {
            const phoneticHint = await vscode.window.showInputBox({
                title: 'Edit Phonetic Hint',
                placeHolder: 'Enter phonetic pronunciation',
                value: '',
                prompt: 'Enter how the word should be pronounced',
            });

            if (phoneticHint !== undefined) {
                // Need to re-add the term with new phonetic hint
                // (API doesn't have update endpoint, so we remove and re-add)
                try {
                    const client = await this.getClient();
                    await client.removeVocabularyTerm(word);
                    await client.addVocabularyTerm(word, 'general', phoneticHint || undefined);
                    this.log(`Updated phonetic hint for: ${word}`);
                    vscode.window.showInformationMessage(`Updated phonetic hint for "${word}"`);
                } catch (error) {
                    this.log(`Error updating phonetic hint: ${error}`);
                    vscode.window.showErrorMessage(
                        `Failed to update phonetic hint: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        }
    }

    /**
     * Remove multiple vocabulary terms.
     */
    private async removeMultipleVocabularyTerms(vocabulary: VocabularyTerm[]): Promise<void> {
        const items = vocabulary.map((term) => ({
            label: term.word,
            picked: false,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Remove Vocabulary Terms',
            placeHolder: 'Select terms to remove',
            canPickMany: true,
        });

        if (!selected || selected.length === 0) {
            return;
        }

        const confirmed = await vscode.window.showWarningMessage(
            `Remove ${selected.length} vocabulary term(s)?`,
            { modal: true },
            'Remove',
            'Cancel'
        );

        if (confirmed !== 'Remove') {
            return;
        }

        try {
            const client = await this.getClient();
            let removed = 0;

            for (const term of selected) {
                try {
                    await client.removeVocabularyTerm(term.label);
                    removed++;
                } catch (error) {
                    this.log(`Error removing ${term.label}: ${error}`);
                }
            }

            this.log(`Removed ${removed} vocabulary terms`);
            vscode.window.showInformationMessage(`Removed ${removed} of ${selected.length} vocabulary terms`);
        } catch (error) {
            this.log(`Error removing vocabulary terms: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to remove vocabulary terms: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Show style preferences.
     */
    async showStylePreferences(): Promise<void> {
        const client = await this.getClient();

        try {
            const style = await client.getStylePreferences();

            const items: vscode.QuickPickItem[] = [
                {
                    label: 'Punctuation Style',
                    description: style.punctuation_style,
                    detail: this.getPunctuationDescription(style.punctuation_style),
                },
                {
                    label: 'Capitalization',
                    description: style.capitalization,
                    detail: this.getCapitalizationDescription(style.capitalization),
                },
                {
                    label: 'Number Format',
                    description: style.number_format,
                    detail: this.getNumberFormatDescription(style.number_format),
                },
                {
                    label: 'Use Abbreviations',
                    description: style.use_abbreviations ? 'Yes' : 'No',
                    detail: style.use_abbreviations ? "Use contractions like \"don't\"" : "Use full forms like \"do not\"",
                },
                {
                    label: 'Oxford Comma',
                    description: style.oxford_comma ? 'Yes' : 'No',
                    detail: style.oxford_comma ? 'Use comma before "and" in lists' : 'No comma before "and"',
                },
            ];

            if (style.confidence_score !== undefined) {
                items.push({
                    label: 'Confidence Score',
                    description: `${Math.round(style.confidence_score * 100)}%`,
                    detail: 'How confident the system is in these preferences',
                });
            }

            await vscode.window.showQuickPick(items, {
                title: 'VTThought Style Preferences',
                placeHolder: 'Your learned text style preferences',
            });
        } catch (error) {
            this.log(`Error loading style preferences: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to load style preferences: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Get description for punctuation style.
     */
    private getPunctuationDescription(style: PunctuationStyle): string {
        const descriptions: Record<PunctuationStyle, string> = {
            standard: 'Standard punctuation rules',
            minimal: 'Minimal punctuation, cleaner output',
            oxford_comma: 'Use Oxford comma in lists',
            em_dash: 'Use em dashes for pauses',
        };
        return descriptions[style];
    }

    /**
     * Get description for capitalization style.
     */
    private getCapitalizationDescription(style: CapitalizationStyle): string {
        const descriptions: Record<CapitalizationStyle, string> = {
            standard: 'Standard sentence capitalization',
            sentence: 'Only capitalize first word',
            title: 'Title Case for major words',
        };
        return descriptions[style];
    }

    /**
     * Get description for number format style.
     */
    private getNumberFormatDescription(style: NumberStyle): string {
        const descriptions: Record<NumberStyle, string> = {
            digits: 'Use digits (5, 10, 100)',
            words: 'Use words (five, ten, one hundred)',
            scientific: 'Scientific notation for large numbers',
        };
        return descriptions[style];
    }

    /**
     * Show learned corrections.
     */
    async showLearnedCorrections(): Promise<void> {
        const client = await this.getClient();

        try {
            const corrections = await client.getLearnedCorrections();

            if (corrections.length === 0) {
                await vscode.window.showInformationMessage(
                    'No learned corrections yet. The system learns from your edits over time.',
                    { modal: true },
                    'OK'
                );
                return;
            }

            // Sort by occurrence count
            corrections.sort((a, b) => b.occurrence_count - a.occurrence_count);

            const items: vscode.QuickPickItem[] = corrections.map((correction) => ({
                label: correction.original,
                description: `→ ${correction.corrected}`,
                detail: `Used ${correction.occurrence_count} time(s)${correction.last_seen ? ` • Last seen ${new Date(correction.last_seen).toLocaleDateString()}` : ''}`,
            }));

            // Add management options
            items.unshift(
                { label: '$(x) Clear All Corrections', description: 'Remove all learned corrections' }
            );

            const selection = await vscode.window.showQuickPick(items, {
                title: `VTThought Learned Corrections (${corrections.length} items)`,
                placeHolder: 'Corrections learned from your edits',
            });

            if (selection?.label === '$(x) Clear All Corrections') {
                const confirmed = await vscode.window.showWarningMessage(
                    'Clear all learned corrections? This will reset the system\'s learning from your edits.',
                    { modal: true },
                    'Clear All',
                    'Cancel'
                );

                if (confirmed === 'Clear All') {
                    try {
                        await client.clearLearnedCorrections();
                        this.log('Cleared all learned corrections');
                        vscode.window.showInformationMessage('Cleared all learned corrections');
                    } catch (error) {
                        this.log(`Error clearing corrections: ${error}`);
                        vscode.window.showErrorMessage(
                            `Failed to clear corrections: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }
            }
        } catch (error) {
            this.log(`Error loading corrections: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to load corrections: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Show user preferences summary.
     */
    async showUserPreferences(): Promise<void> {
        const client = await this.getClient();

        try {
            const prefs = await client.getUserPreferences();

            const items: vscode.QuickPickItem[] = [
                { label: 'Language', description: prefs.language },
                { label: 'Cleanup Level', description: prefs.cleanup_level },
                { label: 'Hotkey Mode', description: prefs.hotkey_mode === 'push_to_talk' ? 'Push to Talk' : 'Toggle' },
            ];

            await vscode.window.showQuickPick(items, {
                title: 'VTThought User Preferences',
                placeHolder: 'Your current preferences',
            });
        } catch (error) {
            this.log(`Error loading preferences: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to load preferences: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Export user data.
     */
    async exportUserData(): Promise<void> {
        const client = await this.getClient();

        try {
            const data = await client.exportUserData();

            // Show in new editor
            const document = await vscode.workspace.openTextDocument({
                language: 'json',
                content: JSON.stringify(JSON.parse(data), null, 2),
            });

            await vscode.window.showTextDocument(document);
            this.log('Exported user data');
        } catch (error) {
            this.log(`Error exporting data: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to export data: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Delete all user data.
     */
    async deleteUserData(): Promise<void> {
        const confirmation = await vscode.window.showInputBox({
            title: 'Delete All User Data',
            prompt: 'Type "DELETE" to confirm deletion of all your vocabulary, corrections, and preferences.',
            placeHolder: 'DELETE',
            validateInput: (value) => {
                if (value !== 'DELETE') {
                    return 'Please type "DELETE" to confirm';
                }
                return null;
            },
        });

        if (confirmation !== 'DELETE') {
            return;
        }

        try {
            const client = await this.getClient();
            await client.deleteUserData();
            this.log('Deleted all user data');
            vscode.window.showInformationMessage('All user data has been deleted');
        } catch (error) {
            this.log(`Error deleting data: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to delete data: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Report a user edit for style learning.
     *
     * This should be called when the user makes edits to transcribed text.
     *
     * @param before - Text before the edit
     * @param after - Text after the edit
     */
    async reportEdit(before: string, after: string): Promise<void> {
        try {
            const client = await this.getClient();
            await client.reportEditForLearning(before, after);
            this.log(`Reported edit for learning: "${before}" → "${after}"`);
        } catch (error) {
            this.log(`Error reporting edit: ${error}`);
            // Don't show error to user - this is background learning
        }
    }

    /**
     * Dispose resources.
     */
    dispose(): void {
        this.outputChannel.dispose();
    }
}

// Re-export edit detector for convenience
export { createEditDetector, EditDetector } from './editDetection';
