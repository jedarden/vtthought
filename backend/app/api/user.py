"""
User personalization API endpoints (ADR-011).

Provides endpoints for user preferences, vocabulary, corrections,
and style learning.
"""
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.auth import validate_extension_token, get_default_user
from app.database import UserRepository, get_db, ensure_default_user
from app.models.user import CleanupLevel, HotkeyMode, UserPreferences
from app.services.style import StyleLearner
from app.services.vocabulary import UserVocabulary, get_user_vocabulary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/user", tags=["user"])


# Request/Response Models
class PreferencesResponse(BaseModel):
    """User preferences response."""
    preferences: dict


class UpdatePreferencesRequest(BaseModel):
    """Request to update user preferences."""
    language: Optional[str] = None
    whisper_model: Optional[str] = None
    enable_llm_cleanup: Optional[bool] = None
    cleanup_level: Optional[str] = None
    enable_voice_commands: Optional[bool] = None
    hotkey_mode: Optional[str] = None
    vad_sensitivity: Optional[float] = None
    silence_duration_ms: Optional[int] = None
    max_recording_seconds: Optional[int] = None


class VocabularyWordRequest(BaseModel):
    """Request to add a vocabulary word."""
    word: str
    category: str = "custom"
    boost: float = 1.0
    pronunciation_hint: Optional[str] = None


class VocabularyListResponse(BaseModel):
    """List of vocabulary words."""
    vocabulary: list[dict]


class CorrectionLearnRequest(BaseModel):
    """Request to learn a correction from user edit."""
    original: str
    corrected: str


class CorrectionsListResponse(BaseModel):
    """List of learned corrections."""
    corrections: list[dict]


class StyleLearnRequest(BaseModel):
    """Request to learn style from user edit."""
    original: str
    edited: str


class ExportDataResponse(BaseModel):
    """User data export response."""
    user: dict
    preferences: dict
    vocabulary: list[dict]
    corrections: list[dict]
    style_preferences: list[dict]
    voice_commands: list[dict]


# Dependencies
async def get_user_id() -> str:
    """
    Get user ID for current request.

    In single-user mode, returns "default".
    With proper auth, returns actual user ID from token.
    """
    # For now, use single-user mode
    await ensure_default_user()
    return "default"


# Preferences endpoints
@router.get("/preferences", response_model=PreferencesResponse)
async def get_preferences(
    user_id: str = Depends(get_user_id)
) -> PreferencesResponse:
    """Get user preferences."""
    async with await get_db() as db:
        repo = UserRepository(db, user_id)
        prefs = await repo.get_preferences()

    return PreferencesResponse(preferences=prefs or UserPreferences().to_dict())


@router.put("/preferences")
async def update_preferences(
    request: UpdatePreferencesRequest,
    user_id: str = Depends(get_user_id)
) -> dict:
    """Update user preferences."""
    async with await get_db() as db:
        repo = UserRepository(db, user_id)

        # Get current preferences
        current_prefs = await repo.get_preferences()
        if not current_prefs:
            current = UserPreferences()
        else:
            current = UserPreferences.from_dict(current_prefs)

        # Update with provided values
        if request.language is not None:
            current.language = request.language
        if request.whisper_model is not None:
            current.whisper_model = request.whisper_model
        if request.enable_llm_cleanup is not None:
            current.enable_llm_cleanup = request.enable_llm_cleanup
        if request.cleanup_level is not None:
            current.cleanup_level = CleanupLevel(request.cleanup_level)
        if request.enable_voice_commands is not None:
            current.enable_voice_commands = request.enable_voice_commands
        if request.hotkey_mode is not None:
            current.hotkey_mode = HotkeyMode(request.hotkey_mode)
        if request.vad_sensitivity is not None:
            current.vad_sensitivity = request.vad_sensitivity
        if request.silence_duration_ms is not None:
            current.silence_duration_ms = request.silence_duration_ms
        if request.max_recording_seconds is not None:
            current.max_recording_seconds = request.max_recording_seconds

        # Save
        await repo.update_preferences(current.to_dict())

    return {"status": "updated", "preferences": current.to_dict()}


# Vocabulary endpoints
@router.get("/vocabulary", response_model=VocabularyListResponse)
async def get_vocabulary(
    user_id: str = Depends(get_user_id)
) -> VocabularyListResponse:
    """Get user's custom vocabulary."""
    vocab_service = await get_user_vocabulary(user_id)
    words = await vocab_service.get_all_words()

    return VocabularyListResponse(vocabulary=words)


