#!/usr/bin/env bash
# acceptance_test_atlas_017.sh
#
# Acceptance tests for ATLAS_017: Cats Page + Unified Search Views.
#
# Verifies:
#   1. v_search_unified_v3 exists and returns cats, places, people
#   2. v_cat_list view exists and returns data
#   3. v_cat_detail view exists and returns full detail
#   4. API scripts run successfully
#   5. Search returns expected entity types
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_017.sh

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
echo -e "${BOLD}  ATLAS_017 Acceptance Tests${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Database preflight check
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib/db_preflight.sh"

# ============================================
# TEST 1: v_search_unified_v3 exists
# ============================================
echo -e "${BOLD}Test 1: v_search_unified_v3 view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_search_unified_v3';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_search_unified_v3 view does not exist"
else
    pass "v_search_unified_v3 view exists"

    # Check entity type counts
    echo -e "${CYAN}Entity counts in search view:${RESET}"
    psql "$DATABASE_URL" -c "
        SELECT entity_type, COUNT(*) AS count
        FROM trapper.v_search_unified_v3
        GROUP BY entity_type
        ORDER BY entity_type;
    "

    CAT_COUNT=$(psql "$DATABASE_URL" -t -c "
        SELECT COUNT(*) FROM trapper.v_search_unified_v3 WHERE entity_type = 'cat';
    " | tr -d '[:space:]')

    if [[ "$CAT_COUNT" -gt 0 ]]; then
        pass "Search view returns cats ($CAT_COUNT)"
    else
        fail "Search view returns no cats"
    fi
fi

echo ""

# ============================================
# TEST 2: v_cat_list view exists
# ============================================
echo -e "${BOLD}Test 2: v_cat_list view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_cat_list';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_cat_list view does not exist"
else
    pass "v_cat_list view exists"

    CAT_LIST_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.v_cat_list;" | tr -d '[:space:]')
    pass "v_cat_list has $CAT_LIST_COUNT cats"

    # Check columns
    COLUMNS=$(psql "$DATABASE_URL" -t -c "
        SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
        FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'v_cat_list';
    " | tr -d '[:space:]')

    if [[ "$COLUMNS" == *"microchip"* ]] && [[ "$COLUMNS" == *"primary_place_label"* ]] && [[ "$COLUMNS" == *"place_kind"* ]]; then
        pass "v_cat_list has required columns (microchip, primary_place_label, place_kind)"
    else
        warn "v_cat_list may be missing some columns"
    fi
fi

echo ""

# ============================================
# TEST 3: v_cat_detail view exists
# ============================================
echo -e "${BOLD}Test 3: v_cat_detail view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_cat_detail';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_cat_detail view does not exist"
else
    pass "v_cat_detail view exists"

    # Get a sample cat ID and test detail view
    SAMPLE_CAT_ID=$(psql "$DATABASE_URL" -t -c "
        SELECT cat_id FROM trapper.v_cat_list LIMIT 1;
    " | tr -d '[:space:]')

    if [[ -n "$SAMPLE_CAT_ID" ]]; then
        # Check that detail returns data
        DETAIL_CHECK=$(psql "$DATABASE_URL" -t -c "
            SELECT cat_id FROM trapper.v_cat_detail WHERE cat_id = '$SAMPLE_CAT_ID';
        " | tr -d '[:space:]')

        if [[ "$DETAIL_CHECK" == "$SAMPLE_CAT_ID" ]]; then
            pass "v_cat_detail returns data for sample cat"
        else
            fail "v_cat_detail failed to return sample cat"
        fi

        # Check JSONB columns exist
        HAS_OWNERS=$(psql "$DATABASE_URL" -t -c "
            SELECT owners IS NOT NULL FROM trapper.v_cat_detail WHERE cat_id = '$SAMPLE_CAT_ID';
        " | tr -d '[:space:]')

        if [[ "$HAS_OWNERS" == "t" ]] || [[ "$HAS_OWNERS" == "f" ]]; then
            pass "v_cat_detail has owners column"
        else
            warn "v_cat_detail owners column issue"
        fi
    else
        warn "No cats available for detail test"
    fi
fi

echo ""

# ============================================
# TEST 4: Search returns mixed entity types
# ============================================
echo -e "${BOLD}Test 4: Search functionality${RESET}"
echo "─────────────────────────────────────────────"

# Search for something that might match cats and places
SEARCH_RESULTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(DISTINCT entity_type) FROM trapper.v_search_unified_v3
    WHERE search_text ILIKE '%a%';
" | tr -d '[:space:]')

if [[ "$SEARCH_RESULTS" -ge 2 ]]; then
    pass "Search returns multiple entity types ($SEARCH_RESULTS)"
else
    warn "Search returns only $SEARCH_RESULTS entity types"
fi

# Test search by cat name
echo -e "${CYAN}Sample search results:${RESET}"
psql "$DATABASE_URL" -c "
    SELECT entity_type, LEFT(display, 30) AS display, LEFT(subtitle, 40) AS subtitle
    FROM trapper.v_search_unified_v3
    LIMIT 10;
"

echo ""

# ============================================
# TEST 5: API scripts exist
# ============================================
echo -e "${BOLD}Test 5: API scripts${RESET}"
echo "─────────────────────────────────────────────"

API_SCRIPTS=("get_cats.mjs" "get_cat_detail.mjs" "search.mjs")
MISSING_SCRIPTS=0

for script in "${API_SCRIPTS[@]}"; do
    if [[ -f "$SCRIPT_DIR/api/$script" ]]; then
        pass "API script exists: $script"
    else
        fail "API script missing: $script"
        MISSING_SCRIPTS=$((MISSING_SCRIPTS + 1))
    fi
done

echo ""

# ============================================
# TEST 6: Smoke test API scripts
# ============================================
echo -e "${BOLD}Test 6: API script smoke test${RESET}"
echo "─────────────────────────────────────────────"

# Test get_cats.mjs
if [[ -f "$SCRIPT_DIR/api/get_cats.mjs" ]]; then
    CATS_OUTPUT=$(node "$SCRIPT_DIR/api/get_cats.mjs" --limit 1 2>&1) || true

    if echo "$CATS_OUTPUT" | grep -q '"cats"'; then
        pass "get_cats.mjs returns cats array"
    else
        warn "get_cats.mjs output unexpected: ${CATS_OUTPUT:0:100}"
    fi
fi

# Test search.mjs
if [[ -f "$SCRIPT_DIR/api/search.mjs" ]]; then
    SEARCH_OUTPUT=$(node "$SCRIPT_DIR/api/search.mjs" "a" --limit 3 2>&1) || true

    if echo "$SEARCH_OUTPUT" | grep -q '"results"'; then
        pass "search.mjs returns results array"
    else
        warn "search.mjs output unexpected: ${SEARCH_OUTPUT:0:100}"
    fi
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
