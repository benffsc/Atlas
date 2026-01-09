#!/usr/bin/env bash
set -euo pipefail

# run_this_week.sh
# Run the weekly ops report (QRY_053)
# Checks views exist first; prints migration commands if missing

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_fail() { echo -e "${RED}[FAIL]${NC} $1"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; }

# Load .env
if [[ -f "$REPO_ROOT/.env" ]]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
else
    log_fail ".env file not found at $REPO_ROOT/.env"
    exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
    log_fail "DATABASE_URL not set in .env"
    exit 1
fi

# Find psql
PSQL="${PSQL:-$(command -v psql 2>/dev/null || echo "/opt/homebrew/Cellar/libpq/18.1/bin/psql")}"
if [[ ! -x "$PSQL" ]]; then
    log_fail "psql not found"
    echo ""
    echo "Fix: export PATH=\"/opt/homebrew/Cellar/libpq/18.1/bin:\$PATH\""
    exit 1
fi

cd "$REPO_ROOT"

# Check required views exist
check_view() {
    local view=$1
    local result
    result=$("$PSQL" "$DATABASE_URL" -tAc "SELECT 1 FROM information_schema.views WHERE table_schema='trapper' AND table_name='$view';" | tr -d ' ')
    [[ "$result" == "1" ]]
}

VIEWS_MISSING=0

if ! check_view "v_intake_unified_feed"; then
    log_fail "View trapper.v_intake_unified_feed MISSING"
    VIEWS_MISSING=1
fi

if ! check_view "v_this_week_focus"; then
    log_fail "View trapper.v_this_week_focus MISSING"
    VIEWS_MISSING=1
fi

if [[ $VIEWS_MISSING -eq 1 ]]; then
    log_fail "Required views missing. Apply migrations first:"
    echo ""
    echo "  # Prerequisites (if not already applied):"
    echo "  source .env && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_050__create_appointment_requests_table.sql"
    echo "  source .env && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_051__create_clinichq_upcoming_appointments_table.sql"
    echo "  source .env && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_052__create_intake_feed_views.sql"
    echo "  source .env && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_053__add_composite_intake_unique_keys.sql"
    echo ""
    echo "  # Weekly ops views:"
    echo "  source .env && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_054__create_weekly_ops_views.sql"
    echo ""
    exit 1
fi

log_pass "Required views exist"
echo ""

# Run the report
"$PSQL" "$DATABASE_URL" -P pager=off -f sql/queries/QRY_053__this_week_ops_report.sql
