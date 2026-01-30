# VTThought Backend Dockerfile
# Multi-stage build with CUDA support for faster-whisper GPU acceleration

# Stage 1: Base image with CUDA support
FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04 AS base

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 \
    python3-pip \
    python3-venv \
    ffmpeg \
    libsamplerate0 \
    libportaudio2 \
    libportaudiocpp0 \
    ffmpeg libavcodec-extra \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Stage 2: Build stage
FROM base AS builder

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip3 install --no-cache-dir --upgrade pip setuptools wheel && \
    pip3 install --no-cache-dir -r requirements.txt

# Stage 3: Runtime stage
FROM base AS runtime

# Copy virtual environment from builder
COPY --from=builder /usr/local/lib/python3.10/dist-packages /usr/local/lib/python3.10/dist-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PATH="/usr/local/bin:${PATH}"

# Install cloudflared for Cloudflare Tunnel (ADR-009)
RUN curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && \
    dpkg -i cloudflared.deb && \
    rm cloudflared.deb

# Create non-root user
RUN useradd -m -u 1000 vtthought && \
    chown -R vtthought:vtthought /app

# Switch to non-root user
USER vtthought

# Copy application code
COPY --chown=vtthought:vtthought app /app/app

# Expose port
EXPOSE 8000

# Health check (ADR-019)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
