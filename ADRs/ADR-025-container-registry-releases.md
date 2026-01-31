# ADR-025: Container Registry and Release Process

**Status:** Accepted
**Date:** 2026-01-31
**Decision Makers:** TBD

---

## Context

VTThought needs a public container registry for distributing the backend Docker image. Users should be able to pull pre-built images instead of building from source. This requires:
1. Public container hosting
2. Versioned releases with semantic versioning
3. Automated builds via CI/CD
4. Changelog documentation

## Decision Drivers

- **Accessibility**: Easy for users to pull and run
- **Transparency**: Public images with verified provenance
- **Automation**: Builds triggered by git tags
- **Traceability**: Clear version history and changelogs
- **Cost**: Free for public repositories

## Decision

**Use GitHub Container Registry (ghcr.io) with automated releases via GitHub Actions.**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      RELEASE PIPELINE                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Developer                                                                   │
│      │                                                                       │
│      ▼                                                                       │
│  ┌─────────────────┐                                                        │
│  │ git tag v1.2.3  │                                                        │
│  │ git push --tags │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    GitHub Actions                                    │    │
│  │                                                                      │    │
│  │  1. Validate version tag format (vX.Y.Z)                            │    │
│  │  2. Extract changelog from CHANGELOG.md                             │    │
│  │  3. Build Docker image (GPU + CPU variants)                         │    │
│  │  4. Run integration tests                                           │    │
│  │  5. Push to ghcr.io with tags:                                      │    │
│  │     - ghcr.io/jedarden/vtthought:1.2.3                             │    │
│  │     - ghcr.io/jedarden/vtthought:1.2                               │    │
│  │     - ghcr.io/jedarden/vtthought:1                                 │    │
│  │     - ghcr.io/jedarden/vtthought:latest                            │    │
│  │  6. Create GitHub Release with changelog                            │    │
│  │  7. Build and publish VS Code extension (.vsix)                     │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    ghcr.io/jedarden/vtthought                       │    │
│  │                                                                      │    │
│  │  Tags:                                                               │    │
│  │  ├── latest        (most recent stable)                             │    │
│  │  ├── 1.2.3         (exact version)                                  │    │
│  │  ├── 1.2.3-gpu     (GPU variant)                                    │    │
│  │  ├── 1.2.3-cpu     (CPU-only variant)                               │    │
│  │  ├── 1.2           (latest 1.2.x)                                   │    │
│  │  ├── 1             (latest 1.x.x)                                   │    │
│  │  └── sha-abc1234   (commit SHA for traceability)                    │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Container Registry: ghcr.io

### Why GitHub Container Registry?

| Registry | Pros | Cons |
|----------|------|------|
| **ghcr.io** | Free for public, integrated with GitHub, no rate limits for authenticated | Newer, less known |
| Docker Hub | Well-known, wide adoption | Rate limits, paid for private |
| Quay.io | Red Hat backed | Less GitHub integration |
| ECR Public | AWS integration | Requires AWS account |

**Decision: ghcr.io** - Free, integrated with GitHub Actions, no rate limits.

### Image Naming Convention

```
ghcr.io/jedarden/vtthought:<tag>

Tags:
  latest          - Most recent stable release
  X.Y.Z           - Exact semantic version (e.g., 1.2.3)
  X.Y.Z-gpu       - GPU variant with CUDA support
  X.Y.Z-cpu       - CPU-only variant (smaller image)
  X.Y             - Latest patch for minor version (e.g., 1.2)
  X               - Latest minor for major version (e.g., 1)
  sha-<commit>    - Specific commit (for debugging)
  edge            - Latest from main branch (unstable)
```

### Pulling Images

```bash
# Latest stable
docker pull ghcr.io/jedarden/vtthought:latest

# Specific version (GPU)
docker pull ghcr.io/jedarden/vtthought:1.2.3-gpu

# CPU-only variant
docker pull ghcr.io/jedarden/vtthought:1.2.3-cpu

# Pin to minor version (gets patch updates)
docker pull ghcr.io/jedarden/vtthought:1.2
```

## Version Tagging Strategy

### Semantic Versioning (SemVer)

```
MAJOR.MINOR.PATCH

MAJOR: Breaking changes (API incompatibility)
MINOR: New features (backward compatible)
PATCH: Bug fixes (backward compatible)

Examples:
  1.0.0 - Initial release
  1.1.0 - Added voice command customization
  1.1.1 - Fixed WebSocket reconnection bug
  2.0.0 - Breaking: Changed API endpoint structure
```

### Pre-release Versions

