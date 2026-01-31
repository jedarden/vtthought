# Feedback Collection and User Testing

This guide describes the tools and workflows for collecting and analyzing user feedback for VTThought.

## Overview

VTThought provides three layers of feedback collection:

1. **GitHub Issues & Discussions** - Public feedback channels for beta testers
2. **Automated Feedback Summaries** - Scripts to aggregate and analyze feedback
3. **User Testing Sessions** - Structured testing with session tracking

---

## Tools

### 1. Feedback Summary Script

`scripts/feedback-summary.sh` generates a summary of user feedback from GitHub.

**Usage:**

```bash
# Output to terminal (markdown format)
./scripts/feedback-summary.sh

# Save to file
./scripts/feedback-summary.sh --output FEEDBACK_SUMMARY.md

# Export as JSON for further processing
./scripts/feedback-summary.sh --format json --output feedback-data.json
```

**What it reports:**

- Community engagement metrics (stars, watchers, issues)
- Issues by category (bugs, features, performance, accuracy, usability)
- Issue resolution rate
- Recent open issues
- Top requested features

**Requirements:**

- `gh` CLI installed and authenticated
- `jq` for JSON processing

### 2. User Testing Session Manager

`scripts/user-test-session.sh` manages structured user testing sessions.

**Usage:**

```bash
# Start a new testing session
./scripts/user-test-session.sh --start

# Check session status
./scripts/user-test-session.sh --status

# End session and generate report
./scripts/user-test-session.sh --finish

# View all testing reports
./scripts/user-test-session.sh --report
```

**Session workflow:**

1. Run `--start` to begin (captures environment info)
2. Perform tests (use BETA_TESTING.md checklist)
3. Run `--finish` to end and generate report
4. Reports saved to `.user-testing/report-*.md`

### 3. Smoke Tests

`scripts/smoke-test.sh` validates backend functionality.

**Usage:**

```bash
# Test against local backend (starts one if needed)
./scripts/smoke-test.sh

# Test against specific URL
./scripts/smoke-test.sh https://your-backend.example.com
```

**Tests performed:**

1. Health endpoint
2. Version endpoint
3. Auth mode endpoint
4. WebSocket connection
5. WebSocket recording flow
6. User preferences endpoint

---

## Feedback Collection Workflows

### Weekly Feedback Review

```bash
# 1. Generate feedback summary
./scripts/feedback-summary.sh --output docs/feedback/weekly-$(date +%Y%m%d).md

# 2. Review and categorize issues
#    - Prioritize bugs
#    - Identify feature requests
#    - Track accuracy issues

# 3. Update roadmap based on feedback
```

### Release Preparation

```bash
# 1. Run full validation
./scripts/validate-full.sh

# 2. Run smoke tests
./scripts/smoke-test.sh

# 3. Generate pre-release feedback summary
./scripts/feedback-summary.sh --output docs/feedback/prerelease-$(date +%Y%m%d).md

# 4. Address critical bugs before release
```

### Structured User Testing

```bash
# 1. Start testing session
./scripts/user-test-session.sh --start

# 2. Run through BETA_TESTING.md checklist
#    - Priority 1: Core Functionality
#    - Priority 2: Voice Commands
#    - Priority 3: Personalization
#    - Priority 4: Platform-Specific

# 3. Document findings in notes file
#    echo "Bug found: voice command 'save' not working" > test-notes.txt

# 4. Attach notes to session
./scripts/user-test-session.sh --notes test-notes.txt

# 5. Finish and generate report
./scripts/user-test-session.sh --finish
```

---

## Feedback Data Location

| Type | Location | Purpose |
|------|----------|---------|
| Public Issues | GitHub Issues | Bug reports, feature requests |
| Public Discussions | GitHub Discussions | Questions, general feedback |
| Session Reports | `.user-testing/report-*.md` | Structured test results |
| Session Data | `.user-testing/session-*.json` | Raw session data |

---

## GitHub Issue Templates

The repository includes specialized issue templates for different feedback types:

- **bug_report.md** - Bug reports with environment details
- **feature_request.md** - New feature proposals
- **performance_issue.md** - Performance-specific issues
- **accuracy_issue.md** - Transcription accuracy problems
- **usability_issue.md** - UI/UX issues
- **documentation.md** - Documentation feedback

---

## Metrics to Track

| Metric | Source | Target |
|--------|--------|--------|
| Issue Resolution Rate | feedback-summary.sh | >80% |
| Bug Fix Time | GitHub Issues | <7 days |
| Feature Request Response | GitHub Issues | Acknowledge in 3 days |
| Smoke Test Pass Rate | smoke-test.sh | 100% |

---

## Integration with CI/CD

Consider adding these steps to your CI/CD pipeline:

```yaml
# .github/workflows/feedback-summary.yml
name: Weekly Feedback Summary
on:
  schedule:
    - cron: '0 9 * * 1'  # Every Monday at 9 AM
  workflow_dispatch:

jobs:
  summarize:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Generate feedback summary
        run: |
          ./scripts/feedback-summary.sh --output FEEDBACK.md
      - name: Upload summary
        uses: actions/upload-artifact@v3
        with:
          name: feedback-summary
          path: FEEDBACK.md
```

---

## Related Documentation

- [BETA_TESTING.md](./BETA_TESTING.md) - Beta testing program details
- [TESTING.md](./TESTING.md) - Testing guide for backend and extension
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues and solutions
