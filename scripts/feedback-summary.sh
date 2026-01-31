#!/bin/bash
# VTThought Feedback Summary
# Generates a summary of user feedback from GitHub issues and discussions
#
# Usage: ./scripts/feedback-summary.sh [--output FILE] [--format markdown|json]
#
# Requirements: gh CLI installed and authenticated

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_FILE=""
OUTPUT_FORMAT="markdown"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --output|-o)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        --format|-f)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--output FILE] [--format markdown|json]"
            echo ""
            echo "Generates a summary of user feedback from GitHub"
            echo ""
            echo "Options:"
            echo "  --output, -o FILE    Write output to file (default: stdout)"
            echo "  --format, -f FORMAT  Output format: markdown or json (default: markdown)"
            echo "  --help, -h           Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Check gh CLI
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: gh CLI not found. Install from https://cli.github.com/${NC}"
    exit 1
fi

# Check authentication
if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: gh CLI not authenticated. Run 'gh auth login'${NC}"
    exit 1
fi

REPO="jedarden/vtthought"
SINCE_DATE="${SINCE_DATE:-2024-01-01}"

echo -e "${BLUE}Fetching feedback from ${REPO}...${NC}"
echo ""

# Fetch issues with metadata
echo -e "${YELLOW}Fetching issues...${NC}"
ISSUES_JSON=$(gh issue list \
    --repo "$REPO" \
    --state all \
    --limit 500 \
    --json title,number,state,labels,createdAt,author,closedAt,comments \
    --search "created:>$SINCE_DATE" 2>/dev/null || echo "[]")

# Count issues by label
BUG_COUNT=$(echo "$ISSUES_JSON" | jq -r '[.[] | select(.labels[].name == "bug")] | length' 2>/dev/null || echo "0")
FEATURE_COUNT=$(echo "$ISSUES_JSON" | jq -r '[.[] | select(.labels[].name == "enhancement" or .labels[].name == "feature-request")] | length' 2>/dev/null || echo "0")
PERFORMANCE_COUNT=$(echo "$ISSUES_JSON" | jq -r '[.[] | select(.labels[].name == "performance")] | length' 2>/dev/null || echo "0")
ACCURACY_COUNT=$(echo "$ISSUES_JSON" | jq -r '[.[] | select(.labels[].name == "accuracy")] | length' 2>/dev/null || echo "0")
USABILITY_COUNT=$(echo "$ISSUES_JSON" | jq -r '[.[] | select(.labels[].name == "usability")] | length' 2>/dev/null || echo "0")

# Count open vs closed
OPEN_COUNT=$(echo "$ISSUES_JSON" | jq -r '[.[] | select(.state == "open")] | length' 2>/dev/null || echo "0")
CLOSED_COUNT=$(echo "$ISSUES_JSON" | jq -r '[.[] | select(.state == "closed")] | length' 2>/dev/null || echo "0")
TOTAL_ISSUES=$((OPEN_COUNT + CLOSED_COUNT))

# Fetch discussions
echo -e "${YELLOW}Fetching discussions...${NC}"
DISCUSSIONS_JSON=$(gh discussion list \
    --repo "$REPO" \
    --limit 100 \
    --json title,number,createdAt,author,comments,upvoteCount \
    --category general 2>/dev/null || echo "[]")

DISCUSSION_COUNT=$(echo "$DISCUSSIONS_JSON" | jq 'length' 2>/dev/null || echo "0")

# Fetch stars and watchers
echo -e "${YELLOW}Fetching repository stats...${NC}"
REPO_STATS=$(gh repo view "$REPO" --json stargazerCount,watchers 2>/dev/null || echo '{}')
STARS=$(echo "$REPO_STATS" | jq -r '.stargazerCount // 0')
WATCHERS=$(echo "$REPO_STATS" | jq -r '.watchers.totalCount // 0')

echo -e "${GREEN}Data collection complete${NC}"
echo ""

