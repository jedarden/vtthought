# ADR-011: User Personalization

**Status:** Proposed
**Date:** 2026-01-30
**Decision Makers:** TBD

---

## Context

The system must support multiple users with personalized settings including:
- Custom vocabulary (technical terms, project names, personal names)
- Speech preferences (language, cleanup aggressiveness)
- Voice command customization
- Usage history and learning

## Decision Drivers

- **Multi-tenancy**: Strict isolation between users
- **Personalization**: Improved accuracy through custom vocabulary
- **Privacy**: User data protected and deletable
- **Performance**: Personalization shouldn't add latency
- **Sync**: Settings available across devices

## User Data Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER DATA MODEL                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  User                                                                    │
│  ├── id: UUID                                                           │
│  ├── github_id: string                                                  │
│  ├── email: string                                                      │
│  ├── created_at: timestamp                                              │
│  │                                                                       │
│  ├── Preferences                                                        │
│  │   ├── language: string (default: "en")                               │
│  │   ├── whisper_model: string (default: "large-v3")                    │
│  │   ├── enable_llm_cleanup: boolean (default: true)                    │
│  │   ├── cleanup_aggressiveness: enum (minimal, moderate, aggressive)   │
│  │   ├── enable_voice_commands: boolean (default: true)                 │
│  │   └── hotkey_mode: enum (push_to_talk, toggle)                       │
│  │                                                                       │
│  ├── Vocabulary                                                         │
│  │   ├── custom_words: [{word, pronunciation_hint, category}]           │
│  │   ├── corrections: [{spoken, corrected, auto_learned}]               │
│  │   └── blocked_words: [string] (never transcribe these)               │
│  │                                                                       │
│  ├── VoiceCommands                                                      │
│  │   └── custom_commands: [{trigger, action, params}]                   │
│  │                                                                       │
│  └── UsageStats (optional, user consent)                                │
│      ├── total_transcriptions: int                                      │
│      ├── total_audio_minutes: float                                     │
│      └── last_active: timestamp                                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Custom Vocabulary System

### How Vocabulary Improves Accuracy

Whisper supports an "initial prompt" that biases transcription toward specific terms:

```python
# Without custom vocabulary
transcribe("audio.wav")
# Output: "Use the clod SDK to create an API"

# With custom vocabulary
transcribe("audio.wav", initial_prompt="Claude, Anthropic, Claude Code, API")
# Output: "Use the Claude SDK to create an API"
```

### Implementation

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class VocabularyEntry:
    word: str
    pronunciation_hint: Optional[str] = None  # For similar-sounding words
    category: str = "general"  # technical, name, project, etc.
    boost: float = 1.0  # How strongly to bias toward this word

@dataclass
class CorrectionEntry:
    spoken: str           # What Whisper outputs
    corrected: str        # What it should be
    auto_learned: bool    # Was this learned from user correction?
    occurrences: int = 0  # How often this correction was applied

class UserVocabulary:
    def __init__(self, user_id: str, db: Database):
        self.user_id = user_id
        self.db = db
        self._cache: Optional[VocabularyCache] = None

    async def get_whisper_prompt(self) -> str:
        """Generate Whisper initial_prompt from user vocabulary."""
        vocab = await self.get_vocabulary()

        # Prioritize high-boost and frequently-corrected terms
        terms = sorted(vocab.custom_words, key=lambda x: -x.boost)

        # Format as comma-separated list
        prompt_terms = [entry.word for entry in terms[:50]]  # Limit size

        return ", ".join(prompt_terms)

    async def apply_corrections(self, text: str) -> str:
        """Apply user's learned corrections to transcription."""
        corrections = await self.get_corrections()

        for correction in corrections:
            # Case-insensitive replacement
            pattern = re.compile(re.escape(correction.spoken), re.IGNORECASE)
            if pattern.search(text):
                text = pattern.sub(correction.corrected, text)
                await self.increment_correction_count(correction)

        return text

    async def learn_correction(self, original: str, corrected: str):
        """Learn a new correction from user feedback."""
        await self.db.insert("vocabulary_corrections", {
            "user_id": self.user_id,
            "spoken": original,
            "corrected": corrected,
            "auto_learned": True,
            "created_at": datetime.utcnow()
        })
        self._cache = None  # Invalidate cache
