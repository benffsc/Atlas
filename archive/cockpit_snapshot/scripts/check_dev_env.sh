#!/usr/bin/env bash
# check_dev_env.sh
# Quick validation that dev environment is properly set up
#
# Usage:
#   bash scripts/check_dev_env.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_pass() { echo -e "${GREEN}[OK]${NC} $1"; }
check_fail() { echo -e "${RED}[MISSING]${NC} $1"; FAILED=1; }
check_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

FAILED=0

echo ""
echo "=========================================="
echo "  FFSC Trapper Cockpit - Dev Env Check"
echo "=========================================="
echo ""

# ============================================================
# 1. Required Tools
# ============================================================

echo "Checking required tools..."
echo "---"

# psql
PSQL="${PSQL:-$(command -v psql 2>/dev/null || echo "/opt/homebrew/Cellar/libpq/18.1/bin/psql")}"
if [[ -x "$PSQL" ]]; then
    check_pass "psql: $($PSQL --version | head -1)"
else
    check_fail "psql not found"
    echo "  Fix: export PATH=\"/opt/homebrew/Cellar/libpq/18.1/bin:\$PATH\""
    echo "   Or: brew install libpq"
fi

# node
if command -v node &>/dev/null; then
    check_pass "node: $(node --version)"
else
    check_fail "node not found"
    echo "  Fix: Install Node.js (https://nodejs.org/)"
fi

# npm
if command -v npm &>/dev/null; then
    check_pass "npm: $(npm --version)"
else
    check_fail "npm not found"
fi

echo ""

# ============================================================
# 2. Python Environment
# ============================================================

echo "Checking Python environment..."
echo "---"

# .venv
if [[ -d "$REPO_ROOT/.venv" ]]; then
    check_pass ".venv directory exists"

    if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
        PYTHON_VERSION=$("$REPO_ROOT/.venv/bin/python" --version 2>&1)
        check_pass "Python: $PYTHON_VERSION"
    else
        check_fail ".venv/bin/python not executable"
    fi
else
    check_fail ".venv not found"
    echo "  Fix: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
fi

echo ""

# ============================================================
# 3. Environment Variables
# ============================================================

echo "Checking environment configuration..."
echo "---"

# .env file
if [[ -f "$REPO_ROOT/.env" ]]; then
    check_pass ".env file exists"

    # Load it
    set -a
    source "$REPO_ROOT/.env" 2>/dev/null || true
    set +a

    if [[ -n "${DATABASE_URL:-}" ]]; then
        # Mask the URL for display
        MASKED=$(echo "$DATABASE_URL" | sed 's/:[^@]*@/:***@/')
        check_pass "DATABASE_URL set ($MASKED)"
    else
        check_fail "DATABASE_URL not set in .env"
    fi
else
    check_fail ".env file not found"
    echo "  Fix: cp .env.example .env && edit .env with your DATABASE_URL"
fi

echo ""

# ============================================================
# 4. Database Connectivity
# ============================================================

echo "Checking database connectivity..."
echo "---"

if [[ -n "${DATABASE_URL:-}" ]] && [[ -x "$PSQL" ]]; then
    if "$PSQL" "$DATABASE_URL" -c "SELECT 1;" &>/dev/null; then
        check_pass "Database connection successful"

        # Check schema
        TABLE_COUNT=$("$PSQL" "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='trapper'" 2>/dev/null || echo "0")
        if [[ "$TABLE_COUNT" -gt 0 ]]; then
            check_pass "trapper schema: $TABLE_COUNT tables"
        else
            check_warn "trapper schema has no tables (run migrations)"
        fi

        # Check extensions
        POSTGIS=$("$PSQL" "$DATABASE_URL" -tAc "SELECT 1 FROM pg_extension WHERE extname='postgis'" 2>/dev/null || echo "")
        if [[ "$POSTGIS" == "1" ]]; then
            check_pass "PostGIS extension enabled"
        else
            check_warn "PostGIS not enabled (some features may not work)"
        fi
    else
        check_fail "Cannot connect to database"
        echo "  Check your DATABASE_URL in .env"
    fi
else
    check_warn "Skipping database check (missing DATABASE_URL or psql)"
fi

echo ""

# ============================================================
# 5. Node Dependencies
# ============================================================

echo "Checking Node.js dependencies..."
echo "---"

if [[ -d "$REPO_ROOT/apps/web/node_modules" ]]; then
    check_pass "apps/web/node_modules exists"
else
    check_warn "apps/web/node_modules not found"
    echo "  Fix: npm -C apps/web install"
fi

echo ""

# ============================================================
# Summary
# ============================================================

echo "=========================================="
if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}All checks passed!${NC}"
    echo ""
    echo "Quick start:"
    echo "  npm -C apps/web run dev"
    echo "  # Open http://localhost:3000/dashboard"
else
    echo -e "${RED}Some checks failed. See above for fixes.${NC}"
fi
echo "=========================================="
echo ""

exit $FAILED