# Generate output
if [ "$OUTPUT_FORMAT" = "json" ]; then
    OUTPUT=$(cat <<EOF
{
  "repository": "$REPO",
  "generatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "since": "$SINCE_DATE",
  "stats": {
    "stars": $STARS,
    "watchers": $WATCHERS,
    "totalIssues": $TOTAL_ISSUES,
    "openIssues": $OPEN_COUNT,
    "closedIssues": $CLOSED_COUNT,
    "discussions": $DISCUSSION_COUNT
  },
  "issuesByLabel": {
    "bug": $BUG_COUNT,
    "enhancement": $FEATURE_COUNT,
    "performance": $PERFORMANCE_COUNT,
    "accuracy": $ACCURACY_COUNT,
    "usability": $USABILITY_COUNT
  }
}
EOF
)
else
    # Markdown format
    OUTPUT=$(cat <<EOF
# VTThought User Feedback Summary

**Generated**: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Repository**: [$REPO](https://github.com/$REPO)
**Data Since**: $SINCE_DATE

---

## Community Engagement

| Metric | Count |
|--------|-------|
| GitHub Stars | $STARS |
| Watchers | $WATCHERS |
| Total Issues | $TOTAL_ISSUES |
| Open Issues | $OPEN_COUNT |
| Closed Issues | $CLOSED_COUNT |
| Discussions | $DISCUSSION_COUNT |

---

## Issues by Category

| Category | Count | Description |
|----------|-------|-------------|
| 🐛 Bugs | $BUG_COUNT | Crash, incorrect behavior, data loss |
| ✨ Features | $FEATURE_COUNT | New features and enhancements |
| ⚡ Performance | $PERFORMANCE_COUNT | Slow transcription, high memory/CPU |
| 🎯 Accuracy | $ACCURACY_COUNT | Transcription accuracy issues |
| 🎨 Usability | $USABILITY_COUNT | UI/UX issues, confusing features |

---

## Feedback Quality Metrics

- **Issue Resolution Rate**: $(awk "BEGIN {printf \"%.1f\", ($CLOSED_COUNT / $TOTAL_ISSUES) * 100}")% ($CLOSED_COUNT closed of $TOTAL_ISSUES total)
- **Community Activity**: $DISCUSSION_COUNT discussion threads

---

## Recent Issues (Open)

EOF
)

    # Add recent open issues
    RECENT_OPEN=$(echo "$ISSUES_JSON" | jq -r '[.[] | select(.state == "open")] | sort_by(.createdAt) | reverse | .[0:10] | .[] | "- #[\(.number)] \(.title) ([\(.author.login)](https://github.com/\(.author.login))) - created \(.createdAt)"' 2>/dev/null || echo "No recent open issues")
    OUTPUT="$OUTPUT"$'\n'"$RECENT_OPEN"

    OUTPUT="$OUTPUT"$'\n\n'"## Top Requested Features"$'\n\n'

    # Top feature requests (by upvotes/comments)
    TOP_FEATURES=$(echo "$ISSUES_JSON" | jq -r '[.[] | select(.labels[].name == "enhancement" or .labels[].name == "feature-request")] | sort_by(.comments) | reverse | .[0:5] | .[] | "- #[\(.number)] \(.title) (\(.comments) comments)"' 2>/dev/null || echo "No feature requests")
    OUTPUT="$OUTPUT"$'\n'"$TOP_FEATURES"

    OUTPUT="$OUTPUT"$'\n\n'"---"$'\n\n'"*Generated by [scripts/feedback-summary.sh](https://github.com/$REPO/blob/main/scripts/feedback-summary.sh)*"
fi

# Output
if [ -n "$OUTPUT_FILE" ]; then
    echo "$OUTPUT" > "$OUTPUT_FILE"
    echo -e "${GREEN}Summary written to $OUTPUT_FILE${NC}"
else
    echo "$OUTPUT"
fi
