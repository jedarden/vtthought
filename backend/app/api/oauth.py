"""
VTThought OAuth API Endpoints (ADR-002)

Implements Google OAuth 2.0 authentication endpoints for web UI.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from app.config import get_settings
from app.oauth import (
    get_oauth_provider,
    handle_google_oauth_callback,
    is_oauth_configured,
)

logger = logging.getLogger(__name__)

# Initialize router
oauth_router = APIRouter()

settings = get_settings()


# Pydantic models


class OAuthConfigResponse(BaseModel):
    """Response for OAuth configuration status."""

    configured: bool
    provider: Optional[str] = None
    authorization_url: Optional[str] = None


class OAuthCallbackResponse(BaseModel):
    """Response for OAuth callback."""

    access_token: str
    token_type: str
    user: dict


# Endpoints


@oauth_router.get("/google", response_class=RedirectResponse, status_code=302)
async def google_login(request: Request) -> RedirectResponse:
    """
    Initiate Google OAuth login flow.

    Redirects user to Google consent screen.

    Query Parameters:
        redirect_uri: Optional callback URL (defaults to /api/auth/google/callback)
        state: Optional state parameter for CSRF protection

    Returns:
        Redirect to Google authorization URL

    Raises:
        HTTPException: If Google OAuth is not configured
    """
    provider = get_oauth_provider(base_url=_get_base_url(request))

    if not provider:
        raise HTTPException(
            status_code=501,
            detail="Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables."
        )

    # Get state from query params for CSRF protection
    state = request.query_params.get("state")

    try:
        auth_url = provider.get_authorization_url(state=state)
        logger.info(f"Redirecting to Google OAuth: {auth_url[:50]}...")
        return RedirectResponse(url=auth_url, status_code=302)

    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@oauth_router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str = Query(..., description="Authorization code from Google"),
    state: Optional[str] = Query(None, description="State parameter for CSRF protection"),
) -> Response:
    """
    Handle Google OAuth callback.

    This endpoint receives the authorization code from Google,
    exchanges it for an access token, fetches user info,
    and creates a session.

    Query Parameters:
        code: Authorization code from Google
        state: Optional state parameter for CSRF protection

    Returns:
        Redirect to frontend with JWT token in URL hash
        OR JSON response for API clients
    """
    try:
        # Complete OAuth flow
        user, jwt_token = await handle_google_oauth_callback(
            code=code,
            state=state,
            redirect_uri=f"{_get_base_url(request)}/api/auth/google/callback",
        )

        # Check if request expects HTML redirect (web UI) or JSON (extension)
        accept_header = request.headers.get("accept", "")

        if "text/html" in accept_header:
            # Web UI flow: redirect with token in URL hash
            # The frontend should be configured to handle this
            frontend_url = f"{_get_frontend_url(request)}/#/auth/callback?token={jwt_token}"
            logger.info(f"Redirecting to frontend after successful OAuth: {user.email}")
            return RedirectResponse(url=frontend_url, status_code=302)

        else:
            # API flow: return JSON response
            logger.info(f"Returning JSON response for successful OAuth: {user.email}")
            return OAuthCallbackResponse(
                access_token=jwt_token,
                token_type="bearer",
                user={
                    "id": user.id,
                    "email": user.email,
                    "name": user.name,
                    "provider": user.provider,
                }
            )

    except ValueError as e:
        logger.error(f"OAuth callback error: {e}")
        raise HTTPException(status_code=400, detail=str(e)) from e

    except Exception as e:
        logger.exception("Unexpected error in OAuth callback")
        raise HTTPException(status_code=500, detail="Authentication failed") from e


@oauth_router.get("/config", response_model=OAuthConfigResponse)
async def get_oauth_config() -> OAuthConfigResponse:
    """
    Get OAuth configuration status.

    Returns information about which OAuth providers are configured.
    Can be used by the frontend to show/hide OAuth login buttons.

    Returns:
        OAuth configuration status
    """
    google_configured = is_oauth_configured()

    return OAuthConfigResponse(
        configured=google_configured,
        provider="google" if google_configured else None,
    )


# Helper functions


def _get_base_url(request: Request) -> str:
    """
    Get the base URL for the application from the request.

    Args:
        request: FastAPI request object

    Returns:
        Base URL (scheme://host:port)
    """
    # In production, this might come from X-Forwarded-* headers
    scheme = request.url.scheme
    host = request.headers.get("host", "localhost:8000")
    return f"{scheme}://{host}"


def _get_frontend_url(request: Request) -> str:
    """
    Get the frontend URL for redirect after OAuth.

    Defaults to localhost:3000 in development.
    In production, this should be configured via environment variable.

    Args:
        request: FastAPI request object

    Returns:
        Frontend URL
    """
    # Try to get from environment variable first
    import os
    frontend_url = os.environ.get("FRONTEND_URL")

    if frontend_url:
        return frontend_url.rstrip("/")

    # Default to localhost:3000 for development
    scheme = request.url.scheme
    host = request.headers.get("host", "localhost:8000")

    # Replace backend port with frontend port
    if "localhost" in host:
        return f"{scheme}://localhost:3000"

    # In production, use the same host but assume frontend is at root
    return f"{scheme}://{host.split(':')[0]}"
