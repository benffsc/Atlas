#!/usr/bin/env bash
set -euo pipefail

# smoke_intake.sh
# Non-destructive smoke test for intake pipeline
# Proves: dry-run safety, real ingest works, idempotency (no duplicates on re-run)
# Uses composite logical key: (source_system, source_row_hash)
#
# FAIL-FAST: Will exit immediately if migrations are missing.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_step() { echo -e "${GREEN}[STEP]${NC} $1"; }
log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; }

# Load .env
if [[ -f "$REPO_ROOT/.env" ]]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
else
    log_fail ".env file not found at $REPO_ROOT/.env"
    echo ""
    echo "Create .env with: DATABASE_URL=postgres://..."
    exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
    log_fail "DATABASE_URL not set in .env"
    echo ""
    echo "Add DATABASE_URL=postgres://... to your .env file"
    exit 1
fi

# Find psql
PSQL="${PSQL:-$(command -v psql 2>/dev/null || echo "/opt/homebrew/Cellar/libpq/18.1/bin/psql")}"
if [[ ! -x "$PSQL" ]]; then
    log_fail "psql not found"
    echo ""
    echo "Fix: export PATH=\"/opt/homebrew/Cellar/libpq/18.1/bin:\$PATH\""
    echo " Or: brew install libpq"
    exit 1
fi

cd "$REPO_ROOT"

echo ""
echo "========================================"
echo "  FFSCTrapperApp Intake Smoke Test"
echo "  (Composite Key: source_system + source_row_hash)"
echo "========================================"
echo ""

# ============================================================
# PREFLIGHT CHECKS - Fail fast if migrations missing
# ============================================================

log_step "PREFLIGHT: Checking database schema..."
echo ""

