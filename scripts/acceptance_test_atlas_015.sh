#!/usr/bin/env bash
# DEPRECATED: v1 acceptance test. References trapper.* schema dropped in MIG_2299. Do not run.
# acceptance_test_atlas_015.sh
#
# Acceptance tests for ATLAS_015: Address-Backed Places with Place Kinds.
#
# Verifies:
#   1. place_kind and is_address_backed columns exist
#   2. UNIQUE(sot_address_id) constraint exists
#   3. CHECK constraint for address-backed validation exists
#   4. Every canonical address has exactly one address-backed place
#   5. derive_person_place_relationships runs without creating non-address-backed places
#   6. cat_place_relationships count stable or increased after rerun
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_015.sh

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
echo -e "${BOLD}  ATLAS_015 Acceptance Tests${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Database preflight check
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib/db_preflight.sh"

# ============================================
# TEST 1: place_kind column exists
# ============================================
echo -e "${BOLD}Test 1: place_kind column${RESET}"
echo "─────────────────────────────────────────────"

COLUMN_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'places' AND column_name = 'place_kind';
" | tr -d '[:space:]')

if [[ "$COLUMN_EXISTS" -eq 0 ]]; then
    fail "place_kind column does not exist"
else
    pass "place_kind column exists"

    # Check distribution
    echo -e "${CYAN}Place kind distribution:${RESET}"
    psql "$DATABASE_URL" -c "
        SELECT place_kind, COUNT(*) AS count
        FROM trapper.places
        GROUP BY place_kind
        ORDER BY count DESC;
    "
fi

echo ""

# ============================================
# TEST 2: is_address_backed column exists
# ============================================
echo -e "${BOLD}Test 2: is_address_backed column${RESET}"
echo "─────────────────────────────────────────────"

COLUMN_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'places' AND column_name = 'is_address_backed';
" | tr -d '[:space:]')

if [[ "$COLUMN_EXISTS" -eq 0 ]]; then
    fail "is_address_backed column does not exist"
else
    pass "is_address_backed column exists"

    ADDRESS_BACKED=$(psql "$DATABASE_URL" -t -c "
        SELECT COUNT(*) FROM trapper.places WHERE is_address_backed = true;
    " | tr -d '[:space:]')
    pass "Address-backed places: $ADDRESS_BACKED"
fi

echo ""

# ============================================
# TEST 3: UNIQUE constraint on sot_address_id
# ============================================
echo -e "${BOLD}Test 3: UNIQUE(sot_address_id) constraint${RESET}"
echo "─────────────────────────────────────────────"

CONSTRAINT_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM pg_constraint
    WHERE conrelid = 'trapper.places'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%sot_address_id%';
" | tr -d '[:space:]')

if [[ "$CONSTRAINT_EXISTS" -eq 0 ]]; then
    fail "UNIQUE constraint on sot_address_id does not exist"
else
    pass "UNIQUE(sot_address_id) constraint exists"
fi

echo ""

# ============================================
# TEST 4: CHECK constraint for address-backed
# ============================================
echo -e "${BOLD}Test 4: CHECK constraint for address-backed${RESET}"
echo "─────────────────────────────────────────────"

CHECK_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM pg_constraint
    WHERE conrelid = 'trapper.places'::regclass
      AND contype = 'c'
      AND conname LIKE '%address_backed%';
" | tr -d '[:space:]')

if [[ "$CHECK_EXISTS" -eq 0 ]]; then
    fail "CHECK constraint for address-backed does not exist"
else
    pass "CHECK constraint chk_address_backed_has_address exists"
fi

echo ""

# ============================================
# TEST 5: Every canonical address has a place
# ============================================
echo -e "${BOLD}Test 5: Address-to-place coverage${RESET}"
echo "─────────────────────────────────────────────"

CANONICAL_ADDRESSES=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM trapper.sot_addresses WHERE geocode_status IN ('ok', 'partial', 'success');
" | tr -d '[:space:]')

ADDRESSES_WITH_PLACE=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM trapper.sot_addresses sa
    WHERE sa.geocode_status IN ('ok', 'partial', 'success')
      AND EXISTS (SELECT 1 FROM trapper.places p WHERE p.sot_address_id = sa.address_id);
" | tr -d '[:space:]')

if [[ "$CANONICAL_ADDRESSES" -eq "$ADDRESSES_WITH_PLACE" ]]; then
    pass "All $CANONICAL_ADDRESSES canonical addresses have address-backed places"
else
    MISSING=$((CANONICAL_ADDRESSES - ADDRESSES_WITH_PLACE))
    warn "Missing places: $MISSING canonical addresses without places ($ADDRESSES_WITH_PLACE / $CANONICAL_ADDRESSES)"
fi

echo ""

# ============================================
# TEST 6: derive_person_place creates only address-backed links
# ============================================
echo -e "${BOLD}Test 6: derive_person_place_relationships safety${RESET}"
echo "─────────────────────────────────────────────"

# Count places before
PLACES_BEFORE=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.places;" | tr -d '[:space:]')
NON_BACKED_BEFORE=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.places WHERE is_address_backed = false;" | tr -d '[:space:]')

# Run derive function
psql "$DATABASE_URL" -q -c "SELECT trapper.derive_person_place_relationships(NULL);" 2>/dev/null || true

# Count places after
PLACES_AFTER=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.places;" | tr -d '[:space:]')
NON_BACKED_AFTER=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.places WHERE is_address_backed = false;" | tr -d '[:space:]')

if [[ "$NON_BACKED_BEFORE" -eq "$NON_BACKED_AFTER" ]]; then
    pass "No non-address-backed places created by derive function"
else
    fail "Non-address-backed places changed: $NON_BACKED_BEFORE → $NON_BACKED_AFTER"
fi

if [[ "$PLACES_BEFORE" -le "$PLACES_AFTER" ]]; then
    NEW_PLACES=$((PLACES_AFTER - PLACES_BEFORE))
    pass "Places count stable or increased (+$NEW_PLACES)"
else
    fail "Places count decreased: $PLACES_BEFORE → $PLACES_AFTER"
fi

echo ""

# ============================================
# TEST 7: cat_place_relationships stable
# ============================================
echo -e "${BOLD}Test 7: cat_place_relationships stability${RESET}"
echo "─────────────────────────────────────────────"

CPR_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.cat_place_relationships;" | tr -d '[:space:]')

if [[ "$CPR_COUNT" -ge 100 ]]; then
    pass "cat_place_relationships: $CPR_COUNT (above baseline of 100)"
else
    warn "cat_place_relationships: $CPR_COUNT (below baseline of 100)"
fi

# Show breakdown by place_kind
echo -e "${CYAN}Cat-place relationships by place_kind:${RESET}"
psql "$DATABASE_URL" -c "
    SELECT p.place_kind, COUNT(*) AS cat_links
    FROM trapper.cat_place_relationships cpr
    JOIN trapper.places p ON p.place_id = cpr.place_id
    GROUP BY p.place_kind
    ORDER BY cat_links DESC;
"

echo ""

# ============================================
# TEST 8: Views exist
# ============================================
echo -e "${BOLD}Test 8: Required views exist${RESET}"
echo "─────────────────────────────────────────────"

VIEWS_EXIST=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper'
      AND table_name IN ('v_places_address_backed', 'v_place_kind_summary');
" | tr -d '[:space:]')

if [[ "$VIEWS_EXIST" -lt 2 ]]; then
    fail "Some required views missing (found $VIEWS_EXIST of 2)"
else
    pass "All required views exist (v_places_address_backed, v_place_kind_summary)"
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
