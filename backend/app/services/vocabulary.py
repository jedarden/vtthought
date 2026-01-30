"""
User vocabulary service for personalized STT (ADR-011).

Provides vocabulary management, Whisper prompt generation, and corrections.
"""
import re
from typing import Optional

from cachetools import TTLCache

from app.database import UserRepository, get_db


class VocabularyCache:
    """In-memory cache with TTL for user vocabulary prompts."""

    def __init__(self, maxsize: int = 500, ttl: int = 3600):
        self._cache = TTLCache(maxsize=maxsize, ttl=ttl)
        self._lock = None  # Not using threading lock for async

    def get_user_prompt(self, user_id: str) -> Optional[str]:
        """Get cached vocabulary prompt for user."""
        return self._cache.get(f"vocab:prompt:{user_id}")

    def set_user_prompt(self, user_id: str, prompt: str) -> None:
        """Cache vocabulary prompt for user."""
        self._cache[f"vocab:prompt:{user_id}"] = prompt

    def invalidate(self, user_id: str) -> None:
        """Invalidate cached vocabulary for user."""
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
        # Check cache first
        cached = self._cache.get_user_prompt(self.user_id)
        if cached:
            return cached

        # Get vocabulary from database
        async with await get_db() as db:
            repo = UserRepository(db, self.user_id)
            vocab = await repo.get_vocabulary()

        # Prioritize high-boost terms
        terms = sorted(vocab, key=lambda x: -x.get("boost", 1.0))

        # Format as comma-separated list (limit to 50 terms)
        prompt_terms = [entry["word"] for entry in terms[:50]]

        prompt = ", ".join(prompt_terms) if prompt_terms else ""

        # Cache the prompt
        self._cache.set_user_prompt(self.user_id, prompt)

        return prompt

    async def apply_corrections(self, text: str) -> str:
        """
        Apply user's learned corrections to transcription.

        Args:
            text: Raw transcription text

        Returns:
            Text with corrections applied
        """
        async with await get_db() as db:
            repo = UserRepository(db, self.user_id)
            corrections = await repo.get_corrections()

        for correction in corrections:
            # Case-insensitive replacement
            pattern = re.compile(re.escape(correction["spoken"]), re.IGNORECASE)
            if pattern.search(text):
                text = pattern.sub(correction["corrected"], text)
                # Increment occurrence count
                await self._increment_correction_count(correction["spoken"])

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

        async with await get_db() as db:
            repo = UserRepository(db, self.user_id)
            await repo.learn_correction(original, corrected, auto_learned=True)

        # Invalidate vocabulary cache
        self._cache.invalidate(self.user_id)

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
        async with await get_db() as db:
            repo = UserRepository(db, self.user_id)
            await repo.add_vocabulary_word(word, category, boost, pronunciation_hint)

        # Invalidate vocabulary cache
        self._cache.invalidate(self.user_id)

    async def delete_word(self, word: str) -> bool:
        """
        Delete a custom vocabulary word.

        Args:
            word: The word to delete

        Returns:
            True if word was deleted, False if not found
        """
        async with await get_db() as db:
            repo = UserRepository(db, self.user_id)
            deleted = await repo.delete_vocabulary_word(word)

        if deleted:
            self._cache.invalidate(self.user_id)

        return deleted

    async def get_all_words(self) -> list[dict]:
        """
        Get all user's vocabulary words.

        Returns:
            List of vocabulary entries with metadata
        """
        async with await get_db() as db:
            repo = UserRepository(db, self.user_id)
            return await repo.get_vocabulary()

    async def get_all_corrections(self) -> list[dict]:
        """
        Get all user's learned corrections.

        Returns:
            List of correction entries
        """
        async with await get_db() as db:
            repo = UserRepository(db, self.user_id)
            return await repo.get_corrections()

    async def _increment_correction_count(self, spoken: str) -> None:
        """Increment the occurrence count for a correction."""
        async with await get_db() as db:
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