check_table() {
    local table=$1
    local result
    result=$("$PSQL" "$DATABASE_URL" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='trapper' AND table_name='$table';" | tr -d ' ')
    [[ "$result" == "1" ]]
}

check_view() {
    local view=$1
    local result
    result=$("$PSQL" "$DATABASE_URL" -tAc "SELECT 1 FROM information_schema.views WHERE table_schema='trapper' AND table_name='$view';" | tr -d ' ')
    [[ "$result" == "1" ]]
}

check_constraint() {
    local constraint=$1
    local result
    result=$("$PSQL" "$DATABASE_URL" -tAc "SELECT 1 FROM pg_constraint WHERE conname='$constraint';" | tr -d ' ')
    [[ "$result" == "1" ]]
}

PREFLIGHT_FAILED=0

# Check MIG_050 (appointment_requests table)
if check_table "appointment_requests"; then
    log_pass "MIG_050: trapper.appointment_requests exists"
else
    log_fail "MIG_050: trapper.appointment_requests MISSING"
    PREFLIGHT_FAILED=1
fi

# Check MIG_051 (clinichq_upcoming_appointments table)
if check_table "clinichq_upcoming_appointments"; then
    log_pass "MIG_051: trapper.clinichq_upcoming_appointments exists"
else
    log_fail "MIG_051: trapper.clinichq_upcoming_appointments MISSING"
    PREFLIGHT_FAILED=1
fi

# Check MIG_052 (views)
if check_view "v_appointment_requests_feed"; then
    log_pass "MIG_052: trapper.v_appointment_requests_feed exists"
else
    log_fail "MIG_052: trapper.v_appointment_requests_feed MISSING"
    PREFLIGHT_FAILED=1
fi

if check_view "v_upcoming_appointments_feed"; then
    log_pass "MIG_052: trapper.v_upcoming_appointments_feed exists"
else
    log_fail "MIG_052: trapper.v_upcoming_appointments_feed MISSING"
    PREFLIGHT_FAILED=1
fi

# Check MIG_053 (composite key constraints) - REQUIRED for ingest
if check_constraint "appointment_requests__uq_source_system_row_hash"; then
    log_pass "MIG_053: appointment_requests composite key constraint exists"
else
    log_fail "MIG_053: appointment_requests composite key constraint MISSING"
    PREFLIGHT_FAILED=1
fi

if check_constraint "clinichq_upcoming_appointments__uq_source_system_row_hash"; then
    log_pass "MIG_053: clinichq_upcoming_appointments composite key constraint exists"
else
    log_fail "MIG_053: clinichq_upcoming_appointments composite key constraint MISSING"
    PREFLIGHT_FAILED=1
fi

echo ""

if [[ $PREFLIGHT_FAILED -eq 1 ]]; then
    log_fail "PREFLIGHT FAILED - Migrations required before smoke test can run."
    echo ""
    echo "Apply migrations in order (copy/paste each line):"
    echo ""
    echo "  source .env && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_050__create_appointment_requests_table.sql"
    echo "  source .env && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_051__create_clinichq_upcoming_appointments_table.sql"
    echo "  source .env && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_052__create_intake_feed_views.sql"
    echo "  source .env && psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_053__add_composite_intake_unique_keys.sql"
    echo ""
    echo "Or run: make migrate-print"
    echo ""
    exit 1
fi

log_pass "PREFLIGHT PASSED - All migrations applied"
echo ""

# ============================================================
# PYTHON SYNTAX CHECK
# ============================================================

log_step "Running make pycheck..."
if make pycheck; then
    log_pass "Python syntax OK"
else
    log_fail "Python syntax check failed"
    exit 1
fi
echo ""

# ============================================================
# BASELINE CAPTURE
# ============================================================

get_composite_keys() {
    "$PSQL" "$DATABASE_URL" -tAc "
        SELECT COALESCE(
            (SELECT COUNT(DISTINCT (source_system, source_row_hash)) FROM trapper.appointment_requests), 0
        ) + COALESCE(
            (SELECT COUNT(DISTINCT (source_system, source_row_hash)) FROM trapper.clinichq_upcoming_appointments), 0
        );
    " | tr -d ' '
}

get_duplicates() {
    "$PSQL" "$DATABASE_URL" -tAc "
        SELECT (
            (SELECT COUNT(*) - COUNT(DISTINCT (source_system, source_row_hash)) FROM trapper.appointment_requests) +
            (SELECT COUNT(*) - COUNT(DISTINCT (source_system, source_row_hash)) FROM trapper.clinichq_upcoming_appointments)
        );
    " | tr -d ' '
}

show_idempotency_proof() {
    echo ""
    log_info "Idempotency proof (QRY_051):"
    "$PSQL" "$DATABASE_URL" -P pager=off -c "
        SELECT
            'appointment_requests' AS table_name,
            COUNT(*) AS total_rows,
            COUNT(DISTINCT (source_system, source_row_hash)) AS distinct_composite_keys,
            COUNT(*) - COUNT(DISTINCT (source_system, source_row_hash)) AS duplicates
        FROM trapper.appointment_requests
        UNION ALL
        SELECT
            'clinichq_upcoming',
            COUNT(*),
            COUNT(DISTINCT (source_system, source_row_hash)),
            COUNT(*) - COUNT(DISTINCT (source_system, source_row_hash))
        FROM trapper.clinichq_upcoming_appointments;
    "
}

log_step "Capturing BASELINE metrics..."
BASELINE=$(get_composite_keys)
BASELINE_DUPES=$(get_duplicates)
echo "  Baseline composite keys: $BASELINE"
echo "  Baseline duplicates:     $BASELINE_DUPES"
show_idempotency_proof
echo ""

# ============================================================
# DRY RUN TEST
# ============================================================

log_step "Running make ingest-dry..."
make ingest-dry
echo ""

log_step "Verifying dry-run did NOT persist changes..."
AFTER_DRY=$(get_composite_keys)
AFTER_DRY_DUPES=$(get_duplicates)
echo "  After dry-run composite keys: $AFTER_DRY"
echo "  After dry-run duplicates:     $AFTER_DRY_DUPES"

if [[ "$BASELINE" == "$AFTER_DRY" ]]; then
    log_pass "Dry-run safety VERIFIED (keys unchanged: $BASELINE -> $AFTER_DRY)"
else
    log_fail "Dry-run PERSISTED changes! (keys: $BASELINE -> $AFTER_DRY)"
    exit 1
fi
show_idempotency_proof
echo ""

# ============================================================
# FIRST REAL INGEST
# ============================================================

log_step "Running make ingest (FIRST real run)..."
make ingest
echo ""

log_step "Checking post-ingest metrics..."
AFTER_FIRST=$(get_composite_keys)
AFTER_FIRST_DUPES=$(get_duplicates)
DELTA=$((AFTER_FIRST - BASELINE))
echo "  After first ingest composite keys: $AFTER_FIRST"
echo "  After first ingest duplicates:     $AFTER_FIRST_DUPES"
echo "  Delta from baseline:               +$DELTA"

if [[ $AFTER_FIRST -ge $BASELINE ]]; then
    log_pass "First ingest completed (added $DELTA composite keys)"
else
    log_warn "Key count decreased? Unexpected."
fi
show_idempotency_proof
echo ""

# ============================================================
# SECOND INGEST (IDEMPOTENCY TEST)
# ============================================================

log_step "Running make ingest (SECOND run - idempotency test)..."
make ingest
echo ""

log_step "Verifying IDEMPOTENCY (no new keys on re-run)..."
AFTER_SECOND=$(get_composite_keys)
AFTER_SECOND_DUPES=$(get_duplicates)
SECOND_DELTA=$((AFTER_SECOND - AFTER_FIRST))
echo "  After second ingest composite keys: $AFTER_SECOND"
echo "  After second ingest duplicates:     $AFTER_SECOND_DUPES"
echo "  Delta from first ingest:            +$SECOND_DELTA"

if [[ $SECOND_DELTA -eq 0 ]]; then
    log_pass "IDEMPOTENT! Second run added 0 new composite keys"
else
    log_fail "NOT IDEMPOTENT! Second run added $SECOND_DELTA composite keys"
    exit 1
fi
show_idempotency_proof
echo ""

# ============================================================
# DUPLICATE CHECK
# ============================================================

log_step "Checking for duplicate composite keys..."
FINAL_DUPES=$(get_duplicates)
if [[ "$FINAL_DUPES" == "0" ]]; then
    log_pass "No duplicate composite keys found"
else
    log_fail "Found $FINAL_DUPES duplicate composite keys!"
    exit 1
fi
echo ""

# ============================================================
# SQL CHECKS AND SANITY
# ============================================================

log_step "Running make checks..."
make checks || log_warn "Some checks had warnings (review output above)"
echo ""

log_step "Running make sanity..."
make sanity
echo ""

# ============================================================
# FINAL SUMMARY
# ============================================================

echo ""
echo "========================================"
echo "  SMOKE TEST SUMMARY"
echo "========================================"
echo ""
echo "  Phase                    | Composite Keys | Duplicates"
echo "  -------------------------|----------------|------------"
printf "  Baseline                 | %14s | %10s\n" "$BASELINE" "$BASELINE_DUPES"
printf "  After dry-run            | %14s | %10s\n" "$AFTER_DRY" "$AFTER_DRY_DUPES"
printf "  After first ingest       | %14s | %10s  (+%s)\n" "$AFTER_FIRST" "$AFTER_FIRST_DUPES" "$DELTA"
printf "  After second ingest      | %14s | %10s  (+%s)\n" "$AFTER_SECOND" "$AFTER_SECOND_DUPES" "$SECOND_DELTA"
echo "  -------------------------|----------------|------------"
echo ""
echo "  Dry-run safety:    $(if [[ "$BASELINE" == "$AFTER_DRY" ]]; then echo "PASS"; else echo "FAIL"; fi)"
echo "  Idempotency:       $(if [[ $SECOND_DELTA -eq 0 ]]; then echo "PASS"; else echo "FAIL"; fi)"
echo "  No duplicates:     $(if [[ "$FINAL_DUPES" == "0" ]]; then echo "PASS"; else echo "FAIL"; fi)"
echo ""
log_pass "ALL SMOKE TESTS PASSED!"
echo ""
echo "Next steps:"
echo "  - Daily/weekly: make ingest && make preview && make sanity"
echo "  - See: docs/FIRST_RUN_INTAKE.md"
echo ""
