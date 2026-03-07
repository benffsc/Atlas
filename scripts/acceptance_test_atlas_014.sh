#!/usr/bin/env bash
# DEPRECATED: v1 acceptance test. References trapper.* schema dropped in MIG_2299. Do not run.
# acceptance_test_atlas_014.sh
#
# Acceptance tests for ATLAS_014: Owner Address Pipeline.
#
# Verifies:
#   1. v_clinichq_owner_latest view exists
#   2. v_clinichq_owner_address_candidates view exists
#   3. Owner address candidates count > 0 or all processed
#   4. person_place_relationships increased (or at least > 69 baseline)
#   5. cat_place_relationships increased (or at least > 100 baseline)
#   6. Idempotency check: no duplicates on rerun
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_014.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

pass() {
  echo -e "${GREEN}PASS${RESET}: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo -e "${RED}FAIL${RESET}: $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

warn() {
  echo -e "${YELLOW}WARN${RESET}: $1"
  WARN_COUNT=$((WARN_COUNT + 1))
}

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo -e "${BOLD}  ATLAS_014 Acceptance Tests${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Database preflight check
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib/db_preflight.sh"

# ============================================
# TEST 1: v_clinichq_owner_latest view exists
# ============================================
echo -e "${BOLD}Test 1: v_clinichq_owner_latest view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_clinichq_owner_latest';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_clinichq_owner_latest view does not exist"
else
    pass "v_clinichq_owner_latest view exists"

    OWNER_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.v_clinichq_owner_latest;" | tr -d '[:space:]')
    pass "v_clinichq_owner_latest has $OWNER_COUNT records"
fi

echo ""

# ============================================
# TEST 2: v_clinichq_owner_address_candidates view exists
# ============================================
echo -e "${BOLD}Test 2: v_clinichq_owner_address_candidates view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_clinichq_owner_address_candidates';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_clinichq_owner_address_candidates view does not exist"
else
    pass "v_clinichq_owner_address_candidates view exists"

    CANDIDATE_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.v_clinichq_owner_address_candidates;" | tr -d '[:space:]')
    pass "v_clinichq_owner_address_candidates has $CANDIDATE_COUNT pending"
fi

echo ""

# ============================================
# TEST 3: Owner address stats view
# ============================================
echo -e "${BOLD}Test 3: v_owner_address_stats view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_owner_address_stats';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_owner_address_stats view does not exist"
else
    pass "v_owner_address_stats view exists"

    echo -e "${CYAN}Owner address stats:${RESET}"
    psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_owner_address_stats;"
fi

echo ""

# ============================================
# TEST 4: Person-place relationships count
# ============================================
echo -e "${BOLD}Test 4: person_place_relationships coverage${RESET}"
echo "─────────────────────────────────────────────"

PPR_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.person_place_relationships;" | tr -d '[:space:]')

if [[ "$PPR_COUNT" -gt 69 ]]; then
    pass "person_place_relationships: $PPR_COUNT (above baseline of 69)"
else
    warn "person_place_relationships: $PPR_COUNT (baseline was 69, expected increase)"
fi

# Check by source
echo -e "${CYAN}Person-place relationships by source:${RESET}"
psql "$DATABASE_URL" -c "
    SELECT source_table, COUNT(*) AS count
    FROM trapper.person_place_relationships
    GROUP BY 1
    ORDER BY 2 DESC;
"

echo ""

# ============================================
# TEST 5: Cat-place relationships count
# ============================================
echo -e "${BOLD}Test 5: cat_place_relationships coverage${RESET}"
echo "─────────────────────────────────────────────"

CPR_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.cat_place_relationships;" | tr -d '[:space:]')

if [[ "$CPR_COUNT" -gt 100 ]]; then
    pass "cat_place_relationships: $CPR_COUNT (above baseline of 100)"
else
    warn "cat_place_relationships: $CPR_COUNT (baseline was 100, expected increase)"
fi

# Calculate coverage
TOTAL_CATS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.sot_cats;" | tr -d '[:space:]')
CATS_WITH_PLACE=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships;" | tr -d '[:space:]')
COVERAGE_PCT=$(echo "scale=1; 100 * $CATS_WITH_PLACE / $TOTAL_CATS" | bc)

echo -e "${CYAN}Cat-place coverage:${RESET} $CATS_WITH_PLACE / $TOTAL_CATS ($COVERAGE_PCT%)"

echo ""

# ============================================
# TEST 6: Idempotency check
# ============================================
echo -e "${BOLD}Test 6: Idempotency check${RESET}"
echo "─────────────────────────────────────────────"

# Count staged_record_address_link entries
SRAL_COUNT_BEFORE=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM trapper.staged_record_address_link sral
    JOIN trapper.staged_records sr ON sr.id = sral.staged_record_id
    WHERE sr.source_table = 'owner_info';
" | tr -d '[:space:]')

# Run link function again (should not create duplicates)
psql "$DATABASE_URL" -q -c "SELECT * FROM trapper.link_owner_addresses_to_staged_records();" 2>/dev/null || true

SRAL_COUNT_AFTER=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM trapper.staged_record_address_link sral
    JOIN trapper.staged_records sr ON sr.id = sral.staged_record_id
    WHERE sr.source_table = 'owner_info';
" | tr -d '[:space:]')

if [[ "$SRAL_COUNT_BEFORE" -eq "$SRAL_COUNT_AFTER" ]]; then
    pass "Idempotency: no duplicate address links on rerun ($SRAL_COUNT_BEFORE → $SRAL_COUNT_AFTER)"
else
    warn "Idempotency: address link count changed on rerun ($SRAL_COUNT_BEFORE → $SRAL_COUNT_AFTER)"
fi

echo ""

# ============================================
# SUMMARY
# ============================================
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Summary${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo ""
echo -e "${GREEN}Passed:${RESET} $PASS_COUNT"
echo -e "${RED}Failed:${RESET} $FAIL_COUNT"
echo -e "${YELLOW}Warnings:${RESET} $WARN_COUNT"
echo ""

if [[ $FAIL_COUNT -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}All critical acceptance tests passed!${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}Some tests failed.${RESET}"
  exit 1
fi
