# ADR-027: VS Code Marketplace Publication

## Status

Proposed

## Context

VTThought is a VS Code extension that needs to be distributed to users. The VS Code Marketplace is the primary distribution channel for VS Code extensions, providing:

- Discoverability through search
- Automatic updates for users
- Trust signals (verified publisher, ratings, reviews)
- Download statistics and analytics

We need to prepare the extension for marketplace publication while also supporting alternative distribution methods for development and private use.

## Decision

### 1. Publisher Identity

Create a verified publisher account on the VS Code Marketplace:

- **Publisher ID**: `jedarden` (matches GitHub username)
- **Publisher Name**: Display name for marketplace listing
- **Verification**: Link to GitHub repository for verification badge

### 2. Required Package.json Fields

The `extension/package.json` must include:

```json
{
  "name": "vtthought",
  "displayName": "VTThought - Voice to Code",
  "description": "Voice-to-code dictation with AI-powered transcription cleanup",
  "version": "0.1.0",
  "publisher": "jedarden",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/jedarden/vtthought"
  },
  "bugs": {
    "url": "https://github.com/jedarden/vtthought/issues"
  },
  "homepage": "https://github.com/jedarden/vtthought#readme",
  "icon": "images/icon.png",
  "galleryBanner": {
    "color": "#1e1e1e",
    "theme": "dark"
  },
  "categories": [
    "Other"
  ],
  "keywords": [
    "voice",
    "dictation",
    "speech-to-text",
    "transcription",
    "accessibility"
  ]
}
```

### 3. Required Assets

| Asset | Path | Specification |
|-------|------|---------------|
| Icon | `images/icon.png` | 128x128 or 256x256 PNG |
| README | `README.md` | Marketplace listing content |
| CHANGELOG | `CHANGELOG.md` | Version history |
| LICENSE | `LICENSE` | MIT license file |

### 4. Publication Workflow

#### Manual Publication (Initial)

```bash
# Login to publisher account
vsce login jedarden

# Package and publish
cd extension
vsce publish
```

#### Automated Publication (CI/CD)

Add to `.github/workflows/release.yml`:

```yaml
publish-extension:
  runs-on: ubuntu-latest
  needs: [build, test]
  if: startsWith(github.ref, 'refs/tags/v')
  steps:
    - uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'

    - name: Install dependencies
      run: cd extension && npm ci

    - name: Publish to Marketplace
      run: cd extension && npx @vscode/vsce publish
      env:
        VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

Required secret: `VSCE_PAT` - Personal Access Token from Azure DevOps.

### 5. Version Strategy

Follow semantic versioning aligned with ADR-024:

| Version | Meaning |
|---------|---------|
| 0.x.x | Pre-release, API may change |
| 1.0.0 | First stable release |
| x.y.0 | New features (minor) |
| x.y.z | Bug fixes (patch) |

Pre-release versions for testing:
- `0.1.0-alpha.1` - Internal testing
- `0.1.0-beta.1` - Public beta
- `0.1.0-rc.1` - Release candidate

### 6. Alternative Distribution

For users who cannot use the marketplace:

#### Direct VSIX Download

```bash
# Package without publishing
vsce package --allow-missing-repository

# Creates: vtthought-0.1.0.vsix
```

Distribute via GitHub Releases (see ADR-025).

#### Installation from VSIX

```bash
# Command line
code --install-extension vtthought-0.1.0.vsix

# Or via VS Code UI:
# Extensions > ... > Install from VSIX
```

### 7. Pre-Publication Checklist

Before each release:

- [ ] Version bumped in `package.json`
- [ ] CHANGELOG.md updated
- [ ] README.md accurate and complete
- [ ] Icon present at `images/icon.png`
- [ ] All tests passing
- [ ] Extension packages without errors: `vsce package`
- [ ] Manual testing in clean VS Code instance
- [ ] Backend compatibility verified

### 8. Marketplace Listing Content

The README.md serves as the marketplace listing. Structure:

```markdown
# VTThought - Voice to Code

![Demo GIF](images/demo.gif)

## Features
- Voice dictation with push-to-talk
- AI-powered transcription cleanup
- Voice commands for common actions
- Works with any editor or terminal

## Requirements
- Backend server (self-hosted or cloud)
- Microphone access

## Quick Start
1. Install extension
2. Configure backend URL
3. Press Ctrl+Alt+V to start dictating

## Configuration
[Settings documentation]

## Privacy
[Data handling policy]
```

### 9. Review Guidelines Compliance

Ensure compliance with VS Code Marketplace policies:

- No telemetry without disclosure
- Clear privacy policy for audio handling
- Accurate capability descriptions
- No misleading claims
- Proper license attribution

## Consequences

### Positive

- **Discoverability**: Users can find VTThought through marketplace search
- **Trust**: Verified publisher badge increases user confidence
- **Updates**: Automatic update delivery to all users
- **Analytics**: Download counts and ratings provide feedback
- **Integration**: One-click install from marketplace

### Negative

- **Review Process**: Initial publication may require review
- **Policy Compliance**: Must maintain compliance with marketplace policies
- **PAT Management**: Need to securely store and rotate access tokens
- **Version Pressure**: Published versions are permanent, requires careful QA

### Neutral

- **Dual Distribution**: Must maintain both marketplace and VSIX workflows
- **Documentation**: README serves dual purpose (GitHub + Marketplace)

## Implementation Steps

1. Create publisher account at https://marketplace.visualstudio.com/manage
2. Generate Personal Access Token in Azure DevOps
3. Create extension icon (128x128 PNG)
4. Update package.json with required fields
5. Add VSCE_PAT secret to GitHub repository
6. Update release workflow to publish to marketplace
7. Test publication with pre-release version
8. Publish stable release

## References

- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)
- [Marketplace Presentation Tips](https://code.visualstudio.com/api/references/extension-manifest#marketplace-presentation-tips)
- [vsce CLI Reference](https://github.com/microsoft/vscode-vsce)