```
1.2.0-alpha.1   - Early testing
1.2.0-beta.1    - Feature complete, testing
1.2.0-rc.1      - Release candidate
1.2.0           - Stable release
```

### Git Tag Format

```bash
# Create release tag
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3

# Pre-release
git tag -a v1.2.0-beta.1 -m "Beta release v1.2.0-beta.1"
git push origin v1.2.0-beta.1
```

## Changelog Management

### CHANGELOG.md Format

Following [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
# Changelog

All notable changes to VTThought will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- New feature in progress

## [1.2.3] - 2026-01-31

### Fixed
- WebSocket reconnection now properly resets circuit breaker state
- Audio capture no longer drops frames during high CPU load

### Changed
- Improved error messages for authentication failures

## [1.2.2] - 2026-01-28

### Fixed
- Voice command "go to line" now accepts numbers up to 99999

## [1.2.1] - 2026-01-25

### Security
- Updated faster-whisper to 1.0.1 (CVE-2026-XXXX)

## [1.2.0] - 2026-01-20

### Added
- Custom voice command support (ADR-008)
- Style preference learning from user edits (ADR-011)
- Vocabulary management UI in extension

### Changed
- Improved STT accuracy for technical terms
- Reduced memory usage by 15% through connection pooling

### Deprecated
- `cleanup_level` setting values "low"/"high" (use "minimal"/"aggressive")

## [1.1.0] - 2026-01-10

### Added
- Google OAuth authentication (ADR-002)
- User vocabulary customization (ADR-011)

### Fixed
- Terminal insertion now preserves cursor position

## [1.0.0] - 2026-01-01

### Added
- Initial release
- VS Code extension with push-to-talk
- Backend with faster-whisper STT
- Ollama LLM integration
- 38 built-in voice commands
- WebSocket streaming
- Docker container with GPU support

[Unreleased]: https://github.com/jedarden/vtthought/compare/v1.2.3...HEAD
[1.2.3]: https://github.com/jedarden/vtthought/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/jedarden/vtthought/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/jedarden/vtthought/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/jedarden/vtthought/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/jedarden/vtthought/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/jedarden/vtthought/releases/tag/v1.0.0
```

### Changelog Categories

- **Added** - New features
- **Changed** - Changes in existing functionality
- **Deprecated** - Features to be removed in future
- **Removed** - Removed features
- **Fixed** - Bug fixes
- **Security** - Security vulnerability fixes

## GitHub Actions Workflow

### .github/workflows/release.yml

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  validate:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
      is_prerelease: ${{ steps.version.outputs.is_prerelease }}
    steps:
      - uses: actions/checkout@v4

      - name: Validate tag format
        id: version
        run: |
          TAG=${GITHUB_REF#refs/tags/v}
          echo "version=$TAG" >> $GITHUB_OUTPUT

          # Check if pre-release
          if [[ "$TAG" =~ (alpha|beta|rc) ]]; then
            echo "is_prerelease=true" >> $GITHUB_OUTPUT
          else
            echo "is_prerelease=false" >> $GITHUB_OUTPUT
          fi

      - name: Validate CHANGELOG.md
        run: |
          VERSION=${{ steps.version.outputs.version }}
          if ! grep -q "## \[$VERSION\]" CHANGELOG.md; then
            echo "Error: CHANGELOG.md missing entry for version $VERSION"
            exit 1
          fi

  build-backend:
    needs: validate
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    strategy:
      matrix:
        variant: [gpu, cpu]
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}},suffix=-${{ matrix.variant }}
            type=semver,pattern={{major}}.{{minor}},suffix=-${{ matrix.variant }}
            type=semver,pattern={{major}},suffix=-${{ matrix.variant }}
            type=raw,value=latest,suffix=-${{ matrix.variant }},enable=${{ matrix.variant == 'gpu' && needs.validate.outputs.is_prerelease == 'false' }}
            type=raw,value=latest,enable=${{ matrix.variant == 'gpu' && needs.validate.outputs.is_prerelease == 'false' }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: ./backend
          file: ./backend/Dockerfile${{ matrix.variant == 'cpu' && '.cpu' || '' }}
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            VERSION=${{ needs.validate.outputs.version }}
            COMMIT_SHA=${{ github.sha }}

  build-extension:
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: extension/package-lock.json

      - name: Install dependencies
        working-directory: extension
        run: npm ci

      - name: Update version
        working-directory: extension
        run: npm version ${{ needs.validate.outputs.version }} --no-git-tag-version

      - name: Build extension
        working-directory: extension
        run: npm run compile

      - name: Package extension
        working-directory: extension
        run: npx @vscode/vsce package

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: vtthought-extension
          path: extension/*.vsix

  test:
    needs: [build-backend]
    runs-on: ubuntu-latest
    services:
      backend:
        image: ghcr.io/${{ github.repository }}:${{ needs.validate.outputs.version }}-cpu
        ports:
          - 8000:8000
        env:
          ENVIRONMENT: test
          SINGLE_USER_MODE: true
    steps:
      - uses: actions/checkout@v4

      - name: Run integration tests
        run: |
          cd backend
          pip install pytest pytest-asyncio httpx websockets
          pytest test_integration.py -v

  release:
    needs: [validate, build-backend, build-extension, test]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - name: Extract changelog
        id: changelog
        run: |
          VERSION=${{ needs.validate.outputs.version }}
          # Extract section for this version from CHANGELOG.md
          awk "/## \[$VERSION\]/,/## \[/" CHANGELOG.md | head -n -1 > release_notes.md

      - name: Download extension artifact
        uses: actions/download-artifact@v4
        with:
          name: vtthought-extension
          path: ./artifacts

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          name: VTThought v${{ needs.validate.outputs.version }}
          body_path: release_notes.md
          prerelease: ${{ needs.validate.outputs.is_prerelease }}
          files: |
            ./artifacts/*.vsix
          generate_release_notes: false

      - name: Update latest tag
        if: needs.validate.outputs.is_prerelease == 'false'
        run: |
          git config user.name github-actions
          git config user.email github-actions@github.com
          git tag -fa latest -m "Latest stable release"
          git push origin latest --force
```

### .github/workflows/edge.yml

Build edge images on every push to main:

```yaml
name: Edge Build

on:
  push:
    branches: [main]
    paths:
      - 'backend/**'
      - 'extension/**'

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-edge:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push edge
        uses: docker/build-push-action@v5
        with:
          context: ./backend
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:edge
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:sha-${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

## Release Checklist

### Before Tagging

1. [ ] All tests passing on main
2. [ ] CHANGELOG.md updated with new version section
3. [ ] Version numbers updated in:
   - [ ] `backend/app/__init__.py` (`__version__`)
   - [ ] `extension/package.json` (`version`)
4. [ ] Documentation updated if needed
5. [ ] Breaking changes documented in CHANGELOG.md

### Tagging

```bash
# Ensure on main and up to date
git checkout main
git pull origin main

# Create annotated tag
git tag -a v1.2.3 -m "Release v1.2.3

Highlights:
- New voice command customization
- Improved STT accuracy for technical terms
- Fixed WebSocket reconnection issues

See CHANGELOG.md for full details."

# Push tag to trigger release workflow
git push origin v1.2.3
```

### After Release

1. [ ] Verify GitHub Release created with correct notes
2. [ ] Verify Docker images pushed to ghcr.io
3. [ ] Verify extension .vsix attached to release
4. [ ] Test pulling new image: `docker pull ghcr.io/jedarden/vtthought:1.2.3`
5. [ ] Update documentation links if needed
6. [ ] Announce release (if applicable)

## User Upgrade Path

### Docker Users

```bash
# Pull latest
docker pull ghcr.io/jedarden/vtthought:latest

# Or specific version
docker pull ghcr.io/jedarden/vtthought:1.2.3-gpu

# Stop old container
docker stop vtthought && docker rm vtthought

# Run new version
docker run -d \
    --name vtthought \
    --gpus all \
    -e CLOUDFLARE_TUNNEL_TOKEN=$TOKEN \
    -v vtthought-data:/data \
    ghcr.io/jedarden/vtthought:1.2.3-gpu
```

### docker-compose Users

```yaml
# docker-compose.yml
services:
  backend:
    image: ghcr.io/jedarden/vtthought:1.2.3-gpu
    # ... rest of config
```

```bash
docker-compose pull
docker-compose up -d
```

## Consequences

### Positive
- **Easy distribution**: Users pull pre-built images
- **Version pinning**: Users can pin to specific versions
- **Automated releases**: Tags trigger full CI/CD pipeline
- **Transparent history**: Changelog documents all changes
- **Multiple variants**: GPU and CPU images available
- **Free hosting**: ghcr.io free for public repos

### Negative
- **Build time**: Large images take time to build
- **Storage costs**: Multiple variants increase storage
- **Requires GitHub account**: For authenticated pulls (rate limits otherwise)

### Tradeoffs
- Edge builds vs stability (edge for testing, tagged for production)
- Image size vs features (CPU variant smaller but slower)

## Related ADRs

- ADR-009: Docker Container Architecture
- ADR-024: Versioning & Compatibility
- ADR-019: Observability (for build metrics)
