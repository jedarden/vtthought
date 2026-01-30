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
 * A custom voice command.
 */
export interface CustomVoiceCommand {
    id: string;
    triggers: string[];
    action: string;
    params: Record<string, unknown>;
    enabled: boolean;
    created_at: string;
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
    whisper_model?: string;
    enable_llm_cleanup: boolean;
    cleanup_level: 'minimal' | 'moderate' | 'aggressive';
    enable_voice_commands: boolean;
    hotkey_mode: 'push_to_talk' | 'toggle';
    vad_sensitivity?: number;
    silence_duration_ms?: number;
    max_recording_seconds?: number;
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
        await this.request(`/api/user/vocabulary/${encodeURIComponent(word)}`, {
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
    ): Promise<{ status: string; preferences: UserPreferences }> {
        const response = await this.request<{ status: string; preferences: UserPreferences }>('/api/user/preferences', {
            method: 'PUT',
            body: JSON.stringify(preferences),
        });
        return response;
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
    async exportUserData(): Promise<{ user: Record<string, unknown>; preferences: Record<string, unknown>; vocabulary: unknown[]; corrections: unknown[]; style_preferences: unknown[]; voice_commands: unknown[] }> {
        const data = await this.request<{ user: Record<string, unknown>; preferences: Record<string, unknown>; vocabulary: unknown[]; corrections: unknown[]; style_preferences: unknown[]; voice_commands: unknown[] }>('/api/user/export');
        return data;
    }

    /**
     * Delete all user data (right to be forgotten).
     */
    async deleteUserData(): Promise<void> {
        await this.request('/api/user/data', {
            method: 'DELETE',
        });
    }

    /**
     * Get custom voice commands.
     */
    async getCustomVoiceCommands(includeDisabled = false): Promise<CustomVoiceCommand[]> {
        return this.request<CustomVoiceCommand[]>(`/api/user/commands?include_disabled=${includeDisabled}`);
    }

    /**
     * Get a specific custom voice command.
     */
    async getCustomVoiceCommand(cmdId: string): Promise<CustomVoiceCommand> {
        return this.request<CustomVoiceCommand>(`/api/user/commands/${cmdId}`);
    }

    /**
     * Create a custom voice command.
     */
    async createCustomVoiceCommand(command: Omit<CustomVoiceCommand, 'id' | 'created_at'>): Promise<CustomVoiceCommand> {
        return this.request<CustomVoiceCommand>('/api/user/commands', {
            method: 'POST',
            body: JSON.stringify(command),
        });
    }

    /**
     * Update a custom voice command.
     */
    async updateCustomVoiceCommand(
        cmdId: string,
        command: Omit<CustomVoiceCommand, 'id' | 'created_at'>
    ): Promise<CustomVoiceCommand> {
        return this.request<CustomVoiceCommand>(`/api/user/commands/${cmdId}`, {
            method: 'PUT',
            body: JSON.stringify(command),
        });
    }

    /**
     * Delete a custom voice command.
     */
    async deleteCustomVoiceCommand(cmdId: string): Promise<void> {
        await this.request(`/api/user/commands/${cmdId}`, {
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
     * Manage user preferences.
     */
    async manageUserPreferences(): Promise<void> {
        const client = await this.getClient();

        try {
            const prefs = await client.getUserPreferences();

            const items: vscode.QuickPickItem[] = [
                { label: '$(pencil) Edit Preferences', description: 'Change your settings' },
                { label: '---', description: '' },
                { label: 'Language', description: this.getLanguageDescription(prefs.language) },
                { label: 'Cleanup Level', description: this.getCleanupLevelDescription(prefs.cleanup_level) },
                { label: 'Hotkey Mode', description: prefs.hotkey_mode === 'push_to_talk' ? 'Push to Talk' : 'Toggle' },
                { label: 'Enable LLM Cleanup', description: prefs.enable_llm_cleanup ? 'Yes' : 'No' },
                { label: 'Enable Voice Commands', description: prefs.enable_voice_commands ? 'Yes' : 'No' },
            ];

            const selection = await vscode.window.showQuickPick(items, {
                title: 'VTThought User Preferences',
                placeHolder: 'Your current preferences',
            });

            if (selection?.label.startsWith('$(pencil)')) {
                await this.editUserPreferences(prefs);
            }
        } catch (error) {
            this.log(`Error loading preferences: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to load preferences: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Edit user preferences interactively.
     */
    private async editUserPreferences(currentPrefs: UserPreferences): Promise<void> {
        const editableItems: vscode.QuickPickItem[] = [
            { label: 'Language', description: this.getLanguageDescription(currentPrefs.language) },
            { label: 'Cleanup Level', description: this.getCleanupLevelDescription(currentPrefs.cleanup_level) },
            { label: 'Hotkey Mode', description: currentPrefs.hotkey_mode === 'push_to_talk' ? 'Push to Talk' : 'Toggle' },
            { label: 'Enable LLM Cleanup', description: currentPrefs.enable_llm_cleanup ? 'Yes' : 'No' },
            { label: 'Enable Voice Commands', description: currentPrefs.enable_voice_commands ? 'Yes' : 'No' },
        ];

        const selection = await vscode.window.showQuickPick(editableItems, {
            title: 'Edit Preference',
            placeHolder: 'Select a preference to edit',
        });

        if (!selection) {
            return;
        }

        try {
            const client = await this.getClient();
            let updatedPrefs: Partial<UserPreferences> = {};

            switch (selection.label) {
                case 'Language':
                    updatedPrefs = await this.editLanguage(currentPrefs);
                    break;
                case 'Cleanup Level':
                    updatedPrefs = await this.editCleanupLevel(currentPrefs);
                    break;
                case 'Hotkey Mode':
                    updatedPrefs = await this.editHotkeyMode(currentPrefs);
                    break;
                case 'Enable LLM Cleanup':
                    updatedPrefs = { ...currentPrefs, enable_llm_cleanup: !currentPrefs.enable_llm_cleanup };
                    break;
                case 'Enable Voice Commands':
                    updatedPrefs = { ...currentPrefs, enable_voice_commands: !currentPrefs.enable_voice_commands };
                    break;
            }

            if (Object.keys(updatedPrefs).length > 0) {
                await client.updateUserPreferences(updatedPrefs);
                this.log(`Updated preferences: ${JSON.stringify(updatedPrefs)}`);
                vscode.window.showInformationMessage('Preferences updated');

                // Recursively show edit menu for quick changes
                const continueEditing = await vscode.window.showQuickPick(
                    ['Yes', 'No'],
                    { title: 'Continue Editing?', placeHolder: 'Edit another preference?' }
                );
                if (continueEditing === 'Yes') {
                    // Fetch updated prefs and continue
                    const newPrefs = await client.getUserPreferences();
                    await this.editUserPreferences(newPrefs);
                }
            }
        } catch (error) {
            this.log(`Error updating preferences: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to update preferences: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Edit language preference.
     */
    private async editLanguage(currentPrefs: UserPreferences): Promise<Partial<UserPreferences>> {
        const languageItems = [
            { label: 'English', description: 'en' },
            { label: 'Spanish', description: 'es' },
            { label: 'French', description: 'fr' },
            { label: 'German', description: 'de' },
            { label: 'Italian', description: 'it' },
            { label: 'Portuguese', description: 'pt' },
            { label: 'Dutch', description: 'nl' },
            { label: 'Japanese', description: 'ja' },
            { label: 'Chinese (Simplified)', description: 'zh' },
            { label: 'Korean', description: 'ko' },
        ];

        const selection = await vscode.window.showQuickPick(languageItems, {
            title: 'Select Language',
            placeHolder: 'Choose your transcription language',
        });

        if (selection) {
            return { language: selection.description };
        }
        return {};
    }

    /**
     * Edit cleanup level preference.
     */
    private async editCleanupLevel(currentPrefs: UserPreferences): Promise<Partial<UserPreferences>> {
        const levelItems = [
            {
                label: 'Minimal',
                description: 'light',
                detail: 'Only remove filler words (um, uh, like)',
            },
            {
                label: 'Moderate',
                description: 'medium',
                detail: 'Remove fillers, fix grammar and punctuation',
            },
            {
                label: 'Aggressive',
                description: 'aggressive',
                detail: 'Full rewrite for clarity and flow',
            },
        ];

        const selection = await vscode.window.showQuickPick(levelItems, {
            title: 'Select Cleanup Level',
            placeHolder: 'Choose how much to process your text',
        });

        if (selection) {
            return { cleanup_level: selection.description as UserPreferences['cleanup_level'] };
        }
        return {};
    }

    /**
     * Edit hotkey mode preference.
     */
    private async editHotkeyMode(currentPrefs: UserPreferences): Promise<Partial<UserPreferences>> {
        const modeItems = [
            {
                label: 'Push to Talk',
                description: 'push_to_talk',
                detail: 'Hold hotkey to record, release to transcribe',
            },
            {
                label: 'Toggle',
                description: 'toggle',
                detail: 'Press hotkey to start/stop recording',
            },
        ];

        const selection = await vscode.window.showQuickPick(modeItems, {
            title: 'Select Hotkey Mode',
            placeHolder: 'Choose how you want to activate recording',
        });

        if (selection) {
            return { hotkey_mode: selection.description as UserPreferences['hotkey_mode'] };
        }
        return {};
    }

    /**
     * Get description for language code.
     */
    private getLanguageDescription(code: string): string {
        const languages: Record<string, string> = {
            en: 'English',
            es: 'Spanish',
            fr: 'French',
            de: 'German',
            it: 'Italian',
            pt: 'Portuguese',
            nl: 'Dutch',
            ja: 'Japanese',
            zh: 'Chinese (Simplified)',
            ko: 'Korean',
        };
        return languages[code] || code;
    }

    /**
     * Get description for cleanup level.
     */
    private getCleanupLevelDescription(level: UserPreferences['cleanup_level']): string {
        const descriptions: Record<string, string> = {
            minimal: 'Minimal - Only remove fillers',
            moderate: 'Moderate - Fix grammar and punctuation',
            aggressive: 'Aggressive - Full rewrite',
        };
        return descriptions[level] || level;
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
                content: JSON.stringify(data, null, 2),
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
     * Show custom voice commands management UI.
     */
    async manageCustomVoiceCommands(): Promise<void> {
        const client = await this.getClient();

        try {
            const commands = await client.getCustomVoiceCommands(true);

            if (commands.length === 0) {
                const result = await vscode.window.showQuickPick(
                    ['Create a custom command', 'Cancel'],
                    {
                        title: 'VTThought Custom Voice Commands',
                        placeHolder: 'No custom commands yet. Create one to get started.',
                    }
                );

                if (result === 'Create a custom command') {
                    await this.createCustomVoiceCommand();
                }
                return;
            }

            // Create QuickPick items
            const items: vscode.QuickPickItem[] = commands.map((cmd) => ({
                label: cmd.triggers[0] || '(no triggers)',
                description: cmd.action,
                detail: cmd.enabled
                    ? `Triggers: ${cmd.triggers.join(', ')}`
                    : `$(circle-slash) Disabled • Triggers: ${cmd.triggers.join(', ')}`,
            }));

            // Add management options at the top
            items.unshift(
                { label: '$(plus) Create Command', description: 'Add a new custom voice command' },
                { label: '$(refresh) Refresh', description: 'Reload commands from server' }
            );

            const selection = await vscode.window.showQuickPick(items, {
                title: `VTThought Custom Voice Commands (${commands.length})`,
                placeHolder: 'Select a command to manage or create a new one',
            });

            if (!selection) {
                return;
            }

            if (selection.label === '$(plus) Create Command') {
                await this.createCustomVoiceCommand();
            } else if (selection.label === '$(refresh) Refresh') {
                vscode.window.showInformationMessage('Commands refreshed');
            } else {
                // Find the selected command
                const selectedCmd = commands.find(c => c.triggers[0] === selection.label);
                if (selectedCmd) {
                    await this.manageCustomVoiceCommand(selectedCmd);
                }
            }
        } catch (error) {
            this.log(`Error loading commands: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to load commands: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Create a new custom voice command.
     */
    private async createCustomVoiceCommand(): Promise<void> {
        // Get triggers from user
        const triggersInput = await vscode.window.showInputBox({
            title: 'Create Custom Voice Command',
            placeHolder: 'e.g., "save my work", "run tests", "format code"',
            prompt: 'Enter one or more trigger phrases (separate multiple with commas)',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Please enter at least one trigger phrase';
                }
                return null;
            },
        });

        if (!triggersInput) {
            return;
        }

        const triggers = triggersInput
            .split(',')
            .map(t => t.trim())
            .filter(t => t.length > 0);

        // Get action from user
        const action = await vscode.window.showInputBox({
            title: 'Command Action',
            placeHolder: 'e.g., workbench.action.files.save',
            prompt: 'Enter the VS Code command ID to execute',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Please enter a command ID';
                }
                return null;
            },
        });

        if (!action) {
            return;
        }

        // Optionally add parameters
        const addParams = await vscode.window.showQuickPick(
            ['Yes, add parameters', 'No, skip'],
            {
                title: 'Add Parameters',
                placeHolder: 'Would you like to add parameters to the command?',
            }
        );

        let params: Record<string, unknown> = {};
        if (addParams === 'Yes, add parameters') {
            const paramsInput = await vscode.window.showInputBox({
                title: 'Command Parameters',
                placeHolder: '{"to": "up", "by": "line"}',
                prompt: 'Enter parameters as JSON (or leave empty for no parameters)',
            });

            if (paramsInput !== undefined) {
                try {
                    params = paramsInput.trim().length > 0 ? JSON.parse(paramsInput) : {};
                } catch {
                    vscode.window.showWarningMessage('Invalid JSON, using no parameters');
                    params = {};
                }
            }
        }

        try {
            const client = await this.getClient();
            await client.createCustomVoiceCommand({
                triggers,
                action: action.trim(),
                params,
                enabled: true,
            });
            this.log(`Created custom voice command: ${triggers[0]} -> ${action}`);
            vscode.window.showInformationMessage(`Created command "${triggers[0]}"`);
        } catch (error) {
            this.log(`Error creating command: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to create command: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Manage a specific custom voice command.
     */
    private async manageCustomVoiceCommand(command: CustomVoiceCommand): Promise<void> {
        const options: vscode.QuickPickItem[] = [
            { label: '$(pencil) Edit Triggers', description: 'Change the trigger phrases' },
            { label: '$(pencil) Edit Action', description: 'Change the VS Code command' },
            { label: '$(pencil) Edit Parameters', description: 'Change the command parameters' },
            { label: command.enabled ? '$(circle-slash) Disable' : '$(check) Enable', description: command.enabled ? 'Disable this command' : 'Enable this command' },
            { label: '$(x) Delete', description: 'Remove this command' },
        ];

        const selection = await vscode.window.showQuickPick(options, {
            title: command.triggers[0],
            placeHolder: 'What would you like to do with this command?',
        });

        if (!selection) {
            return;
        }

        try {
            const client = await this.getClient();

            if (selection.label.startsWith('$(x)')) {
                const confirmed = await vscode.window.showWarningMessage(
                    `Delete command "${command.triggers[0]}"?`,
                    { modal: true },
                    'Delete',
                    'Cancel'
                );

                if (confirmed === 'Delete') {
                    await client.deleteCustomVoiceCommand(command.id);
                    this.log(`Deleted custom voice command: ${command.id}`);
                    vscode.window.showInformationMessage(`Deleted command "${command.triggers[0]}"`);
                }
            } else if (selection.label.includes('Disable') || selection.label.includes('Enable')) {
                await client.updateCustomVoiceCommand(command.id, {
                    triggers: command.triggers,
                    action: command.action,
                    params: command.params,
                    enabled: !command.enabled,
                });
                this.log(`${command.enabled ? 'Disabled' : 'Enabled'} custom voice command: ${command.id}`);
                vscode.window.showInformationMessage(`${command.enabled ? 'Disabled' : 'Enabled'} command "${command.triggers[0]}"`);
            } else if (selection.label.includes('Triggers')) {
                const triggersInput = await vscode.window.showInputBox({
                    title: 'Edit Triggers',
                    placeHolder: 'e.g., "save my work", "run tests"',
                    prompt: 'Enter trigger phrases (separate multiple with commas)',
                    value: command.triggers.join(', '),
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) {
                            return 'Please enter at least one trigger phrase';
                        }
                        return null;
                    },
                });

                if (triggersInput !== undefined) {
                    const triggers = triggersInput
                        .split(',')
                        .map(t => t.trim())
                        .filter(t => t.length > 0);
                    await client.updateCustomVoiceCommand(command.id, {
                        triggers,
                        action: command.action,
                        params: command.params,
                        enabled: command.enabled,
                    });
                    this.log(`Updated triggers for command: ${command.id}`);
                    vscode.window.showInformationMessage(`Updated triggers for "${triggers[0]}"`);
                }
            } else if (selection.label.includes('Action')) {
                const newAction = await vscode.window.showInputBox({
                    title: 'Edit Action',
                    placeHolder: 'e.g., workbench.action.files.save',
                    prompt: 'Enter the VS Code command ID',
                    value: command.action,
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) {
                            return 'Please enter a command ID';
                        }
                        return null;
                    },
                });

                if (newAction !== undefined) {
                    await client.updateCustomVoiceCommand(command.id, {
                        triggers: command.triggers,
                        action: newAction.trim(),
                        params: command.params,
                        enabled: command.enabled,
                    });
                    this.log(`Updated action for command: ${command.id}`);
                    vscode.window.showInformationMessage(`Updated action to "${newAction}"`);
                }
            } else if (selection.label.includes('Parameters')) {
                const paramsInput = await vscode.window.showInputBox({
                    title: 'Edit Parameters',
                    placeHolder: '{"to": "up", "by": "line"}',
                    prompt: 'Enter parameters as JSON (empty for no parameters)',
                    value: Object.keys(command.params).length > 0 ? JSON.stringify(command.params) : '',
                });

                if (paramsInput !== undefined) {
                    let params: Record<string, unknown> = {};
                    try {
                        params = paramsInput.trim().length > 0 ? JSON.parse(paramsInput) : {};
                    } catch {
                        vscode.window.showWarningMessage('Invalid JSON, parameters not changed');
                        return;
                    }
                    await client.updateCustomVoiceCommand(command.id, {
                        triggers: command.triggers,
                        action: command.action,
                        params,
                        enabled: command.enabled,
                    });
                    this.log(`Updated parameters for command: ${command.id}`);
                    vscode.window.showInformationMessage(`Updated parameters`);
                }
            }
        } catch (error) {
            this.log(`Error managing command: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to manage command: ${error instanceof Error ? error.message : String(error)}`
            );
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
