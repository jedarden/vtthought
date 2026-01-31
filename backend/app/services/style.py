"""
Style learning engine for user personalization (ADR-011).

Learns user formatting preferences from corrections and applies them to LLM cleanup.
"""
import asyncio
import re
from dataclasses import dataclass
from typing import Optional

from app.database import UserRepository, get_db


@dataclass
class StyleChange:
    """A detected change in user's editing style."""
    category: str           # "punctuation", "capitalization", "number_format", etc.
    preference: str         # "oxford_comma", "em_dash", "word_case", etc.
    value: Optional[bool]   # For boolean preferences
    pattern: Optional[str]  # Original pattern (for word-specific prefs)
    replacement: Optional[str]  # What user prefers
    context: Optional[str]  # Surrounding context


# Global cache lock for async-safe cache invalidation
_style_cache_lock = asyncio.Lock()
_cached_style_prompts: dict[str, str] = {}


class StyleLearner:
    """
    Learn user style preferences from corrections.

    Analyzes user edits to extract preferences for:
    - Punctuation (oxford comma, em dash, etc.)
    - Capitalization (JavaScript vs javascript)
    - Number format (5 vs five)
    - Abbreviations (don't vs do not)

    Performance: Style preferences are cached per user to avoid repeated DB queries.
    Configuration values loaded from settings.
    """

    def __init__(self, user_id: str, min_occurrences: int = None):
        """
        Initialize style learner for user.

        Args:
            user_id: User ID for scoping all operations
            min_occurrences: Minimum occurrences before considering preference confident (from config if not specified)
        """
        from app.config import get_settings

        settings = get_settings()
        self.user_id = user_id
        # Use config value if not specified
        self.min_occurrences = min_occurrences if min_occurrences is not None else settings.style_learning_min_occurrences

    async def learn_from_edit(self, original: str, edited: str) -> None:
        """
        Analyze a user edit and extract style preferences.

        Args:
            original: What the system output
            edited: What the user changed it to
        """
        if original == edited:
            return

        # Extract token-level changes
        changes = self._extract_changes(original, edited)

        # Record each change
        if changes:
            async with await get_db() as db:
                repo = UserRepository(db, self.user_id)
                for change in changes:
                    await repo.record_style_change(
                        change.category,
                        change.preference,
                        change.pattern,
                        change.replacement
                    )

            # Invalidate cache when learning new preferences
            await self.invalidate_cache()

    def _extract_changes(self, original: str, edited: str) -> list[StyleChange]:
        """
        Extract what changed at the token level.

        Args:
            original: Original text
            edited: Edited text

        Returns:
            List of detected style changes
        """
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

        # Oxford comma: "a, b and c" -> "a, b, and c"
        oxford_added = re.search(r',\s+and\s+', edited) and not re.search(r',\s+and\s+', original)
        oxford_removed = re.search(r',\s+and\s+', original) and not re.search(r',\s+and\s+', edited)

        if oxford_added:
            changes.append(StyleChange(
                category="punctuation",
                preference="oxford_comma",
                value=True,
                pattern=None,
                replacement="True",
                context=self._get_context(edited, ',')
            ))
        elif oxford_removed:
            changes.append(StyleChange(
                category="punctuation",
                preference="oxford_comma",
                value=False,
                pattern=None,
                replacement="False",
                context=self._get_context(original, ',')
            ))

        # Em dash vs spaced dash: "word—word" vs "word - word"
        if '—' in edited and ' - ' in original:
            changes.append(StyleChange(
                category="punctuation",
                preference="em_dash",
                value=True,
                pattern=None,
                replacement="True",
                context=None
            ))
        elif ' - ' in edited and '—' in original:
            changes.append(StyleChange(
                category="punctuation",
                preference="em_dash",
                value=False,
                pattern=None,
                replacement="False",
                context=None
            ))

        return changes

    def _detect_capitalization_changes(
        self,
        original: str,
        edited: str
    ) -> list[StyleChange]:
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
                    value=None,
                    pattern=orig,
                    replacement=edit,
                    context=None
                ))

        return changes

    def _detect_number_changes(self, original: str, edited: str) -> list[StyleChange]:
        """Detect number format preferences."""
        changes = []

        # Spelled out to digit: "five" -> "5"
        number_words = {
            'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
            'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
            'ten': '10'
        }

        for word, digit in number_words.items():
            if word in original.lower() and digit in edited:
                changes.append(StyleChange(
                    category="number_format",
                    preference="use_digits",
                    value=None,
                    pattern=word,
                    replacement=digit,
                    context=None
                ))
            elif digit in original and word in edited.lower():
                changes.append(StyleChange(
                    category="number_format",
                    preference="spell_out",
                    value=None,
                    pattern=digit,
                    replacement=word,
                    context=None
                ))

        return changes

    def _detect_abbreviation_changes(
        self,
        original: str,
        edited: str
    ) -> list[StyleChange]:
        """Detect abbreviation preference changes."""
        changes = []

        # Common contractions
        contractions = {
            "don't": "do not",
            "can't": "cannot",
            "won't": "will not",
            "it's": "it is",
            "that's": "that is",
            "I'm": "I am",
            "you're": "you are",
        }

        for contracted, expanded in contractions.items():
            if contracted in original and expanded in edited:
                changes.append(StyleChange(
                    category="abbreviation",
                    preference="expand_contractions",
                    value=None,
                    pattern=contracted,
                    replacement=expanded,
                    context=None
                ))
            elif expanded in original and contracted in edited:
                changes.append(StyleChange(
                    category="abbreviation",
                    preference="use_contractions",
                    value=None,
                    pattern=expanded,
                    replacement=contracted,
                    context=None
                ))

        return changes

    def _get_context(self, text: str, char: str, window: int = 20) -> str:
        """Get context around a character."""
        idx = text.find(char)
        if idx == -1:
            return ""
        start = max(0, idx - window)
        end = min(len(text), idx + window + 1)
        return text[start:end]

    async def get_style_prompt(self) -> str:
        """
        Generate LLM prompt additions based on learned preferences.

        Performance: Returns cached prompt if available to avoid repeated DB queries.

        Returns:
            String with user's style preferences formatted for LLM prompt
        """
        # Check cache first
        async with _style_cache_lock:
            if self.user_id in _cached_style_prompts:
                return _cached_style_prompts[self.user_id]

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
            words = ', '.join(cap_prefs.values())
            prompt_parts.append(f"- Capitalize these terms exactly: {words}")

        # Add abbreviation preferences
        if prefs.get('expand_contractions'):
            prompt_parts.append("- Expand contractions (do not, don't)")
        elif prefs.get('use_contractions'):
            prompt_parts.append("- Use contractions (don't, do not)")

        prompt = "\n".join(prompt_parts)

        # Cache the prompt
        async with _style_cache_lock:
            _cached_style_prompts[self.user_id] = prompt

        return prompt

    async def invalidate_cache(self) -> None:
        """
        Invalidate cached style prompt for this user.

        Call this after learning new preferences to ensure fresh prompts.
        """
        async with _style_cache_lock:
            _cached_style_prompts.pop(self.user_id, None)

    async def _get_confident_preferences(self) -> dict:
        """
        Get preferences with enough occurrences to be confident.

        Returns:
            Dictionary of confident preferences
        """
        async with await get_db() as db:
            repo = UserRepository(db, self.user_id)
            style_prefs = await repo.get_style_preferences()

        prefs = {}

        for pref in style_prefs:
            if pref["occurrences"] < self.min_occurrences:
                continue

            category = pref["category"]

            if category == "punctuation":
                if pref["preference"] == "oxford_comma":
                    prefs["oxford_comma"] = pref["replacement"] == "True"
                elif pref["preference"] == "em_dash":
                    prefs["em_dash"] = pref["replacement"] == "True"

            elif category == "capitalization":
                if "capitalizations" not in prefs:
                    prefs["capitalizations"] = {}
                prefs["capitalizations"][pref["pattern"]] = pref["replacement"]

            elif category == "number_format":
                prefs[pref["preference"]] = True

            elif category == "abbreviation":
                prefs[pref["preference"]] = True

        return prefs


async def get_style_learner(user_id: str) -> StyleLearner:
    """
    Factory function to get StyleLearner instance.

    Args:
        user_id: User ID

    Returns:
        StyleLearner instance for the user
    """
    return StyleLearner(user_id)