```

### Vocabulary Categories

```python
VOCABULARY_CATEGORIES = {
    "technical": {
        "description": "Programming terms, frameworks, tools",
        "examples": ["TypeScript", "Kubernetes", "PostgreSQL", "FastAPI"]
    },
    "project": {
        "description": "Project-specific terms",
        "examples": ["voicecode", "clawdbot", "ardenone-cluster"]
    },
    "names": {
        "description": "People and company names",
        "examples": ["Anthropic", "Claude"]
    },
    "acronyms": {
        "description": "Abbreviations and acronyms",
        "examples": ["API", "SDK", "CLI", "JWT", "OAuth"]
    },
    "custom": {
        "description": "User-defined terms",
        "examples": []
    }
}
```

### Auto-Learning from Corrections

When a user corrects a transcription in the VS Code extension:

```typescript
// VS Code Extension
async function onUserCorrection(original: string, corrected: string) {
    // Send correction to backend
    await fetch(`${backendUrl}/api/vocabulary/learn`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ original, corrected })
    });
}
```

```python
# Backend
@app.post("/api/vocabulary/learn")
async def learn_correction(
    data: CorrectionRequest,
    user: User = Depends(get_current_user)
):
    vocabulary = UserVocabulary(user.id, db)
    await vocabulary.learn_correction(data.original, data.corrected)

    return {"status": "learned", "correction": data.corrected}
```

## Style Learning

Learn user's formatting preferences organically from corrections:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STYLE LEARNING                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  WHAT WE LEARN                                                               │
│  ├─ Punctuation: dashes vs commas, semicolons vs periods                   │
│  ├─ Capitalization: "Javascript" vs "JavaScript" vs "javascript"           │
│  ├─ Number format: "5" vs "five", "1st" vs "first"                         │
│  ├─ List format: bullets vs numbers vs dashes                              │
│  ├─ Spacing: "e.g." vs "eg" vs "e.g.,"                                     │
│  └─ Abbreviations: "don't" vs "do not", "info" vs "information"            │
│                                                                              │
│  HOW WE LEARN                                                                │
│  ├─ Track every user edit after transcription                              │
│  ├─ Extract token-level changes (what changed, in what context)            │
│  ├─ Build preference weights over time                                      │
│  ├─ Apply preferences during LLM cleanup                                   │
│  └─ No manual training - learns organically                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Style Preference Schema

```python
@dataclass
class StylePreference:
    category: str           # "punctuation", "capitalization", "number_format", etc.
    pattern: str            # What we output
    replacement: str        # What user changed it to
    context: Optional[str]  # Surrounding context (if relevant)
    occurrences: int        # How many times user made this change
    confidence: float       # 0.0-1.0, increases with occurrences

class StylePreferences:
    # Punctuation preferences
    prefer_oxford_comma: Optional[bool] = None      # "a, b, and c" vs "a, b and c"
    prefer_em_dash: Optional[bool] = None           # "word—word" vs "word - word"
    sentence_spacing: int = 1                        # Spaces after period

    # Capitalization preferences
    capitalize_after_colon: Optional[bool] = None
    title_case_headings: Optional[bool] = None

    # Number preferences
    spell_out_under: int = 10                        # Spell "nine" but use "10"
    use_ordinals: Optional[bool] = None             # "1st" vs "first"

    # Abbreviation preferences
    expand_contractions: Optional[bool] = None      # "do not" vs "don't"
    abbreviation_map: dict[str, str] = field(default_factory=dict)  # "info" → keep or expand