@router.post("/vocabulary")
async def add_vocabulary_word(
    request: VocabularyWordRequest,
    user_id: str = Depends(get_user_id)
) -> dict:
    """Add a word to user's vocabulary."""
    vocab_service = await get_user_vocabulary(user_id)
    await vocab_service.add_word(
        word=request.word,
        category=request.category,
        boost=request.boost,
        pronunciation_hint=request.pronunciation_hint,
    )

    return {"status": "added", "word": request.word}


@router.delete("/vocabulary/{word}")
async def delete_vocabulary_word(
    word: str,
    user_id: str = Depends(get_user_id)
) -> dict:
    """Delete a word from user's vocabulary."""
    vocab_service = await get_user_vocabulary(user_id)
    deleted = await vocab_service.delete_word(word)

    if not deleted:
        raise HTTPException(status_code=404, detail=f"Word '{word}' not found")

    return {"status": "deleted", "word": word}


# Corrections endpoints
@router.get("/corrections", response_model=CorrectionsListResponse)
async def get_corrections(
    user_id: str = Depends(get_user_id)
) -> CorrectionsListResponse:
    """Get user's learned corrections."""
    vocab_service = await get_user_vocabulary(user_id)
    corrections = await vocab_service.get_all_corrections()

    return CorrectionsListResponse(corrections=corrections)


@router.post("/corrections/learn")
async def learn_correction(
    request: CorrectionLearnRequest,
    user_id: str = Depends(get_user_id)
) -> dict:
    """Learn a new correction from user feedback."""
    vocab_service = await get_user_vocabulary(user_id)
    await vocab_service.learn_correction(
        original=request.original,
        corrected=request.corrected,
    )

    return {"status": "learned", "correction": f"{request.original} → {request.corrected}"}


# Style learning endpoints
@router.post("/style/learn")
async def learn_style(
    request: StyleLearnRequest,
    user_id: str = Depends(get_user_id)
) -> dict:
    """Learn style preference from user edit."""
    style_learner = StyleLearner(user_id)
    await style_learner.learn_from_edit(request.original, request.edited)

    return {"status": "learned"}


@router.get("/style/prompt")
async def get_style_prompt(
    user_id: str = Depends(get_user_id)
) -> dict:
    """Get current style prompt for LLM."""
    style_learner = StyleLearner(user_id)
    prompt = await style_learner.get_style_prompt()

    return {"style_prompt": prompt}


# Data export and deletion (GDPR)
@router.get("/export", response_model=ExportDataResponse)
async def export_user_data(
    user_id: str = Depends(get_user_id)
) -> ExportDataResponse:
    """Export all user data as JSON."""
    async with await get_db() as db:
        repo = UserRepository(db, user_id)

        # Get user info
        cursor = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user_row = await cursor.fetchone()
        user_info = dict(user_row) if user_row else {}

        # Get all data
        prefs = await repo.get_preferences()
        vocabulary = await repo.get_vocabulary()
        corrections = await repo.get_corrections()
        style_prefs = await repo.get_style_preferences()
        commands = await repo.get_custom_commands()

    return ExportDataResponse(
        user=user_info,
        preferences=prefs,
        vocabulary=vocabulary,
        corrections=corrections,
        style_preferences=style_prefs,
        voice_commands=commands,
    )


@router.delete("/data")
async def delete_user_data(
    user_id: str = Depends(get_user_id)
) -> dict:
    """Delete all user data (right to be forgotten)."""
    async with await get_db() as db:
        # Cascade delete handles all related tables
        await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        await db.commit()

    logger.info(f"Deleted all data for user: {user_id}")

    return {"status": "deleted", "user_id": user_id}


# Batch operations
@router.post("/vocabulary/batch")
async def batch_add_vocabulary(
    words: list[VocabularyWordRequest],
    user_id: str = Depends(get_user_id)
) -> dict:
    """Add multiple vocabulary words at once."""
    vocab_service = await get_user_vocabulary(user_id)

    for request in words:
        await vocab_service.add_word(
            word=request.word,
            category=request.category,
            boost=request.boost,
            pronunciation_hint=request.pronunciation_hint,
        )

    return {"status": "added", "count": len(words)}


@router.post("/corrections/batch")
async def batch_learn_corrections(
    corrections: list[CorrectionLearnRequest],
    user_id: str = Depends(get_user_id)
) -> dict:
    """Learn multiple corrections at once."""
    vocab_service = await get_user_vocabulary(user_id)

    for request in corrections:
        await vocab_service.learn_correction(
            original=request.original,
            corrected=request.corrected,
        )

    return {"status": "learned", "count": len(corrections)}
