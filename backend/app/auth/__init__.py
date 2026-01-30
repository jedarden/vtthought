"""
VTThought Authentication Module (ADR-002)

Implements token-based authentication for the VTThought backend.
Supports multiple auth methods: OAuth (GitHub), username/password, and single-user mode.
"""
import hashlib
import json
import logging
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional
from uuid import uuid4

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import get_settings

logger = logging.getLogger(__name__)

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Token settings
TOKEN_PREFIX = "vct_"
TOKEN_BYTES = 32


@dataclass
class User:
    """User data model."""

    id: str
    email: str
    name: Optional[str] = None
    provider: str = "local"  # 'github', 'password', 'local'
    provider_id: Optional[str] = None
    password_hash: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class ExtensionToken:
    """Extension token data model."""

    id: str
    user_id: str
    token_hash: str
    name: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_used_at: Optional[datetime] = None


@dataclass
class Session:
    """Session data model for web UI."""

    id: str
    user_id: str
    expires_at: datetime
    created_at: datetime = field(default_factory=datetime.utcnow)


# In-memory storage (for single-user mode)
# In production, this would be replaced with a database
_users: dict[str, User] = {}
_tokens: dict[str, ExtensionToken] = {}
_sessions: dict[str, Session] = {}


def generate_extension_token() -> str:
    """
    Generate a secure extension token.

    Format: vct_<base62-encoded-32-random-bytes>

    Returns:
        A secure random token prefixed with 'vct_'
    """
    import base64

    random_bytes = secrets.token_bytes(TOKEN_BYTES)
    # Use base64 url-safe encoding for compact representation
    encoded = base64.urlsafe_b64encode(random_bytes).decode('ascii').rstrip('=')
    return f"{TOKEN_PREFIX}{encoded}"


def hash_token(token: str) -> str:
    """
    Hash a token for storage.

    Args:
        token: The plaintext token

    Returns:
        SHA-256 hash of the token
    """
    return hashlib.sha256(token.encode()).hexdigest()