```

### Style Learning Engine

```python
class StyleLearner:
    """Learn user style preferences from corrections."""

    def __init__(self, user_id: str, db: Database):
        self.user_id = user_id
        self.db = db
        self.min_occurrences = 3  # Need 3+ corrections to learn preference

    async def learn_from_edit(self, original: str, edited: str) -> None:
        """Analyze a user edit and extract style preferences."""
        if original == edited:
            return

        # Extract token-level changes
        changes = self._extract_changes(original, edited)

        for change in changes:
            await self._record_style_change(change)

    def _extract_changes(self, original: str, edited: str) -> list[StyleChange]:
        """Extract what changed at the token level."""
        changes = []

        # Punctuation changes
        changes.extend(self._detect_punctuation_changes(original, edited))

        # Capitalization changes
        changes.extend(self._detect_capitalization_changes(original, edited))

        # Number format changes
        changes.extend(self._detect_number_changes(original, edited))

        # Abbreviation changes
        changes.extend(self._detect_abbreviation_changes(original, edited))

        return changes

    def _detect_punctuation_changes(self, original: str, edited: str) -> list[StyleChange]:
        """Detect punctuation preference changes."""
        changes = []

        # Oxford comma
        oxford_added = re.search(r',\s+and\s+', edited) and not re.search(r',\s+and\s+', original)
        oxford_removed = re.search(r',\s+and\s+', original) and not re.search(r',\s+and\s+', edited)

        if oxford_added:
            changes.append(StyleChange(
                category="punctuation",
                preference="oxford_comma",
                value=True,
                context=self._get_context(edited, ',')
            ))
        elif oxford_removed:
            changes.append(StyleChange(
                category="punctuation",
                preference="oxford_comma",
                value=False,
                context=self._get_context(original, ',')
            ))

        # Em dash vs spaced dash
        if '—' in edited and ' - ' in original:
            changes.append(StyleChange(
                category="punctuation",
                preference="em_dash",
                value=True
            ))
        elif ' - ' in edited and '—' in original:
            changes.append(StyleChange(
                category="punctuation",
                preference="em_dash",
                value=False
            ))

        return changes

    def _detect_capitalization_changes(self, original: str, edited: str) -> list[StyleChange]:
        """Detect capitalization preference changes."""
        changes = []

        # Find words that only differ in capitalization
        orig_words = original.split()
        edit_words = edited.split()

        for orig, edit in zip(orig_words, edit_words):
            if orig.lower() == edit.lower() and orig != edit:
                changes.append(StyleChange(
                    category="capitalization",
                    preference="word_case",
                    pattern=orig,
                    replacement=edit
                ))

        return changes

    def _detect_number_changes(self, original: str, edited: str) -> list[StyleChange]:
        """Detect number format preferences."""
        changes = []

        # Spelled out to digit: "five" → "5"
        number_words = {
            'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
            'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10'
        }

        for word, digit in number_words.items():
            if word in original.lower() and digit in edited:
                changes.append(StyleChange(
                    category="number_format",
                    preference="use_digits",
                    pattern=word,
                    replacement=digit
                ))
            elif digit in original and word in edited.lower():
                changes.append(StyleChange(
                    category="number_format",
                    preference="spell_out",
                    pattern=digit,
                    replacement=word
                ))

        return changes

    async def _record_style_change(self, change: StyleChange) -> None:
        """Record a style change and update preference weights."""
        await self.db.execute("""
            INSERT INTO user_style_preferences (user_id, category, preference, pattern, replacement, occurrences)
            VALUES (?, ?, ?, ?, ?, 1)
            ON CONFLICT(user_id, category, preference, pattern)
            DO UPDATE SET
                occurrences = occurrences + 1,
                replacement = excluded.replacement,
                updated_at = datetime('now')
        """, (self.user_id, change.category, change.preference, change.pattern, change.replacement))

    async def get_style_prompt(self) -> str:
        """Generate LLM prompt additions based on learned preferences."""
        prefs = await self._get_confident_preferences()

        if not prefs:
            return ""

        prompt_parts = ["## User Style Preferences"]

        if prefs.get('oxford_comma'):
            prompt_parts.append("- Use Oxford comma (a, b, and c)")
        elif prefs.get('oxford_comma') is False:
            prompt_parts.append("- No Oxford comma (a, b and c)")

        if prefs.get('em_dash'):
            prompt_parts.append("- Use em dashes (word—word) not spaced dashes")

        if prefs.get('use_digits'):
            prompt_parts.append("- Use digits for numbers (5 not five)")

        # Add capitalization preferences
        cap_prefs = prefs.get('capitalizations', {})
        if cap_prefs:
            prompt_parts.append(f"- Capitalize these terms exactly: {', '.join(cap_prefs.values())}")

        return "\n".join(prompt_parts)

    async def _get_confident_preferences(self) -> dict:
        """Get preferences with enough occurrences to be confident."""
        cursor = await self.db.execute("""
            SELECT category, preference, pattern, replacement, occurrences
            FROM user_style_preferences
            WHERE user_id = ? AND occurrences >= ?
        """, (self.user_id, self.min_occurrences))

        prefs = {}
        async for row in cursor:
            if row['category'] == 'punctuation':
                prefs[row['preference']] = row['replacement'] == 'True'
            elif row['category'] == 'capitalization':
                prefs.setdefault('capitalizations', {})[row['pattern']] = row['replacement']
            elif row['category'] == 'number_format':
                prefs[row['preference']] = True

        return prefs
