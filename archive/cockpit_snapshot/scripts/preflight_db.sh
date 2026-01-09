#!/usr/bin/env bash
# preflight_db.sh
# Validates DB has required objects for the Cockpit to function.
# Exits non-zero if critical migrations are missing, with clear instructions.
#
# Usage:
#   bash scripts/preflight_db.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_pass() { echo -e "${GREEN}[OK]${NC} $1"; }
check_fail() { echo -e "${RED}[MISSING]${NC} $1"; }
check_warn() { echo -e "${YELLOW}[OPTIONAL]${NC} $1"; }

# Load .env
if [[ -f "$REPO_ROOT/.env" ]]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
else
    echo -e "${RED}ERROR: .env file not found${NC}"
    echo "Create .env with DATABASE_URL=postgresql://..."
    exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo -e "${RED}ERROR: DATABASE_URL not set in .env${NC}"
    exit 1
fi

# Find psql
PSQL="${PSQL:-$(command -v psql 2>/dev/null || echo "/opt/homebrew/Cellar/libpq/18.1/bin/psql")}"
if [[ ! -x "$PSQL" ]]; then
    echo -e "${RED}ERROR: psql not found${NC}"
    echo "Fix: export PATH=\"/opt/homebrew/Cellar/libpq/18.1/bin:\$PATH\""
    exit 1
fi

echo ""
echo "=========================================="
echo "  FFSC Cockpit — DB Preflight Check"
echo "=========================================="
echo ""

CRITICAL_FAILED=0
OPTIONAL_MISSING=0

# Helper to check if object exists
check_exists() {
    local query="$1"
    local result
    result=$("$PSQL" "$DATABASE_URL" -tAc "$query" 2>/dev/null | tr -d ' ')
    [[ "$result" == "t" ]] || [[ "$result" == "1" ]]
}

# ============================================================
# CRITICAL: Core Tables (must exist)
# ============================================================

echo "Checking CRITICAL objects (core tables)..."
echo "---"

for tbl in requests people places addresses; do
    if check_exists "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='trapper' AND table_name='$tbl')"; then
        check_pass "trapper.$tbl"
    else
        check_fail "trapper.$tbl"
        CRITICAL_FAILED=1
    fi
done

echo ""

# ============================================================
# CRITICAL: Ingest Tables (must exist for ingest)
# ============================================================

echo "Checking CRITICAL objects (ingest tables)..."
echo "---"

for tbl in appointment_requests clinichq_upcoming_appointments; do
    if check_exists "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='trapper' AND table_name='$tbl')"; then
        check_pass "trapper.$tbl"
    else
        check_fail "trapper.$tbl"
        CRITICAL_FAILED=1
    fi
done

echo ""

# ============================================================
# CRITICAL: Dashboard Views (must exist for UI)
# ============================================================

echo "Checking CRITICAL objects (dashboard views)..."
echo "---"

for vw in v_triage_counts v_triage_items v_dashboard_open_requests v_dashboard_upcoming_clinics; do
    if check_exists "SELECT EXISTS(SELECT 1 FROM information_schema.views WHERE table_schema='trapper' AND table_name='$vw')"; then
        check_pass "trapper.$vw"
    else
        check_fail "trapper.$vw"
        CRITICAL_FAILED=1
    fi
done

echo ""

# ============================================================
# CRITICAL: Search Views (must exist for search)
# ============================================================

echo "Checking CRITICAL objects (search views)..."
echo "---"

if check_exists "SELECT EXISTS(SELECT 1 FROM information_schema.views WHERE table_schema='trapper' AND table_name='v_search_unified_v2')"; then
    check_pass "trapper.v_search_unified_v2 (preferred)"
elif check_exists "SELECT EXISTS(SELECT 1 FROM information_schema.views WHERE table_schema='trapper' AND table_name='v_search_unified')"; then
    check_pass "trapper.v_search_unified (fallback)"
