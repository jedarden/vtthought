#!/bin/bash
# VTThought User Testing Session Manager
# Manages a user testing session, including environment checks, test recording, and report generation
#
# Usage: ./scripts/user-test-session.sh [--start|--finish] [--notes FILE]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SESSION_DIR="$PROJECT_ROOT/.user-testing"
SESSION_FILE="$SESSION_DIR/current-session.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Create session directory
mkdir -p "$SESSION_DIR"

# Commands
ACTION="${1:-}"
NOTES_FILE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --start)
            ACTION="start"
            shift
            ;;
        --finish)
            ACTION="finish"
            shift
            ;;
        --notes)
            NOTES_FILE="$2"
            shift 2
            ;;
        --status)
            ACTION="status"
            shift
            ;;
        --report)
            ACTION="report"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# Start a new testing session
start_session() {
    local session_id
    session_id=$(date +"%Y%m%d-%H%M%S")

    echo -e "${BLUE}=== Starting User Testing Session ===${NC}"
    echo ""

    # Environment info
    echo -e "${CYAN}System Information:${NC}"
    echo "  Date: $(date)"
    echo "  OS: $(uname -s) $(uname -r)"
    echo "  User: $USER"
    echo ""

    # Check if backend is running
    echo -e "${CYAN}Backend Status:${NC}"
    if curl -s http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓ Backend running on http://127.0.0.1:8765${NC}"
        BACKEND_VERSION=$(curl -s http://127.0.0.1:8765/api/version 2>/dev/null | jq -r '.backend_version // "unknown"' 2>/dev/null || echo "unknown")
        echo "  Version: $BACKEND_VERSION"
    else
        echo -e "  ${YELLOW}⚠ Backend not running on default port${NC}"
    fi
    echo ""

    # Check extension
    echo -e "${CYAN}Extension Status:${NC}"
    if [ -d "$PROJECT_ROOT/extension" ]; then
        echo -e "  ${GREEN}✓ Extension directory exists${NC}"
        if [ -f "$PROJECT_ROOT/extension/package.json" ]; then
            EXT_VERSION=$(jq -r '.version // "unknown' "$PROJECT_ROOT/extension/package.json")
            echo "  Version: $EXT_VERSION"
        fi
    fi
    echo ""

    # Create session file
    cat > "$SESSION_FILE" <<EOF
{
  "session_id": "$session_id",
  "started_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "os": "$(uname -s)",
  "os_version": "$(uname -r)",
  "backend_version": "$BACKEND_VERSION",
  "extension_version": "$EXT_VERSION",
  "tests_completed": [],
  "bugs_found": [],
  "notes": ""
}
EOF

    echo -e "${GREEN}Session $session_id started${NC}"
    echo ""
    echo "Available test commands:"
    echo "  $0 --status           Show session status"
    echo "  $0 --notes FILE       Attach notes to session"
    echo "  $0 --finish           End session and generate report"
    echo ""
}

# Show session status
show_status() {
    if [ ! -f "$SESSION_FILE" ]; then
        echo -e "${YELLOW}No active testing session${NC}"
        echo "Start a new session with: $0 --start"
        exit 0
    fi

    local session_id started_at
    session_id=$(jq -r '.session_id' "$SESSION_FILE")
    started_at=$(jq -r '.started_at' "$SESSION_FILE")

    echo -e "${BLUE}=== Testing Session Status ===${NC}"
    echo ""
    echo "Session ID: $session_id"
    echo "Started: $started_at"
    echo ""

    local tests bugs
    tests=$(jq '.tests_completed | length' "$SESSION_FILE")
    bugs=$(jq '.bugs_found | length' "$SESSION_FILE")

    echo "Tests completed: $tests"
    echo "Bugs found: $bugs"
    echo ""

    if [ "$tests" -gt 0 ]; then
        echo "Tests:"
        jq -r '.tests_completed[] | "  ✓ \(.test)"' "$SESSION_FILE"
        echo ""
    fi

    if [ "$bugs" -gt 0 ]; then
        echo "Bugs:"
        jq -r '.bugs_found[] | "  🐛 \(.description)"' "$SESSION_FILE"
        echo ""
    fi
}

# Attach notes to session
attach_notes() {
    if [ ! -f "$SESSION_FILE" ]; then
        echo -e "${RED}No active testing session${NC}"
        exit 1
    fi

    if [ -z "$NOTES_FILE" ]; then
        echo -e "${RED}--notes requires a file path${NC}"
        exit 1
    fi

    if [ ! -f "$NOTES_FILE" ]; then
        echo -e "${RED}Notes file not found: $NOTES_FILE${NC}"
        exit 1
    fi

    local notes_content
    notes_content=$(cat "$NOTES_FILE")

    # Update session file with notes
    local temp_file
    temp_file=$(mktemp)
    jq --arg notes "$notes_content" '.notes = $notes' "$SESSION_FILE" > "$temp_file"
    mv "$temp_file" "$SESSION_FILE"

    echo -e "${GREEN}Notes attached to session${NC}"
}

# Finish session and generate report
finish_session() {
    if [ ! -f "$SESSION_FILE" ]; then
        echo -e "${YELLOW}No active testing session${NC}"
        exit 0
    fi

    local session_id
    session_id=$(jq -r '.session_id' "$SESSION_FILE")

    echo -e "${BLUE}=== Finishing Testing Session ===${NC}"
    echo ""

    # Update finished timestamp
    local temp_file
    temp_file=$(mktemp)
    jq --arg finished_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" '.finished_at = $finished_at' "$SESSION_FILE" > "$temp_file"
    mv "$temp_file" "$SESSION_FILE"

    # Generate report
    local report_file
    report_file="$SESSION_DIR/report-$session_id.md"

    generate_report "$SESSION_FILE" "$report_file"

    echo -e "${GREEN}Session completed${NC}"
    echo ""
    echo "Report saved to: $report_file"
    echo ""

    # Archive session
    mv "$SESSION_FILE" "$SESSION_DIR/session-$session_id.json"

    echo "Session archived to: $SESSION_DIR/session-$session_id.json"
    echo ""
}

# Generate report from session data
generate_report() {
    local session_file="$1"
    local output_file="$2"

    local session_id started_at finished_at os os_version backend_version extension_version tests bugs notes
    session_id=$(jq -r '.session_id' "$session_file")
    started_at=$(jq -r '.started_at' "$session_file")
    finished_at=$(jq -r '.finished_at // "N/A"' "$session_file")
    os=$(jq -r '.os' "$session_file")
    os_version=$(jq -r '.os_version' "$session_file")
    backend_version=$(jq -r '.backend_version // "N/A"' "$session_file")
    extension_version=$(jq -r '.extension_version // "N/A"' "$session_file")
    tests=$(jq -r '.tests_completed | length' "$session_file")
    bugs=$(jq -r '.bugs_found | length' "$session_file")
    notes=$(jq -r '.notes // ""' "$session_file")

    cat > "$output_file" <<EOF
# User Testing Session Report

**Session ID**: $session_id
**Started**: $started_at
**Finished**: $finished_at

## Environment

| Item | Value |
|------|-------|
| OS | $os $os_version |
| Backend Version | $backend_version |
| Extension Version | $extension_version |

## Test Results

**Tests Completed**: $tests
**Bugs Found**: $bugs

EOF

    if [ "$tests" -gt 0 ]; then
        echo "### Tests Completed" >> "$output_file"
        echo "" >> "$output_file"
        jq -r '.tests_completed[] | "- ✅ \(.test) (\(.status))"' "$session_file" >> "$output_file"
        echo "" >> "$output_file"
    fi

    if [ "$bugs" -gt 0 ]; then
        echo "### Bugs Found" >> "$output_file"
        echo "" >> "$output_file"
        jq -r '.bugs_found[] | "- 🐛 **\(.description)**\n  - Severity: \(.severity)\n  - Steps: \(.steps)"' "$session_file" >> "$output_file"
        echo "" >> "$output_file"
    fi

    if [ -n "$notes" ]; then
        echo "## Notes" >> "$output_file"
        echo "" >> "$output_file"
        echo "$notes" >> "$output_file"
    fi
}

# Generate standalone report from archived sessions
generate_reports_summary() {
    echo -e "${BLUE}=== User Testing Reports Summary ===${NC}"
    echo ""

    if [ ! -d "$SESSION_DIR" ]; then
        echo "No testing data found"
        return
    fi

    local session_count report_count
    session_count=$(find "$SESSION_DIR" -name "session-*.json" 2>/dev/null | wc -l)
    report_count=$(find "$SESSION_DIR" -name "report-*.md" 2>/dev/null | wc -l)

    echo "Archived sessions: $session_count"
    echo "Generated reports: $report_count"
    echo ""

    if [ "$report_count" -gt 0 ]; then
        echo "Recent reports:"
        find "$SESSION_DIR" -name "report-*.md" -printf "%TY-%Tm-%Td %TT %p\n" 2>/dev/null | sort -r | head -5 | while read -r date time path; do
            local basename
            basename=$(basename "$path")
            echo "  - [$basename](file://$path) - $date $time"
        done
    fi
}

# Main dispatch
case "$ACTION" in
    start)
        start_session
        ;;
    status)
        show_status
        ;;
    finish)
        finish_session
        ;;
    report)
        generate_reports_summary
        ;;
    "")
        echo "VTThought User Testing Session Manager"
        echo ""
        echo "Usage: $0 [--start|--finish|--status|--report] [--notes FILE]"
        echo ""
        echo "Commands:"
        echo "  --start     Start a new testing session"
        echo "  --status    Show current session status"
        echo "  --finish    End current session and generate report"
        echo "  --report    Show summary of all testing reports"
        echo "  --notes     Attach notes file to current session"
        exit 0
        ;;
    *)
        echo -e "${RED}Unknown action: $ACTION${NC}"
        exit 1
        ;;
esac