```

### Integration with LLM Cleanup

```python
async def cleanup_with_style(
    raw_text: str,
    user_id: str,
    llm: LLMProvider,
    db: Database
) -> str:
    """Apply LLM cleanup with user's learned style preferences."""

    # Get vocabulary prompt
    vocab = UserVocabulary(user_id, db)
    vocab_prompt = await vocab.get_whisper_prompt()

    # Get style prompt
    style_learner = StyleLearner(user_id, db)
    style_prompt = await style_learner.get_style_prompt()

    # Build full prompt
    prompt = f"""Clean up this transcription.

## Vocabulary (preserve these terms exactly)
{vocab_prompt}

{style_prompt}

## Transcription
{raw_text}

## Cleaned Output"""

    return await llm.complete(prompt)
```

### Style Learning Database Schema

```sql
-- User style preferences (learned from edits)
CREATE TABLE user_style_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,        -- "punctuation", "capitalization", "number_format"
    preference TEXT NOT NULL,      -- "oxford_comma", "em_dash", "word_case"
    pattern TEXT,                  -- Original pattern (for word-specific prefs)
    replacement TEXT,              -- What user prefers
    occurrences INTEGER DEFAULT 1, -- Times user made this change
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, category, preference, pattern)
);

CREATE INDEX idx_style_prefs_user ON user_style_preferences(user_id);
```

### Extension: Edit Detection

```typescript
class EditDetector {
    private lastInsertedText: string = '';
    private lastInsertedRange: vscode.Range | null = null;
    private editTimeout: NodeJS.Timeout | null = null;

    /**
     * Track what we inserted so we can detect edits.
     */
    onTranscriptionInserted(text: string, range: vscode.Range): void {
        this.lastInsertedText = text;
        this.lastInsertedRange = range;

        // Wait for user to finish editing before learning
        this.resetEditTimeout();
    }

    /**
     * Called when document changes - detect if user edited our transcription.
     */
    onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        if (!this.lastInsertedRange) return;

