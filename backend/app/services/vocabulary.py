"""
User vocabulary service for personalized STT (ADR-011).

Provides vocabulary management, Whisper prompt generation, and corrections.
"""
import asyncio
import re
from typing import Optional

from cachetools import TTLCache

from app.database import UserRepository, get_db


class VocabularyCache:
    """
    In-memory cache with TTL for user vocabulary prompts.

    Performance: Uses asyncio.Lock for async-safe cache access.
    Configuration values loaded from settings.
    """

    _cache: TTLCache[str, str]
    _lock: asyncio.Lock

    def __init__(self, maxsize: int | None = None, ttl: int | None = None):
        from app.config import get_settings

        settings = get_settings()
        # Use config values if not specified
        if maxsize is None:
            maxsize = settings.vocab_cache_max_size
        if ttl is None:
            ttl = settings.vocab_cache_ttl_seconds

        self._cache = TTLCache(maxsize=maxsize, ttl=ttl)
        self._lock = asyncio.Lock()  # Async-safe lock for cache access

    async def get_user_prompt(self, user_id: str) -> Optional[str]:
        """Get cached vocabulary prompt for user."""
        async with self._lock:
            return self._cache.get(f"vocab:prompt:{user_id}")

    async def set_user_prompt(self, user_id: str, prompt: str) -> None:
        """Cache vocabulary prompt for user."""
        async with self._lock:
            self._cache[f"vocab:prompt:{user_id}"] = prompt

    async def invalidate(self, user_id: str) -> None:
        """Invalidate cached vocabulary for user."""
        async with self._lock:
            self._cache.pop(f"vocab:prompt:{user_id}", None)


# Global cache instance
vocabulary_cache = VocabularyCache()


class UserVocabulary:
    """
    Manage user's custom vocabulary and corrections.

    Integrates with Whisper's initial_prompt feature to bias transcription
    toward specific terms.
    """

    def __init__(self, user_id: str):
        """
        Initialize vocabulary service for user.

        Args:
            user_id: User ID for scoping all operations
        """
        self.user_id = user_id
        self._cache = vocabulary_cache

    async def get_whisper_prompt(self) -> str:
        """
        Generate Whisper initial_prompt from user vocabulary.

        Returns:
            Comma-separated list of vocabulary terms for Whisper biasing
        """
        # Check cache first (async-safe)
        cached = await self._cache.get_user_prompt(self.user_id)
        if cached:
            return cached

        # Get vocabulary from database
        async with get_db() as db:
            repo = UserRepository(db, self.user_id)
            vocab = await repo.get_vocabulary()

        # Prioritize high-boost terms
        terms = sorted(vocab, key=lambda x: -x.get("boost", 1.0))

        # Format as comma-separated list (use config for max terms)
        from app.config import get_settings
        settings = get_settings()
        prompt_terms = [entry["word"] for entry in terms[:settings.vocab_whisper_max_terms]]

        prompt = ", ".join(prompt_terms) if prompt_terms else ""

        # Cache the prompt (async-safe)
        await self._cache.set_user_prompt(self.user_id, prompt)

        return prompt

    async def apply_corrections(self, text: str) -> str:
        """
        Apply user's learned corrections to transcription.

        Performance: Uses batch update for all matched corrections to avoid N+1 queries.

        Args:
            text: Raw transcription text

        Returns:
            Text with corrections applied
        """
        async with get_db() as db:
            repo = UserRepository(db, self.user_id)
            corrections = await repo.get_corrections()

        # Track which corrections were applied for batch update
        matched_corrections = []

        for correction in corrections:
            # Case-insensitive replacement
            pattern = re.compile(re.escape(correction["spoken"]), re.IGNORECASE)
            if pattern.search(text):
                text = pattern.sub(correction["corrected"], text)
                matched_corrections.append(correction["spoken"])

        # Performance: Batch update all matched corrections in one DB transaction
        if matched_corrections:
            await self._batch_increment_correction_counts(matched_corrections)

        return text

    async def learn_correction(
        self,
        original: str,
        corrected: str
    ) -> None:
        """
        Learn a new correction from user feedback.

        Args:
            original: What the system output
            corrected: What the user changed it to
        """
        if original == corrected:
            return

        async with get_db() as db:
            repo = UserRepository(db, self.user_id)
            await repo.learn_correction(original, corrected, auto_learned=True)

        # Invalidate vocabulary cache (async-safe)
        await self._cache.invalidate(self.user_id)

    async def add_word(
        self,
        word: str,
        category: str = "custom",
        boost: float = 1.0,
        pronunciation_hint: Optional[str] = None
    ) -> None:
        """
        Add a custom vocabulary word.

        Args:
            word: The word or phrase to add
            category: Vocabulary category (technical, project, names, etc.)
            boost: How strongly to bias toward this word (higher = more bias)
            pronunciation_hint: Optional hint for similar-sounding words
        """
        async with get_db() as db:
            repo = UserRepository(db, self.user_id)
            await repo.add_vocabulary_word(word, category, boost, pronunciation_hint)

        # Invalidate vocabulary cache (async-safe)
        await self._cache.invalidate(self.user_id)

    async def delete_word(self, word: str) -> bool:
        """
        Delete a custom vocabulary word.

        Args:
            word: The word to delete

        Returns:
            True if word was deleted, False if not found
        """
        async with get_db() as db:
            repo = UserRepository(db, self.user_id)
            deleted = await repo.delete_vocabulary_word(word)

        if deleted:
            await self._cache.invalidate(self.user_id)

        return deleted

    async def get_all_words(self) -> list[dict]:
        """
        Get all user's vocabulary words.

        Returns:
            List of vocabulary entries with metadata
        """
        async with get_db() as db:
            repo = UserRepository(db, self.user_id)
            return await repo.get_vocabulary()

    async def get_all_corrections(self) -> list[dict]:
        """
        Get all user's learned corrections.

        Returns:
            List of correction entries
        """
        async with get_db() as db:
            repo = UserRepository(db, self.user_id)
            return await repo.get_corrections()

    async def _batch_increment_correction_counts(self, spoken_list: list[str]) -> None:
        """
        Batch increment occurrence counts for multiple corrections.

        Performance: Updates all matched corrections in a single transaction
        to avoid N+1 query problem during transcription.

        Args:
            spoken_list: List of spoken terms that were matched/applied
        """
        async with get_db() as db:
            for spoken in spoken_list:
                await db.execute(
                    """UPDATE vocabulary_corrections
                       SET occurrences = occurrences + 1
                       WHERE user_id = ? AND spoken = ?""",
                    (self.user_id, spoken)
                )
            await db.commit()

    async def _increment_correction_count(self, spoken: str) -> None:
        """
        Increment the occurrence count for a single correction.

        Note: For transcription hot path, use _batch_increment_correction_counts instead.
        """
        async with get_db() as db:
            await db.execute(
                """UPDATE vocabulary_corrections
                   SET occurrences = occurrences + 1
                   WHERE user_id = ? AND spoken = ?""",
                (self.user_id, spoken)
            )
            await db.commit()


async def get_user_vocabulary(user_id: str) -> UserVocabulary:
    """
    Factory function to get UserVocabulary instance.

    Args:
        user_id: User ID

    Returns:
        UserVocabulary instance for the user
    """
    return UserVocabulary(user_id)
