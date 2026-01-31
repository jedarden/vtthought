"""
VTThought OAuth Module (ADR-002)

Implements Google OAuth 2.0 authentication for web UI login.
"""
import logging
from dataclasses import dataclass
from typing import Optional

from authlib.integrations.httpx_client import AsyncOAuth2Client
from authlib.oauth2.rfc6749.errors import OAuth2Error

from app.auth import get_or_create_user, create_session, create_jwt_token, User
from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()


@dataclass
class OAuthUserInfo:
    """User info from OAuth provider."""

    email: str
    name: Optional[str] = None
    provider_id: Optional[str] = None
    provider: str = "google"


class GoogleOAuthProvider:
    """
    Google OAuth 2.0 provider implementation.

    Handles the OAuth flow for Google authentication:
    1. Redirect user to Google consent screen
    2. Handle callback with authorization code
    3. Exchange code for access token
    4. Fetch user info from Google API
    5. Create or get user in our system
    6. Create session and JWT token
    """

    # Google OAuth endpoints
    AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    ACCESS_TOKEN_URL = "https://oauth2.googleapis.com/token"
    USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
    SCOPE = "openid email profile"

    def __init__(self, redirect_uri: str):
        """
        Initialize Google OAuth provider.

        Args:
            redirect_uri: Callback URL after Google consent
        """
        self.redirect_uri = redirect_uri
        self.client_id = settings.google_client_id
        self.client_secret = settings.google_client_secret

    def is_configured(self) -> bool:
        """
        Check if Google OAuth is properly configured.

        Returns:
            True if client ID and secret are set
        """
        return bool(self.client_id and self.client_secret)

    def get_authorization_url(self, state: Optional[str] = None) -> str:
        """
        Generate the Google OAuth authorization URL.

        Args:
            state: Optional state parameter for CSRF protection

        Returns:
            Full authorization URL to redirect user to
        """
        if not self.is_configured():
            raise ValueError("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.")

        client = AsyncOAuth2Client(
            client_id=self.client_id,
            redirect_uri=self.redirect_uri,
            scope=self.SCOPE,
        )

        url, state = client.create_authorization_url(
            self.AUTHORIZATION_URL,
            state=state,
        )

        logger.info(f"Generated Google OAuth authorization URL with state: {state}")
        return url

    async def exchange_code_for_token(self, code: str, state: Optional[str] = None) -> dict:
        """
        Exchange authorization code for access token.

        Args:
            code: Authorization code from Google callback
            state: State parameter from callback

        Returns:
            Token response containing access_token, refresh_token, etc.
        """
        if not self.is_configured():
            raise ValueError("Google OAuth is not configured")

        client = AsyncOAuth2Client(
            client_id=self.client_id,
            client_secret=self.client_secret,
            redirect_uri=self.redirect_uri,
            scope=self.SCOPE,
        )

        try:
            token = await client.fetch_token(
                self.ACCESS_TOKEN_URL,
                code=code,
                state=state,
            )
            logger.info("Successfully exchanged authorization code for access token")
            return token

        except OAuth2Error as e:
            logger.error(f"OAuth error exchanging code for token: {e}")
            raise ValueError(f"Failed to exchange authorization code: {e}") from e

    async def get_user_info(self, access_token: str) -> OAuthUserInfo:
        """
        Fetch user information from Google API.

        Args:
            access_token: OAuth access token

        Returns:
            User information from Google
        """
        async with AsyncOAuth2Client(token=access_token) as client:
            try:
                response = await client.get(self.USERINFO_URL)
                response.raise_for_status()
                user_data = response.json()

                logger.info(f"Fetched user info for: {user_data.get('email')}")

                return OAuthUserInfo(
                    email=user_data.get("email", ""),
                    name=user_data.get("name"),
                    provider_id=user_data.get("id"),
                    provider="google",
                )

            except Exception as e:
                logger.error(f"Error fetching user info from Google: {e}")
                raise ValueError("Failed to fetch user information from Google") from e


async def handle_google_oauth_callback(
    code: str,
    state: Optional[str] = None,
    redirect_uri: Optional[str] = None,
) -> tuple[User, str]:
    """
    Handle the complete Google OAuth callback flow.

    This function:
    1. Exchanges the authorization code for an access token
    2. Fetches user info from Google
    3. Creates or gets the user in our system
    4. Creates a session
    5. Returns a JWT token for the web UI

    Args:
        code: Authorization code from Google callback
        state: State parameter from callback
        redirect_uri: Callback URL used in authorization

    Returns:
        Tuple of (User, jwt_token)

    Raises:
        ValueError: If OAuth is not configured or flow fails
    """
    if not redirect_uri:
        # Use default redirect URI based on settings
        # This should match what was used in the authorization URL
        redirect_uri = "http://localhost:8000/api/auth/google/callback"

    provider = GoogleOAuthProvider(redirect_uri=redirect_uri)

    # Exchange code for token
    token_data = await provider.exchange_code_for_token(code, state)
    access_token = token_data.get("access_token")

    if not access_token:
        raise ValueError("No access token in OAuth response")

    # Fetch user info
    user_info = await provider.get_user_info(access_token)

    # Create or get user
    user = await get_or_create_user(
        email=user_info.email,
        name=user_info.name,
        provider=user_info.provider,
        provider_id=user_info.provider_id,
    )

    # Create session and JWT
    session = await create_session(user.id)
    jwt_token = create_jwt_token(data={"sub": user.id, "session_id": session.id})

    logger.info(f"Completed Google OAuth flow for user: {user.email}")
    return user, jwt_token


def get_oauth_provider(base_url: str = "http://localhost:8000") -> Optional[GoogleOAuthProvider]:
    """
    Get the configured OAuth provider.

    Args:
        base_url: Base URL for the application (used for redirect URI)

    Returns:
        GoogleOAuthProvider instance or None if not configured
    """
    provider = GoogleOAuthProvider(
        redirect_uri=f"{base_url}/api/auth/google/callback"
    )

    if not provider.is_configured():
        return None

    return provider


def is_oauth_configured() -> bool:
    """
    Check if any OAuth provider is configured.

    Returns:
        True if Google OAuth client credentials are set
    """
    settings = get_settings()
    return bool(settings.google_client_id and settings.google_client_secret)
