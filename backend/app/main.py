"""
VTThought Backend - Main Application

FastAPI application with WebSocket support for audio streaming.
"""
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.config import get_settings

# Initialize settings
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan manager.

    Handles startup and shutdown events.
    Initializes database for user personalization (ADR-011).
    """
    # Startup
    print(f"Starting {settings.app_name} v{settings.app_version}")
    print(f"Environment: {settings.environment}")
    print(f"STT Engine: {settings.stt_engine}")
    print(f"LLM Provider: {settings.llm_provider}")

    # Initialize database and ensure default user (ADR-011)
    from app.database import init_db, ensure_default_user
    try:
        await init_db()
        await ensure_default_user()
        print("Database initialized successfully")
    except Exception as e:
        print(f"Database initialization warning: {e}")
        print("Continuing without database - personalization features unavailable")

    yield

    # Shutdown
    print(f"Shutting down {settings.app_name}")


# Initialize FastAPI application
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Voice-to-code backend with speech-to-text and LLM post-processing",
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(router, prefix="/api")


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint with basic information."""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "status": "running",
        "health_url": "/api/health",
        "websocket_url": "/api/ws/audio"
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
    )
