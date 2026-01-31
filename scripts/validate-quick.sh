#!/bin/bash
# VTThought Quick Validation
# Fast checks suitable for running after each commit
#
# Usage: ./scripts/validate-quick.sh
#
# This runs in <60 seconds and checks:
# - Backend compiles (Python syntax)
# - Extension compiles (TypeScript)
# - Basic imports work

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

FAILED=0

echo "=== VTThought Quick Validation ==="
echo ""

# Check backend Python syntax
echo -n "Checking backend Python syntax... "
cd "$PROJECT_ROOT/backend"

# Activate virtual environment if it exists
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

if python3 -m py_compile app/main.py app/config.py 2>/dev/null; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAIL${NC}"
    FAILED=1
fi

# Check backend imports
echo -n "Checking backend imports... "
if python3 -c "from app.main import app; from app.config import get_settings" 2>/dev/null; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAIL${NC}"
    FAILED=1
fi

# Check extension TypeScript
echo -n "Checking extension TypeScript... "
cd "$PROJECT_ROOT/extension"
if npm run compile --silent 2>/dev/null; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAIL${NC}"
    FAILED=1
fi

# Check extension output exists
echo -n "Checking extension output... "
if [ -f "$PROJECT_ROOT/extension/out/extension.js" ]; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAIL${NC}"
    FAILED=1
fi

echo ""
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}Quick validation passed${NC}"
    exit 0
else
    echo -e "${RED}Quick validation failed${NC}"
    exit 1
fi