        for (const change of event.contentChanges) {
            if (this.rangesOverlap(change.range, this.lastInsertedRange)) {
                // User edited our transcription - reset timeout
                this.resetEditTimeout();
            }
        }
    }

    private resetEditTimeout(): void {
        if (this.editTimeout) {
            clearTimeout(this.editTimeout);
        }

        // Wait 2 seconds after last edit to learn
        this.editTimeout = setTimeout(() => {
            this.learnFromEdit();
        }, 2000);
    }

    private async learnFromEdit(): Promise<void> {
        if (!this.lastInsertedRange) return;

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        // Get current text in the range we inserted
        const currentText = editor.document.getText(this.lastInsertedRange);

        if (currentText !== this.lastInsertedText) {
            // User made changes - send to backend to learn
            await fetch(`${backendUrl}/api/style/learn`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    original: this.lastInsertedText,
                    edited: currentText
                })
            });
        }

        // Clear state
        this.lastInsertedText = '';
        this.lastInsertedRange = null;
    }
}
```

### Learning Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ORGANIC STYLE LEARNING                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. User dictates: "I need to buy apples, oranges and bananas"              │
│                                                                              │
│  2. LLM outputs: "I need to buy apples, oranges and bananas."               │
│     (no Oxford comma - LLM's default)                                       │
│                                                                              │
│  3. User edits: "I need to buy apples, oranges, and bananas."               │
│                                              ↑ added comma                   │
│                                                                              │
│  4. Extension detects edit after 2s pause                                   │
│     └─ Sends { original: "...", edited: "..." } to backend                 │
│                                                                              │
│  5. StyleLearner extracts: oxford_comma = True                              │
│     └─ Stores preference, occurrences = 1                                  │
│                                                                              │
│  6. After 3+ similar edits:                                                  │
│     └─ Preference becomes "confident"                                       │
│     └─ Added to LLM prompt: "Use Oxford comma"                             │
│                                                                              │
│  7. Future transcriptions automatically use Oxford comma                    │
│                                                                              │
│  NO MANUAL TRAINING REQUIRED - learns from natural edits                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## User Preferences

### Preferences Schema

```python
from pydantic import BaseModel
from enum import Enum

class CleanupLevel(str, Enum):
    MINIMAL = "minimal"      # Only remove um/uh
    MODERATE = "moderate"    # Remove fillers, fix basic grammar
    AGGRESSIVE = "aggressive"  # Full rewrite for clarity

class HotkeyMode(str, Enum):
    PUSH_TO_TALK = "push_to_talk"  # Hold to record
    TOGGLE = "toggle"              # Press to start/stop

class UserPreferences(BaseModel):
    language: str = "en"
    whisper_model: str = "large-v3"
    enable_llm_cleanup: bool = True
    cleanup_level: CleanupLevel = CleanupLevel.MODERATE
    enable_voice_commands: bool = True
    hotkey_mode: HotkeyMode = HotkeyMode.PUSH_TO_TALK

    # Advanced
    vad_sensitivity: float = 0.5  # Voice activity detection threshold
    silence_duration_ms: int = 1000  # How long silence before stop
    max_recording_seconds: int = 60  # Maximum recording length
```

### Preferences API

```python
@app.get("/api/preferences")
async def get_preferences(user: User = Depends(get_current_user)):
    prefs = await db.get("user_preferences", user.id)
    return prefs or UserPreferences()

@app.put("/api/preferences")
async def update_preferences(
    prefs: UserPreferences,
    user: User = Depends(get_current_user)
):
    await db.upsert("user_preferences", user.id, prefs.dict())
    return {"status": "updated"}
```

### Extension Settings Sync

```typescript
// VS Code Extension - sync preferences on startup
async function syncPreferences() {
    const response = await fetch(`${backendUrl}/api/preferences`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const prefs = await response.json();

    // Update local settings
    await vscode.workspace.getConfiguration('voicecode').update(
        'preferences',
        prefs,
        vscode.ConfigurationTarget.Global
    );
}
```

## Custom Voice Commands

Allow users to define their own voice commands:

```python
@dataclass
class CustomVoiceCommand:
    trigger: List[str]       # Phrases that trigger this command
    action: str              # VS Code command or custom action
    params: Optional[dict]   # Parameters for the action
    enabled: bool = True

# Example custom commands
user_commands = [
    CustomVoiceCommand(
        trigger=["deploy", "ship it"],
        action="workbench.action.tasks.runTask",
        params={"task": "deploy-production"}
    ),
    CustomVoiceCommand(
        trigger=["run tests", "test it"],
        action="workbench.action.tasks.runTask",
        params={"task": "test"}
    ),
    CustomVoiceCommand(
        trigger=["commit this"],
        action="voicecode.gitCommit",
        params={}
    )
]
```

## Data Storage

### Database: SQLite

SQLite is used for simplicity - no separate database container needed.

**Why SQLite:**
- Single file, embedded in API container
- Zero configuration
- Easy backup (copy the file)
- Sufficient for self-hosted use (low write concurrency)
- WAL mode enables concurrent reads during writes

### Schema

```sql
-- Enable WAL mode for better concurrency
PRAGMA journal_mode=WAL;

-- Users table
CREATE TABLE users (
    id TEXT PRIMARY KEY,  -- UUID as text
    github_id TEXT UNIQUE NOT NULL,
    email TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- User preferences (JSON stored as text)
CREATE TABLE user_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferences TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Custom vocabulary
CREATE TABLE user_vocabulary (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    pronunciation_hint TEXT,
    category TEXT DEFAULT 'custom',
    boost REAL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, word)
);

-- Learned corrections
CREATE TABLE vocabulary_corrections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spoken TEXT NOT NULL,
    corrected TEXT NOT NULL,
    auto_learned INTEGER DEFAULT 0,  -- boolean as int
    occurrences INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, spoken)
);