else
    check_fail "trapper.v_search_unified (neither v1 nor v2)"
    CRITICAL_FAILED=1
fi

echo ""

# ============================================================
# OPTIONAL: Ops Lens (MIG_100) - enhances triage
# ============================================================

echo "Checking OPTIONAL objects (Ops Lens - MIG_100)..."
echo "---"

OPS_LENS_MISSING=0
for vw in v_ops_requests v_ops_summary v_ops_triage_counts v_ops_triage_items; do
    if check_exists "SELECT EXISTS(SELECT 1 FROM information_schema.views WHERE table_schema='trapper' AND table_name='$vw')"; then
        check_pass "trapper.$vw"
    else
        check_warn "trapper.$vw"
        OPS_LENS_MISSING=1
    fi
done

if check_exists "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='trapper' AND table_name='data_issues')"; then
    check_pass "trapper.data_issues table"
else
    check_warn "trapper.data_issues table"
    OPS_LENS_MISSING=1
fi

if [[ $OPS_LENS_MISSING -eq 1 ]]; then
    OPTIONAL_MISSING=1
fi

echo ""

# ============================================================
# OPTIONAL: Data Issues Refresh (MIG_101)
# ============================================================

echo "Checking OPTIONAL objects (Data Issues Refresh - MIG_101)..."
echo "---"

if check_exists "SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='refresh_data_issues_from_ops')"; then
    check_pass "refresh_data_issues_from_ops() function"
else
    check_warn "refresh_data_issues_from_ops() function"
    OPTIONAL_MISSING=1
fi

echo ""

# ============================================================
# Summary + Instructions
# ============================================================

echo "=========================================="

if [[ $CRITICAL_FAILED -eq 1 ]]; then
    echo -e "${RED}CRITICAL FAILURES — Cockpit cannot function${NC}"
    echo ""
    echo "Apply core migrations (in order):"
    echo ""
    echo "  export PATH=\"/opt/homebrew/Cellar/libpq/18.1/bin:\$PATH\""
    echo "  set -a && source .env && set +a"
    echo ""
    echo "  psql \"\$DATABASE_URL\" -f sql/migrations/MIG_050__create_appointment_requests_table.sql"
    echo "  psql \"\$DATABASE_URL\" -f sql/migrations/MIG_051__create_clinichq_upcoming_appointments_table.sql"
    echo "  psql \"\$DATABASE_URL\" -f sql/migrations/MIG_052__create_intake_feed_views.sql"
    echo "  psql \"\$DATABASE_URL\" -f sql/migrations/MIG_053__add_composite_intake_unique_keys.sql"
    echo "  psql \"\$DATABASE_URL\" -f sql/migrations/MIG_054__create_weekly_ops_views.sql"
    echo "  psql \"\$DATABASE_URL\" -f sql/migrations/MIG_090__this_week_dashboard_views.sql"
    echo "  psql \"\$DATABASE_URL\" -f sql/migrations/MIG_091__dashboard_triage_views.sql"
    echo ""
    exit 1
elif [[ $OPTIONAL_MISSING -eq 1 ]]; then
    echo -e "${GREEN}CRITICAL CHECKS PASSED${NC}"
    echo -e "${YELLOW}OPTIONAL: Ops Lens not applied${NC}"
    echo ""
    echo "To enable Ops Lens (recommended):"
    echo ""
    echo "  psql \"\$DATABASE_URL\" -f sql/migrations/MIG_100__ops_lens_and_data_issues.sql"
    echo "  psql \"\$DATABASE_URL\" -f sql/migrations/MIG_101__data_issues_refresh.sql"
    echo "  psql \"\$DATABASE_URL\" -c \"SELECT * FROM trapper.refresh_data_issues_from_ops();\""
    echo ""
    exit 0
else
    echo -e "${GREEN}ALL CHECKS PASSED${NC}"
    echo ""
    echo "Cockpit is fully configured."
    echo ""
    exit 0
fi
