"""
User personalization API endpoints (ADR-011).

Provides endpoints for user preferences, vocabulary, corrections,
and style learning.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.database import UserRepository, get_db, ensure_default_user
from app.models.user import CleanupLevel, HotkeyMode, UserPreferences
from app.services.style import StyleLearner
from app.services.vocabulary import get_user_vocabulary

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


class StylePreferencesListResponse(BaseModel):
    """List of style preferences."""
    style_preferences: list[dict]


class StylePreferenceRequest(BaseModel):
    """Request to create/update a style preference."""
    category: str
    preference: str
    pattern: Optional[str] = None
    replacement: Optional[str] = None
    occurrences: int = 10  # Default to high confidence for manual entries


@router.get("/style/preferences", response_model=StylePreferencesListResponse)
async def get_style_preferences_list(
    user_id: str = Depends(get_user_id)
) -> StylePreferencesListResponse:
    """Get all user style preferences (manual management)."""
    async with await get_db() as db:
        repo = UserRepository(db, user_id)
        style_prefs = await repo.get_style_preferences()

    return StylePreferencesListResponse(style_preferences=style_prefs)


@router.post("/style/preferences")
async def create_style_preference(
    request: StylePreferenceRequest,
    user_id: str = Depends(get_user_id)
) -> dict:
    """Manually create a style preference."""
    async with await get_db() as db:
        repo = UserRepository(db, user_id)
        await repo.record_style_change(
            request.category,
            request.preference,
            request.pattern,
            request.replacement
        )

    # Invalidate cache to ensure new preference is used
    style_learner = StyleLearner(user_id)
    await style_learner.invalidate_cache()

    return {"status": "created", "category": request.category, "preference": request.preference}


@router.delete("/style/preferences")
async def delete_style_preference(
    category: str,
    preference: str,
    pattern: Optional[str] = None,
    user_id: str = Depends(get_user_id)
) -> dict:
    """Delete a style preference."""
    async with await get_db() as db:
        if pattern:
            await db.execute(
                """DELETE FROM user_style_preferences
                   WHERE user_id = ? AND category = ? AND preference = ? AND pattern = ?""",
                (user_id, category, preference, pattern)
            )
        else:
            await db.execute(
                """DELETE FROM user_style_preferences
                   WHERE user_id = ? AND category = ? AND preference = ? AND pattern IS NULL""",
                (user_id, category, preference)
            )
        await db.commit()

    # Invalidate cache after deletion
    style_learner = StyleLearner(user_id)
    await style_learner.invalidate_cache()

    return {"status": "deleted"}


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


# Custom Voice Commands endpoints
class VoiceCommandRequest(BaseModel):
    """Request to create/update a voice command."""
    triggers: list[str]
    action: str
    params: dict | None = None
    enabled: bool = True


class VoiceCommandResponse(BaseModel):
    """Voice command response."""
    id: str
    triggers: list[str]
    action: str
    params: dict
    enabled: bool
    created_at: str


class VoiceCommandListResponse(BaseModel):
    """List of voice commands."""
    commands: list[dict]


@router.get("/commands", response_model=VoiceCommandListResponse)
async def get_voice_commands(
    include_disabled: bool = Query(False, description="Include disabled commands"),
    user_id: str = Depends(get_user_id)
) -> VoiceCommandListResponse:
    """Get user's custom voice commands."""
    async with await get_db() as db:
        repo = UserRepository(db, user_id)
        commands = await repo.get_custom_commands(include_disabled=include_disabled)

    return VoiceCommandListResponse(commands=commands)


@router.get("/commands/{cmd_id}", response_model=VoiceCommandResponse)
async def get_voice_command(
    cmd_id: str,
    user_id: str = Depends(get_user_id)
) -> VoiceCommandResponse:
    """Get a specific custom voice command."""
    async with await get_db() as db:
        repo = UserRepository(db, user_id)
        command = await repo.get_custom_command(cmd_id)

    if not command:
        raise HTTPException(status_code=404, detail=f"Command '{cmd_id}' not found")

    return VoiceCommandResponse(**command)


@router.post("/commands", response_model=VoiceCommandResponse)
async def create_voice_command(
    request: VoiceCommandRequest,
    user_id: str = Depends(get_user_id)
) -> VoiceCommandResponse:
    """Create a new custom voice command."""
    async with await get_db() as db:
        repo = UserRepository(db, user_id)
        cmd_id = await repo.add_custom_command(
            triggers=request.triggers,
            action=request.action,
            params=request.params,
            enabled=request.enabled
        )
        command = await repo.get_custom_command(cmd_id)

    if not command:
        raise HTTPException(status_code=500, detail="Failed to create command")

    return VoiceCommandResponse(**command)


@router.put("/commands/{cmd_id}", response_model=VoiceCommandResponse)
async def update_voice_command(
    cmd_id: str,
    request: VoiceCommandRequest,
    user_id: str = Depends(get_user_id)
) -> VoiceCommandResponse:
    """Update a custom voice command."""
    async with await get_db() as db:
        repo = UserRepository(db, user_id)

        # First verify the command exists
        existing = await repo.get_custom_command(cmd_id)
        if not existing:
            raise HTTPException(status_code=404, detail=f"Command '{cmd_id}' not found")

        # Update the command
        updated = await repo.update_custom_command(
            cmd_id=cmd_id,
            triggers=request.triggers,
            action=request.action,
            params=request.params,
            enabled=request.enabled
        )

        if not updated:
            raise HTTPException(status_code=500, detail="Failed to update command")

        command = await repo.get_custom_command(cmd_id)

    if not command:
        raise HTTPException(status_code=500, detail="Failed to retrieve updated command")

    return VoiceCommandResponse(**command)


@router.delete("/commands/{cmd_id}")
async def delete_voice_command(
    cmd_id: str,
    user_id: str = Depends(get_user_id)
) -> dict:
    """Delete a custom voice command."""
    async with await get_db() as db:
        repo = UserRepository(db, user_id)
        deleted = await repo.delete_custom_command(cmd_id)

    if not deleted:
        raise HTTPException(status_code=404, detail=f"Command '{cmd_id}' not found")

    return {"status": "deleted", "id": cmd_id}