-- Custom voice commands (triggers stored as JSON array)
CREATE TABLE user_voice_commands (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    triggers TEXT NOT NULL,  -- JSON array
    action TEXT NOT NULL,
    params TEXT DEFAULT '{}',  -- JSON object
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- User style preferences (learned from edits)
CREATE TABLE user_style_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,        -- "punctuation", "capitalization", "number_format"
    preference TEXT NOT NULL,      -- "oxford_comma", "em_dash", "word_case"
    pattern TEXT,                  -- Original pattern (for word-specific prefs)
    replacement TEXT,              -- What user prefers
    occurrences INTEGER DEFAULT 1, -- Times user made this change
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, category, preference, pattern)
);

-- Indexes for performance
CREATE INDEX idx_vocabulary_user ON user_vocabulary(user_id);
CREATE INDEX idx_corrections_user ON vocabulary_corrections(user_id);
CREATE INDEX idx_commands_user ON user_voice_commands(user_id);
CREATE INDEX idx_style_prefs_user ON user_style_preferences(user_id);
```

### SQLite in Python (aiosqlite)

```python
import aiosqlite
import uuid
from pathlib import Path

DATABASE_PATH = Path("/data/voicecode.db")

async def get_db():
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")
    return db

async def get_user_vocabulary(user_id: str) -> list[dict]:
    async with await get_db() as db:
        cursor = await db.execute(
            "SELECT word, boost FROM user_vocabulary WHERE user_id = ? ORDER BY boost DESC",
            (user_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

async def add_vocabulary_word(user_id: str, word: str, category: str = "custom"):
    async with await get_db() as db:
        await db.execute(
            """INSERT OR REPLACE INTO user_vocabulary (id, user_id, word, category)
               VALUES (?, ?, ?, ?)""",
            (str(uuid.uuid4()), user_id, word, category)
        )
        await db.commit()
```

### Backup Strategy

```bash
# Simple file copy (with WAL checkpoint first)
sqlite3 /data/voicecode.db "PRAGMA wal_checkpoint(TRUNCATE);"
cp /data/voicecode.db /backup/voicecode-$(date +%Y%m%d).db
```

### Caching Strategy

User vocabulary is cached in-memory for fast access during transcription (no Redis needed):

```python
from cachetools import TTLCache
from threading import Lock
from typing import Optional

class VocabularyCache:
    """In-memory cache with TTL for user vocabulary prompts."""

    def __init__(self, maxsize: int = 500, ttl: int = 3600):
        self._cache = TTLCache(maxsize=maxsize, ttl=ttl)
        self._lock = Lock()

    def get_user_prompt(self, user_id: str) -> Optional[str]:
        with self._lock:
            return self._cache.get(f"vocab:prompt:{user_id}")

    def set_user_prompt(self, user_id: str, prompt: str):
        with self._lock:
            self._cache[f"vocab:prompt:{user_id}"] = prompt

    def invalidate(self, user_id: str):
        with self._lock:
            self._cache.pop(f"vocab:prompt:{user_id}", None)

# Global instance
vocabulary_cache = VocabularyCache()
```

**Why in-memory instead of Redis:**
- Single container deployment
- Vocabulary data is small (~1KB per user)
- Cache miss just means SQLite lookup (~5ms)
- No additional service to manage

## Multi-Tenancy Isolation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    MULTI-TENANCY ISOLATION                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  DATA ISOLATION (Application-Enforced)                                   │
│  ├─ All queries include WHERE user_id = ?                               │
│  ├─ Foreign key constraints enforce ownership                           │
│  ├─ Repository pattern ensures user_id filtering                        │
│  └─ No raw SQL - all access through typed functions                     │
│                                                                          │
│  PROCESSING ISOLATION                                                    │
│  ├─ Each transcription request includes user context                    │
│  ├─ User vocabulary loaded per-request                                  │
│  ├─ LLM prompts include only user's data                                │
│  └─ No shared state between users                                       │
│                                                                          │
│  AUDIT                                                                   │
│  ├─ All data access logged with user_id                                 │
│  └─ User can export/delete all their data                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Application-Level Isolation

Since SQLite doesn't have row-level security, isolation is enforced at the application layer:

```python
class UserRepository:
    """All database access goes through this class, ensuring user isolation."""

    def __init__(self, db: aiosqlite.Connection, user_id: str):
        self.db = db
        self.user_id = user_id  # Always scoped to a user

    async def get_vocabulary(self) -> list[VocabularyEntry]:
        cursor = await self.db.execute(
            "SELECT * FROM user_vocabulary WHERE user_id = ?",
            (self.user_id,)  # Always filtered
        )
        return [VocabularyEntry(**row) for row in await cursor.fetchall()]

    async def get_preferences(self) -> UserPreferences:
        cursor = await self.db.execute(
            "SELECT preferences FROM user_preferences WHERE user_id = ?",
            (self.user_id,)
        )
        row = await cursor.fetchone()
        return UserPreferences.parse_raw(row["preferences"]) if row else UserPreferences()

    # All methods follow the same pattern - always filtered by self.user_id
```

## Data Export and Deletion

GDPR compliance - users can export and delete their data:

```python
@app.get("/api/user/export")
async def export_user_data(user: User = Depends(get_current_user)):
    """Export all user data as JSON."""
    data = {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "created_at": user.created_at.isoformat()
        },
        "preferences": await get_preferences(user),
        "vocabulary": await get_all_vocabulary(user.id),
        "corrections": await get_all_corrections(user.id),
        "voice_commands": await get_all_commands(user.id)
    }
    return data

@app.delete("/api/user")
async def delete_user_data(user: User = Depends(get_current_user)):
    """Delete all user data (right to be forgotten)."""
    # Cascading delete handles related tables
    await db.delete("users", user.id)

    # Clear caches
    await vocabulary_cache.invalidate(user.id)

    # Audit log (kept for compliance, anonymized)
    await audit_log("user_deleted", user_id=user.id)

    return {"status": "deleted"}
```

## Consequences

### Positive
- Personalized transcription accuracy
- User-controlled experience
- GDPR compliant data handling
- Scalable multi-tenant architecture
- Learning improves over time
- **Organic style learning** - no manual training required
- **Token-level adaptation** - punctuation, capitalization, numbers

### Negative
- Additional database complexity
- Per-user vocabulary adds to prompt size
- Cache invalidation complexity
- Style learning requires tracking edits (extension complexity)

### Performance Impact

| Operation | Without Personalization | With Personalization |
|-----------|------------------------|----------------------|
| Whisper prompt | None | +50 tokens (~negligible) |
| Correction lookup | None | +5ms (cached) |
| Preferences load | None | +2ms (cached) |
| Style prompt | None | +20 tokens (~negligible) |
| Edit detection | None | Negligible (async) |

### Learning Thresholds

| Feature | Threshold | Rationale |
|---------|-----------|-----------|
| Word corrections | 1 occurrence | Likely intentional |
| Style preferences | 3 occurrences | Confirm pattern, not accident |
| Capitalization | 2 occurrences | Proper nouns are consistent |

## Related ADRs
- ADR-002: Authentication Strategy
- ADR-006: LLM Post-Processing
- ADR-010: Security Model
