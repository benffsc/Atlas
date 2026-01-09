#!/usr/bin/env bash
# acceptance_test_atlas_013.sh
#
# Acceptance tests for ATLAS_013: Cat-to-Place Linking.
#
# Verifies:
#   1. cat_place_relationships table exists
#   2. link_cats_to_places function exists
#   3. v_cat_primary_place view exists and returns rows
#   4. v_places_with_cat_activity view exists
#   5. cat_place_relationships has data (warn if 0)
#   6. v_cat_place_stats returns valid stats
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_013.sh

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
echo -e "${BOLD}  ATLAS_013 Acceptance Tests${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Database preflight check
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib/db_preflight.sh"

# ============================================
# TEST 1: cat_place_relationships table exists
# ============================================
echo -e "${BOLD}Test 1: cat_place_relationships table${RESET}"
echo "─────────────────────────────────────────────"

TABLE_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'cat_place_relationships';
" | tr -d '[:space:]')

if [[ "$TABLE_EXISTS" -eq 0 ]]; then
    fail "cat_place_relationships table does not exist"
else
    pass "cat_place_relationships table exists"

    REL_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.cat_place_relationships;" | tr -d '[:space:]')
    if [[ "$REL_COUNT" -gt 0 ]]; then
        pass "cat_place_relationships has $REL_COUNT records"
    else
        warn "cat_place_relationships has 0 records (run link_cats_to_places)"
    fi
fi

echo ""

# ============================================
# TEST 2: link_cats_to_places function exists
# ============================================
echo -e "${BOLD}Test 2: link_cats_to_places function${RESET}"
echo "─────────────────────────────────────────────"

FUNC_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.routines
    WHERE routine_schema = 'trapper' AND routine_name = 'link_cats_to_places';
" | tr -d '[:space:]')

if [[ "$FUNC_EXISTS" -eq 0 ]]; then
    fail "link_cats_to_places function does not exist"
else
    pass "link_cats_to_places function exists"
fi

echo ""

# ============================================
# TEST 3: v_cat_primary_place view
# ============================================
echo -e "${BOLD}Test 3: v_cat_primary_place view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_cat_primary_place';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_cat_primary_place view does not exist"
else
    pass "v_cat_primary_place view exists"

    CATS_WITH_PLACE=$(psql "$DATABASE_URL" -t -c "
        SELECT COUNT(*) FROM trapper.v_cat_primary_place WHERE place_id IS NOT NULL;
    " | tr -d '[:space:]')
    if [[ "$CATS_WITH_PLACE" -gt 0 ]]; then
        pass "v_cat_primary_place shows $CATS_WITH_PLACE cats with places"
    else
        warn "v_cat_primary_place shows 0 cats with places"
    fi
fi

echo ""

# ============================================
# TEST 4: v_places_with_cat_activity view
# ============================================
echo -e "${BOLD}Test 4: v_places_with_cat_activity view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_places_with_cat_activity';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_places_with_cat_activity view does not exist"
else
    pass "v_places_with_cat_activity view exists"

    PLACES_WITH_CATS=$(psql "$DATABASE_URL" -t -c "
        SELECT COUNT(*) FROM trapper.v_places_with_cat_activity;
    " | tr -d '[:space:]')
    if [[ "$PLACES_WITH_CATS" -gt 0 ]]; then
        pass "v_places_with_cat_activity shows $PLACES_WITH_CATS places"
    else
        warn "v_places_with_cat_activity shows 0 places"
    fi
fi

echo ""

# ============================================
# TEST 5: v_cat_place_stats view
# ============================================
echo -e "${BOLD}Test 5: v_cat_place_stats view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_cat_place_stats';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_cat_place_stats view does not exist"
else
    pass "v_cat_place_stats view exists"

    echo -e "${CYAN}Cat-place stats:${RESET}"
    psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_cat_place_stats;"
fi

echo ""

# ============================================
# TEST 6: Relationship type breakdown
# ============================================
echo -e "${BOLD}Test 6: Relationship type breakdown${RESET}"
echo "─────────────────────────────────────────────"

psql "$DATABASE_URL" -c "
    SELECT relationship_type, confidence, COUNT(*) AS count
    FROM trapper.cat_place_relationships
    GROUP BY 1, 2
    ORDER BY 1, 2;
"

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