def create_jwt_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT token for web UI sessions.

    Args:
        data: Payload data to encode
        expires_delta: Optional expiration time delta

    Returns:
        Encoded JWT token
    """
    settings = get_settings()
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(
            minutes=settings.jwt_access_token_expire_minutes
        )

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(
        to_encode,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    return encoded_jwt


def decode_jwt_token(token: str) -> Optional[dict]:
    """
    Decode and validate a JWT token.

    Args:
        token: The JWT token to decode

    Returns:
        Decoded payload or None if invalid
    """
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
        return payload
    except JWTError as e:
        logger.debug(f"JWT decode error: {e}")
        return None


def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt.

    Args:
        password: Plain text password

    Returns:
        Hashed password
    """
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a password against a hash.

    Args:
        plain_password: Plain text password
        hashed_password: Hashed password

    Returns:
        True if password matches
    """
    return pwd_context.verify(plain_password, hashed_password)


# User management functions

async def get_or_create_user(
    email: str,
    name: Optional[str] = None,
    provider: str = "local",
    provider_id: Optional[str] = None,
) -> User:
    """
    Get an existing user or create a new one.

    Args:
        email: User email
        name: Optional display name
        provider: Auth provider ('github', 'password', 'local')
        provider_id: Provider-specific user ID

    Returns:
        User object
    """
    # Check if user exists by email
    for user in _users.values():
        if user.email == email:
            return user

    # Create new user
    user = User(
        id=str(uuid4()),
        email=email,
        name=name,
        provider=provider,
        provider_id=provider_id,
    )
    _users[user.id] = user
    logger.info(f"Created new user: {user.id} ({email})")
    return user


async def get_user_by_email(email: str) -> Optional[User]:
    """
    Get a user by email.

    Args:
        email: User email

    Returns:
        User object or None
    """
    for user in _users.values():
        if user.email == email:
            return user
    return None


async def get_user_by_id(user_id: str) -> Optional[User]:
    """
    Get a user by ID.

    Args:
        user_id: User ID

    Returns:
        User object or None
    """
    return _users.get(user_id)


async def get_default_user() -> User:
    """
    Get or create the default user for single-user mode.

    Returns:
        Default user object
    """
    default_email = "user@vtthought.local"
    user = await get_or_create_user(
        email=default_email,
        name="VTThought User",
        provider="local",
    )
    return user


# Token management functions

async def create_extension_token(
    user_id: str,
    name: Optional[str] = None,
) -> tuple[str, ExtensionToken]:
    """
    Create a new extension token for a user.

    Args:
        user_id: User ID
        name: Optional friendly name for the token

    Returns:
        Tuple of (plaintext_token, token_record)
    """
    token_value = generate_extension_token()
    token_hash = hash_token(token_value)

    token = ExtensionToken(
        id=str(uuid4()),
        user_id=user_id,
        token_hash=token_hash,
        name=name,
    )
    _tokens[token.id] = token

    logger.info(f"Created extension token {token.id} for user {user_id}")
    return token_value, token


async def validate_extension_token(token: str) -> Optional[User]:
    """
    Validate an extension token and return the associated user.

    Args:
        token: The extension token to validate

    Returns:
        User object if valid, None otherwise
    """
    if not token.startswith(TOKEN_PREFIX):
        logger.debug(f"Invalid token format: {token[:10]}...")
        return None

    token_hash = hash_token(token)

    # Find token by hash
    token_record = None
    for t in _tokens.values():
        if t.token_hash == token_hash:
            token_record = t
            break

    if not token_record:
        logger.debug("Token not found")
        return None

    # Get user
    user = _users.get(token_record.user_id)
    if not user:
        logger.debug(f"User not found for token: {token_record.user_id}")
        return None

    # Update last used time
    token_record.last_used_at = datetime.utcnow()

    return user


async def get_user_tokens(user_id: str) -> list[ExtensionToken]:
    """
    Get all extension tokens for a user.

    Args:
        user_id: User ID

    Returns:
        List of extension tokens
    """
    return [t for t in _tokens.values() if t.user_id == user_id]


async def revoke_extension_token(token_id: str, user_id: str) -> bool:
    """
    Revoke an extension token.

    Args:
        token_id: Token ID to revoke
        user_id: User ID (for authorization)

    Returns:
        True if token was revoked
    """
    token = _tokens.get(token_id)
    if token and token.user_id == user_id:
        del _tokens[token_id]
        logger.info(f"Revoked token {token_id}")
        return True
    return False


# Session management functions

async def create_session(user_id: str, expires_hours: int = 24) -> Session:
    """
    Create a web UI session.

    Args:
        user_id: User ID
        expires_hours: Session expiration in hours

    Returns:
        Session object
    """
    session = Session(
        id=str(uuid4()),
        user_id=user_id,
        expires_at=datetime.utcnow() + timedelta(hours=expires_hours),
    )
    _sessions[session.id] = session
    return session


async def validate_session(session_id: str) -> Optional[User]:
    """
    Validate a session and return the associated user.

    Args:
        session_id: Session ID

    Returns:
        User object if valid, None otherwise
    """
    session = _sessions.get(session_id)
    if not session:
        return None

    if session.expires_at < datetime.utcnow():
        # Session expired
        del _sessions[session_id]
        return None

    return _users.get(session.user_id)


async def revoke_session(session_id: str) -> bool:
    """
    Revoke a session.

    Args:
        session_id: Session ID

    Returns:
        True if session was revoked
    """
    if session_id in _sessions:
        del _sessions[session_id]
        return True
    return False


# Password auth functions

async def create_password_user(email: str, password: str, name: Optional[str] = None) -> User:
    """
    Create a user with password authentication.

    Args:
        email: User email
        password: Plain text password
        name: Optional display name

    Returns:
        Created user object
    """
    # Check if user exists
    existing = await get_user_by_email(email)
    if existing:
        raise ValueError(f"User with email {email} already exists")

    user = User(
        id=str(uuid4()),
        email=email,
        name=name,
        provider="password",
        password_hash=hash_password(password),
    )
    _users[user.id] = user
    logger.info(f"Created password user: {user.id} ({email})")
    return user


async def validate_password_user(email: str, password: str) -> Optional[User]:
    """
    Validate a user's password credentials.

    Args:
        email: User email
        password: Plain text password

    Returns:
        User object if valid, None otherwise
    """
    user = await get_user_by_email(email)
    if not user or user.provider != "password":
        return None

    if not user.password_hash:
        return None

    if verify_password(password, user.password_hash):
        return user

    return None
