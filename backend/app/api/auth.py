"""
VTThought Authentication API Endpoints (ADR-002)

Implements authentication and token management endpoints.
Supports multiple auth methods: OAuth (Google), username/password, and single-user mode.
"""
import logging
from dataclasses import dataclass, field
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator

from app.auth import (
    create_extension_token,
    create_password_user,
    create_session,
    create_jwt_token,
    get_default_user,
    get_user_tokens,
    revoke_extension_token,
    validate_extension_token,
    validate_password_user,
    User,
)
from app.config import get_settings

logger = logging.getLogger(__name__)

# Initialize router
auth_router = APIRouter()

# Security scheme for Bearer tokens
security = HTTPBearer()

# Single-user mode flag
_settings = get_settings()
SINGLE_USER_MODE = _settings.environment == "development" and not _settings.google_client_id


# Pydantic models for requests/responses


@dataclass
class TokenResponse:
    """Response for token creation."""

    token: str
    token_id: str
    created_at: str


@dataclass
class TokenListResponse:
    """Response for listing tokens."""

    tokens: list[dict] = field(default_factory=list)


@dataclass
class MessageResponse:
    """Generic message response."""

    message: str


class RegisterRequest(BaseModel):
    """Request for user registration."""

    email: str
    password: str
    name: Optional[str] = None

    @field_validator('email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        """Basic email validation."""
        if '@' not in v:
            raise ValueError('Invalid email address')
        return v


class LoginRequest(BaseModel):
    """Request for user login."""

    email: str
    password: str

    @field_validator('email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        """Basic email validation."""
        if '@' not in v:
            raise ValueError('Invalid email address')
        return v


class CreateTokenRequest(BaseModel):
    """Request for creating an extension token."""

    name: Optional[str] = None


# Dependency to get current user from token


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> User:
    """
    Get the current authenticated user from Bearer token.

    Args:
        credentials: HTTP Authorization credentials

    Returns:
        Current user

    Raises:
        HTTPException: If token is invalid
    """
    token = credentials.credentials

    if SINGLE_USER_MODE:
        # In single-user mode, return default user without validation
        return await get_default_user()

    user = await validate_extension_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return user


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
) -> Optional[User]:
    """
    Get the current user if authenticated, None otherwise.

    Args:
        credentials: Optional HTTP Authorization credentials

    Returns:
        Current user or None
    """
    if not credentials:
        return None

    token = credentials.credentials
    return await validate_extension_token(token)


# Endpoint: Get current user info


@auth_router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)) -> dict:
    """
    Get information about the current authenticated user.

    Args:
        current_user: Authenticated user

    Returns:
        User information
    """
    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name,
        "provider": current_user.provider,
        "created_at": current_user.created_at.isoformat(),
    }


# Endpoint: Register new user (password auth)


@auth_router.post("/register")
async def register(request: RegisterRequest) -> MessageResponse:
    """
    Register a new user with email and password.

    Args:
        request: Registration request

    Returns:
        Success message

    Raises:
        HTTPException: If user already exists
    """
    if SINGLE_USER_MODE:
        raise HTTPException(
            status_code=400,
            detail="User registration not available in single-user mode"
        )

    try:
        await create_password_user(
            email=request.email,
            password=request.password,
            name=request.name,
        )
        return MessageResponse(message="Registration successful")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Endpoint: Login (password auth)


@auth_router.post("/login")
async def login(request: LoginRequest) -> dict:
    """
    Login with email and password.

    Returns a JWT token for web UI sessions.

    Args:
        request: Login request

    Returns:
        JWT access token

    Raises:
        HTTPException: If credentials are invalid
    """
    if SINGLE_USER_MODE:
        raise HTTPException(
            status_code=400,
            detail="Password login not available in single-user mode"
        )

    user = await validate_password_user(request.email, request.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Create session
    session = await create_session(user.id)

    # Create JWT token
    access_token = create_jwt_token(data={"sub": user.id, "session_id": session.id})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
        }
    }


# Endpoint: Create extension token


@auth_router.post("/tokens", response_model=TokenResponse)
async def create_token(
    request: CreateTokenRequest,
    current_user: User = Depends(get_current_user),
) -> TokenResponse:
    """
    Create a new extension token for the current user.

    The token is returned only once and must be copied immediately.

    Args:
        request: Token creation request
        current_user: Authenticated user

    Returns:
        Created token information
    """
    token_value, token_record = await create_extension_token(
        user_id=current_user.id,
        name=request.name,
    )

    return TokenResponse(
        token=token_value,
        token_id=token_record.id,
        created_at=token_record.created_at.isoformat(),
    )


# Endpoint: List extension tokens


@auth_router.get("/tokens", response_model=TokenListResponse)
async def list_tokens(
    current_user: User = Depends(get_current_user),
) -> TokenListResponse:
    """
    List all extension tokens for the current user.

    Args:
        current_user: Authenticated user

    Returns:
        List of tokens (without actual token values)
    """
    tokens = await get_user_tokens(current_user.id)

    token_list = [
        {
            "id": t.id,
            "name": t.name,
            "created_at": t.created_at.isoformat(),
            "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
        }
        for t in tokens
    ]

    return TokenListResponse(tokens=token_list)


# Endpoint: Revoke extension token


@auth_router.delete("/tokens/{token_id}", response_model=MessageResponse)
async def revoke_token(
    token_id: str,
    current_user: User = Depends(get_current_user),
) -> MessageResponse:
    """
    Revoke an extension token.

    Args:
        token_id: Token ID to revoke
        current_user: Authenticated user

    Returns:
        Success message

    Raises:
        HTTPException: If token not found
    """
    success = await revoke_extension_token(token_id, current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Token not found")

    return MessageResponse(message="Token revoked successfully")


# Endpoint: Single-user mode info


@auth_router.get("/mode")
async def get_auth_mode() -> dict:
    """
    Get the current authentication mode.

    Returns:
        Authentication mode information
    """
    settings = get_settings()

    return {
        "mode": "single_user" if SINGLE_USER_MODE else "multi_user",
        "single_user_mode": SINGLE_USER_MODE,
        "oauth_configured": bool(settings.google_client_id),
    }
