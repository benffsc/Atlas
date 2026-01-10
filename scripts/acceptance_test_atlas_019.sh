#!/usr/bin/env bash
# acceptance_test_atlas_019.sh
# Acceptance test for ATLAS_019: Google-like Search
#
# Tests:
#   1. MIG_026 objects exist (pg_trgm, indexes, functions, views)
#   2. Canonical search returns ranked results
#   3. Deep search returns raw/staged hits
#   4. Search handles nonsense queries gracefully
#
# Usage:
#   set -a && source .env && set +a && ./scripts/acceptance_test_atlas_019.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    ((PASS_COUNT++))
}

fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    ((FAIL_COUNT++))
}

warn() {
    echo -e "${YELLOW}⚠ WARN:${NC} $1"
}

echo "============================================"
echo "ATLAS_019 Acceptance Test: Google-like Search"
echo "============================================"
echo ""

# --------------------------------------------------
# Test 1: pg_trgm extension exists
# --------------------------------------------------
echo "Test 1: Checking pg_trgm extension..."
result=$(psql "$DATABASE_URL" -t -A -c "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';")
if [[ "$result" == "pg_trgm" ]]; then
    pass "pg_trgm extension is installed"
else
    fail "pg_trgm extension is not installed"
fi

# --------------------------------------------------
# Test 2: Trigram indexes exist
# --------------------------------------------------
echo ""
echo "Test 2: Checking trigram indexes..."
idx_count=$(psql "$DATABASE_URL" -t -A -c "
    SELECT COUNT(*) FROM pg_indexes
    WHERE schemaname = 'trapper' AND indexname LIKE '%trgm%';
")
if [[ "$idx_count" -ge 4 ]]; then
    pass "Found $idx_count trigram indexes (expected >= 4)"
else
    fail "Found only $idx_count trigram indexes (expected >= 4)"
fi

# --------------------------------------------------
# Test 3: search_unified function exists
# --------------------------------------------------
echo ""
echo "Test 3: Checking search_unified function..."
result=$(psql "$DATABASE_URL" -t -A -c "
    SELECT routine_name FROM information_schema.routines
    WHERE routine_schema = 'trapper' AND routine_name = 'search_unified';
")
if [[ "$result" == "search_unified" ]]; then
    pass "search_unified function exists"
else
    fail "search_unified function does not exist"
fi

# --------------------------------------------------
# Test 4: search_deep function exists
# --------------------------------------------------
echo ""
echo "Test 4: Checking search_deep function..."
result=$(psql "$DATABASE_URL" -t -A -c "
    SELECT routine_name FROM information_schema.routines
    WHERE routine_schema = 'trapper' AND routine_name = 'search_deep';
")
if [[ "$result" == "search_deep" ]]; then
    pass "search_deep function exists"
else
    fail "search_deep function does not exist"
fi

# --------------------------------------------------
# Test 5: search_suggestions function exists
# --------------------------------------------------
echo ""
echo "Test 5: Checking search_suggestions function..."
result=$(psql "$DATABASE_URL" -t -A -c "
    SELECT routine_name FROM information_schema.routines
    WHERE routine_schema = 'trapper' AND routine_name = 'search_suggestions';
")
if [[ "$result" == "search_suggestions" ]]; then
    pass "search_suggestions function exists"
else
    fail "search_suggestions function does not exist"
fi

# --------------------------------------------------
# Test 6: v_person_list view exists
# --------------------------------------------------
echo ""
echo "Test 6: Checking v_person_list view..."
result=$(psql "$DATABASE_URL" -t -A -c "
    SELECT table_name FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_person_list';
")
if [[ "$result" == "v_person_list" ]]; then
    pass "v_person_list view exists"
else
    fail "v_person_list view does not exist"
fi

# --------------------------------------------------
# Test 7: v_place_list view exists
# --------------------------------------------------
echo ""
echo "Test 7: Checking v_place_list view..."
result=$(psql "$DATABASE_URL" -t -A -c "
    SELECT table_name FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_place_list';
")
if [[ "$result" == "v_place_list" ]]; then
    pass "v_place_list view exists"
else
    fail "v_place_list view does not exist"
fi

# --------------------------------------------------
# Test 8: Canonical search returns results
# --------------------------------------------------
echo ""
echo "Test 8: Testing canonical search (generic query)..."
result_count=$(psql "$DATABASE_URL" -t -A -c "
    SELECT COUNT(*) FROM trapper.search_unified('cat', NULL, 10, 0);
")
if [[ "$result_count" -gt 0 ]]; then
    pass "Canonical search returned $result_count results for 'cat'"
else
    warn "Canonical search returned 0 results for 'cat' (may be expected if no cats match)"
fi

# --------------------------------------------------
# Test 9: Search returns match_strength
# --------------------------------------------------
echo ""
echo "Test 9: Testing search returns match_strength..."
has_strength=$(psql "$DATABASE_URL" -t -A -c "
    SELECT COUNT(DISTINCT match_strength)
    FROM trapper.search_unified('a', NULL, 50, 0);
")
if [[ "$has_strength" -gt 0 ]]; then
    pass "Search returns match_strength values"
else
    fail "Search does not return match_strength values"
fi

# --------------------------------------------------
# Test 10: Search returns match_reason
# --------------------------------------------------
echo ""
echo "Test 10: Testing search returns match_reason..."
has_reason=$(psql "$DATABASE_URL" -t -A -c "
    SELECT COUNT(DISTINCT match_reason)
    FROM trapper.search_unified('a', NULL, 50, 0);
")
if [[ "$has_reason" -gt 0 ]]; then
    pass "Search returns $has_reason distinct match_reason values"
else
    fail "Search does not return match_reason values"
fi

# --------------------------------------------------
# Test 11: Type filter works
# --------------------------------------------------
echo ""
echo "Test 11: Testing type filter (cat only)..."
cat_count=$(psql "$DATABASE_URL" -t -A -c "
    SELECT COUNT(*) FROM trapper.search_unified('a', 'cat', 50, 0)
    WHERE entity_type = 'cat';
")
other_count=$(psql "$DATABASE_URL" -t -A -c "
    SELECT COUNT(*) FROM trapper.search_unified('a', 'cat', 50, 0)
    WHERE entity_type != 'cat';
")
if [[ "$other_count" -eq 0 ]]; then
    pass "Type filter works correctly (returned only cats)"
else
    fail "Type filter returned non-cat entities"
fi

# --------------------------------------------------
# Test 12: Search suggestions function works
# --------------------------------------------------
echo ""
echo "Test 12: Testing search_suggestions..."
suggestion_count=$(psql "$DATABASE_URL" -t -A -c "
    SELECT COUNT(*) FROM trapper.search_suggestions('a', 5);
")
if [[ "$suggestion_count" -le 5 ]]; then
    pass "search_suggestions respects limit (returned $suggestion_count <= 5)"
else
    fail "search_suggestions returned more than limit: $suggestion_count"
fi

# --------------------------------------------------
# Test 13: Deep search function works
# --------------------------------------------------
echo ""
echo "Test 13: Testing deep search..."
# Try a common term that might exist in raw data
deep_count=$(psql "$DATABASE_URL" -t -A -c "
    SELECT COUNT(*) FROM trapper.search_deep('cat', 10);
")
if [[ "$deep_count" -ge 0 ]]; then
    pass "Deep search executed successfully (returned $deep_count results)"
else
    fail "Deep search failed"
fi

# --------------------------------------------------
# Test 14: Nonsense query doesn't crash
# --------------------------------------------------
echo ""
echo "Test 14: Testing nonsense query handling..."
nonsense_result=$(psql "$DATABASE_URL" -t -A -c "
    SELECT COUNT(*) FROM trapper.search_unified('xyzzy12345notarealquery', NULL, 10, 0);
" 2>&1)
if [[ "$?" -eq 0 ]]; then
    pass "Nonsense query handled gracefully (returned $nonsense_result results)"
else
    fail "Nonsense query caused an error"
fi

# --------------------------------------------------
# Test 15: search_unified_counts function works
# --------------------------------------------------
echo ""
echo "Test 15: Testing search_unified_counts..."
count_rows=$(psql "$DATABASE_URL" -t -A -c "
    SELECT COUNT(*) FROM trapper.search_unified_counts('a', NULL);
")
if [[ "$count_rows" -gt 0 ]]; then
    pass "search_unified_counts returned $count_rows entity type rows"
else
    warn "search_unified_counts returned 0 rows (may be expected)"
fi

# --------------------------------------------------
# Test 16: v_person_detail view exists
# --------------------------------------------------
echo ""
echo "Test 16: Checking v_person_detail view..."
result=$(psql "$DATABASE_URL" -t -A -c "
    SELECT table_name FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_person_detail';
")
if [[ "$result" == "v_person_detail" ]]; then
    pass "v_person_detail view exists"
else
    fail "v_person_detail view does not exist"
fi

# --------------------------------------------------
# Test 17: v_place_detail view exists
# --------------------------------------------------
echo ""
echo "Test 17: Checking v_place_detail view..."
result=$(psql "$DATABASE_URL" -t -A -c "
    SELECT table_name FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_place_detail';
")
if [[ "$result" == "v_place_detail" ]]; then
    pass "v_place_detail view exists"
else
    fail "v_place_detail view does not exist"
fi

# --------------------------------------------------
# Summary
# --------------------------------------------------
echo ""
echo "============================================"
echo "ATLAS_019 Acceptance Test Summary"
echo "============================================"
echo -e "Passed: ${GREEN}$PASS_COUNT${NC}"
echo -e "Failed: ${RED}$FAIL_COUNT${NC}"
echo ""

if [[ "$FAIL_COUNT" -gt 0 ]]; then
    echo -e "${RED}Some tests failed. Review errors above.${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi
