"""
Database module for VTThought user personalization (ADR-011).

Provides SQLite database connection management and schema initialization.
"""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

import aiosqlite

from app.config import get_settings

settings = get_settings()

# Database path - use user-writable directory
DATABASE_DIR = Path.home() / ".cache" / "vtthought"
DATABASE_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_PATH = DATABASE_DIR / "vtthought.db"


async def init_db() -> aiosqlite.Connection:
    """
    Initialize database connection and create schema if needed.

    Returns:
        Database connection
    """
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row

    # Enable foreign keys
    await db.execute("PRAGMA foreign_keys = ON")

    # Enable WAL mode for better concurrency
    await db.execute("PRAGMA journal_mode = WAL")

    # Create schema
    await _create_schema(db)

    return db


async def _create_schema(db: aiosqlite.Connection) -> None:
    """Create database schema if tables don't exist."""
    # Users table
    await db.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            github_id TEXT UNIQUE,
            email TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # User preferences (JSON stored as text)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS user_preferences (
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            preferences TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # Custom vocabulary
    await db.execute("""
        CREATE TABLE IF NOT EXISTS user_vocabulary (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            word TEXT NOT NULL,
            pronunciation_hint TEXT,
            category TEXT DEFAULT 'custom',
            boost REAL DEFAULT 1.0,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, word)
        )
    """)

    # Learned corrections
    await db.execute("""
        CREATE TABLE IF NOT EXISTS vocabulary_corrections (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            spoken TEXT NOT NULL,
            corrected TEXT NOT NULL,
            auto_learned INTEGER DEFAULT 0,
            occurrences INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, spoken)
        )
    """)

    # Custom voice commands (triggers stored as JSON array)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS user_voice_commands (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            triggers TEXT NOT NULL,
            action TEXT NOT NULL,
            params TEXT DEFAULT '{}',
            enabled INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # User style preferences (learned from edits)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS user_style_preferences (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category TEXT NOT NULL,
            preference TEXT NOT NULL,
            pattern TEXT,
            replacement TEXT,
            occurrences INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, category, preference, pattern)
        )
    """)

    # Create indexes for performance
    await db.execute("""
        CREATE INDEX IF NOT EXISTS idx_vocabulary_user
        ON user_vocabulary(user_id)
    """)

    await db.execute("""
        CREATE INDEX IF NOT EXISTS idx_corrections_user
        ON vocabulary_corrections(user_id)
    """)

    await db.execute("""
        CREATE INDEX IF NOT EXISTS idx_commands_user
        ON user_voice_commands(user_id)
    """)

    await db.execute("""
        CREATE INDEX IF NOT EXISTS idx_style_prefs_user
        ON user_style_preferences(user_id)
    """)

    await db.commit()


@asynccontextmanager
async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """
    Context manager for database connections.

    Yields:
        Database connection with row factory enabled
    """
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")

    try:
        yield db
    finally:
        await db.close()


async def get_db_connection() -> aiosqlite.Connection:
    """
    Get a database connection (for use with async context managers).

    Returns:
        Database connection
    """
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")
    return db


class UserRepository:
    """
    Repository for user data access with enforced user isolation.

    All database access goes through this class to ensure user_id filtering.
    """

    def __init__(self, db: aiosqlite.Connection, user_id: str):
        """
        Initialize repository with scoped user_id.

        Args:
            db: Database connection
            user_id: User ID for scoping all queries
        """
        self.db = db
        self.user_id = user_id

    async def get_vocabulary(self) -> list[dict]:
        """Get user's custom vocabulary."""
        cursor = await self.db.execute(
            """SELECT word, boost, category, pronunciation_hint
               FROM user_vocabulary
               WHERE user_id = ?
               ORDER BY boost DESC""",
            (self.user_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def add_vocabulary_word(
        self,
        word: str,
        category: str = "custom",
        boost: float = 1.0,
        pronunciation_hint: str | None = None
    ) -> None:
        """Add a word to user's vocabulary."""
        import uuid
        await self.db.execute(
            """INSERT OR REPLACE INTO user_vocabulary
               (id, user_id, word, category, boost, pronunciation_hint)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), self.user_id, word, category, boost, pronunciation_hint)
        )
        await self.db.commit()

    async def delete_vocabulary_word(self, word: str) -> bool:
        """Delete a word from user's vocabulary."""
        cursor = await self.db.execute(
            "DELETE FROM user_vocabulary WHERE user_id = ? AND word = ?",
            (self.user_id, word)
        )
        await self.db.commit()
        return cursor.rowcount > 0

    async def get_corrections(self) -> list[dict]:
        """Get user's learned corrections."""
        cursor = await self.db.execute(
            """SELECT spoken, corrected, auto_learned, occurrences
               FROM vocabulary_corrections
               WHERE user_id = ?
               ORDER BY occurrences DESC""",
            (self.user_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def learn_correction(
        self,
        spoken: str,
        corrected: str,
        auto_learned: bool = True
    ) -> None:
        """Learn a new correction from user feedback."""
        import uuid
        await self.db.execute(
            """INSERT INTO vocabulary_corrections
               (id, user_id, spoken, corrected, auto_learned, occurrences)
               VALUES (?, ?, ?, ?, ?, 1)
               ON CONFLICT(user_id, spoken)
               DO UPDATE SET
                   corrected = excluded.corrected,
                   occurrences = occurrences + 1,
                   auto_learned = excluded.auto_learned""",
            (str(uuid.uuid4()), self.user_id, spoken, corrected, int(auto_learned))
        )
        await self.db.commit()

    async def get_style_preferences(self) -> list[dict]:
        """Get user's learned style preferences."""
        cursor = await self.db.execute(
            """SELECT category, preference, pattern, replacement, occurrences
               FROM user_style_preferences
               WHERE user_id = ?""",
            (self.user_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def record_style_change(
        self,
        category: str,
        preference: str,
        pattern: str | None,
        replacement: str | None
    ) -> None:
        """Record a style change from user edits."""
        import uuid
        await self.db.execute(
            """INSERT INTO user_style_preferences
               (id, user_id, category, preference, pattern, replacement, occurrences)
               VALUES (?, ?, ?, ?, ?, ?, 1)
               ON CONFLICT(user_id, category, preference, pattern)
               DO UPDATE SET
                   replacement = excluded.replacement,
                   occurrences = occurrences + 1,
                   updated_at = datetime('now')""",
            (str(uuid.uuid4()), self.user_id, category, preference, pattern, replacement)
        )
        await self.db.commit()

    async def get_preferences(self) -> dict:
        """Get user preferences as dict."""
        cursor = await self.db.execute(
            "SELECT preferences FROM user_preferences WHERE user_id = ?",
            (self.user_id,)
        )
        row = await cursor.fetchone()
        if row:
            import json
            return json.loads(row["preferences"])
        return {}

    async def update_preferences(self, preferences: dict) -> None:
        """Update user preferences."""
        import json
        await self.db.execute(
            """INSERT INTO user_preferences (user_id, preferences)
               VALUES (?, ?)
               ON CONFLICT(user_id)
               DO UPDATE SET
                   preferences = excluded.preferences,
                   updated_at = datetime('now')""",
            (self.user_id, json.dumps(preferences))
        )
        await self.db.commit()

    async def get_custom_commands(self) -> list[dict]:
        """Get user's custom voice commands."""
        cursor = await self.db.execute(
            """SELECT id, triggers, action, params, enabled
               FROM user_voice_commands
               WHERE user_id = ? AND enabled = 1""",
            (self.user_id,)
        )
        rows = await cursor.fetchall()
        import json
        return [
            {
                "id": row["id"],
                "triggers": json.loads(row["triggers"]),
                "action": row["action"],
                "params": json.loads(row["params"]),
            }
            for row in rows
        ]

    async def add_custom_command(
        self,
        triggers: list[str],
        action: str,
        params: dict | None = None
    ) -> None:
        """Add a custom voice command."""
        import json
        import uuid
        await self.db.execute(
            """INSERT INTO user_voice_commands
               (id, user_id, triggers, action, params)
               VALUES (?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), self.user_id, json.dumps(triggers), action, json.dumps(params or {}))
        )
        await self.db.commit()


async def ensure_default_user() -> str:
    """
    Ensure a default user exists for single-user mode.

    Returns:
        User ID of the default user
    """
    import uuid
    default_user_id = "default"

    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM users WHERE id = ?",
            (default_user_id,)
        )
        row = await cursor.fetchone()

        if not row:
            await db.execute(
                """INSERT INTO users (id, email)
                   VALUES (?, ?)""",
                (default_user_id, "local@localhost")
            )
            await db.commit()
            print(f"Created default user: {default_user_id}")

        return default_user_id


# Initialize database on module import
async def _startup_init():
    """Initialize database on application startup."""
    await init_db()
    await ensure_default_user()
    print(f"Database initialized at: {DATABASE_PATH}")
