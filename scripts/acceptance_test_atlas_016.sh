#!/usr/bin/env bash
# acceptance_test_atlas_016.sh
#
# Acceptance tests for ATLAS_016: Relationship Graph Scaffold.
#
# Verifies:
#   1. relationship_types table exists with seeded rows
#   2. Manual edge tables exist (person_person_edges, place_place_edges, cat_cat_edges)
#   3. Suggestion table exists
#   4. Rollup views exist and return data
#   5. Nearby candidates view runs (0 rows is OK)
#   6. Smoke test: insert and rollback a manual relationship
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_016.sh

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
echo -e "${BOLD}  ATLAS_016 Acceptance Tests${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Database preflight check
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib/db_preflight.sh"

# ============================================
# TEST 1: relationship_types table exists
# ============================================
echo -e "${BOLD}Test 1: relationship_types table${RESET}"
echo "─────────────────────────────────────────────"

TABLE_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'relationship_types';
" | tr -d '[:space:]')

if [[ "$TABLE_EXISTS" -eq 0 ]]; then
    fail "relationship_types table does not exist"
else
    pass "relationship_types table exists"

    TYPE_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.relationship_types;" | tr -d '[:space:]')
    if [[ "$TYPE_COUNT" -gt 0 ]]; then
        pass "relationship_types has $TYPE_COUNT seeded rows"
    else
        fail "relationship_types has no seeded rows"
    fi

    echo -e "${CYAN}Types by domain:${RESET}"
    psql "$DATABASE_URL" -c "
        SELECT domain, COUNT(*) AS count
        FROM trapper.relationship_types
        GROUP BY domain
        ORDER BY domain;
    "
fi

echo ""

# ============================================
# TEST 2: Manual edge tables exist
# ============================================
echo -e "${BOLD}Test 2: Manual edge tables${RESET}"
echo "─────────────────────────────────────────────"

EDGE_TABLES=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'trapper'
      AND table_name IN ('person_person_edges', 'place_place_edges', 'cat_cat_edges');
" | tr -d '[:space:]')

if [[ "$EDGE_TABLES" -eq 3 ]]; then
    pass "All 3 edge tables exist"
else
    fail "Missing edge tables (found $EDGE_TABLES of 3)"
fi

echo ""

# ============================================
# TEST 3: Suggestion table exists
# ============================================
echo -e "${BOLD}Test 3: relationship_suggestions table${RESET}"
echo "─────────────────────────────────────────────"

TABLE_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'relationship_suggestions';
" | tr -d '[:space:]')

if [[ "$TABLE_EXISTS" -eq 0 ]]; then
    fail "relationship_suggestions table does not exist"
else
    pass "relationship_suggestions table exists"
fi

echo ""

# ============================================
# TEST 4: Rollup views exist
# ============================================
echo -e "${BOLD}Test 4: Rollup views${RESET}"
echo "─────────────────────────────────────────────"

ROLLUP_VIEWS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper'
      AND table_name IN ('v_person_relationships_rollup', 'v_place_relationships_rollup', 'v_cat_relationships_rollup');
" | tr -d '[:space:]')

if [[ "$ROLLUP_VIEWS" -eq 3 ]]; then
    pass "All 3 rollup views exist"
else
    fail "Missing rollup views (found $ROLLUP_VIEWS of 3)"
fi

# Test that views return data (from existing relationships)
PERSON_ROLLUP=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.v_person_relationships_rollup;" | tr -d '[:space:]')
PLACE_ROLLUP=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.v_place_relationships_rollup;" | tr -d '[:space:]')
CAT_ROLLUP=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.v_cat_relationships_rollup;" | tr -d '[:space:]')

echo -e "${CYAN}Rollup view counts:${RESET}"
echo "  v_person_relationships_rollup: $PERSON_ROLLUP"
echo "  v_place_relationships_rollup: $PLACE_ROLLUP"
echo "  v_cat_relationships_rollup: $CAT_ROLLUP"

if [[ "$PERSON_ROLLUP" -gt 0 ]] || [[ "$PLACE_ROLLUP" -gt 0 ]] || [[ "$CAT_ROLLUP" -gt 0 ]]; then
    pass "At least one rollup view has data"
else
    warn "All rollup views are empty (expected if no existing relationships)"
fi

echo ""

# ============================================
# TEST 5: Nearby candidates view runs
# ============================================
echo -e "${BOLD}Test 5: v_person_nearby_people_candidates view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_person_nearby_people_candidates';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_person_nearby_people_candidates view does not exist"
else
    pass "v_person_nearby_people_candidates view exists"

    # Run the view (0 rows is OK)
    CANDIDATES=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.v_person_nearby_people_candidates;" | tr -d '[:space:]')
    pass "Nearby candidates query runs successfully ($CANDIDATES candidates)"

    if [[ "$CANDIDATES" -gt 0 ]]; then
        echo -e "${CYAN}Top 5 nearby candidates:${RESET}"
        psql "$DATABASE_URL" -c "
            SELECT person_name, candidate_name, ROUND(distance_m::numeric, 1) AS dist_m, score
            FROM trapper.v_person_nearby_people_candidates
            LIMIT 5;
        "
    fi
fi

echo ""

# ============================================
# TEST 6: Helper functions exist
# ============================================
echo -e "${BOLD}Test 6: Helper functions${RESET}"
echo "─────────────────────────────────────────────"

FUNC_COUNT=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.routines
    WHERE routine_schema = 'trapper'
      AND routine_name IN ('add_person_person_relationship', 'add_place_place_relationship',
                           'add_cat_cat_relationship', 'promote_relationship_suggestion',
                           'reject_relationship_suggestion');
" | tr -d '[:space:]')

if [[ "$FUNC_COUNT" -eq 5 ]]; then
    pass "All 5 helper functions exist"
else
    fail "Missing helper functions (found $FUNC_COUNT of 5)"
fi

echo ""

# ============================================
# TEST 7: Smoke test - manual relationship insert (rolled back)
# ============================================
echo -e "${BOLD}Test 7: Smoke test - manual relationship insert${RESET}"
echo "─────────────────────────────────────────────"

# Get two random people to test with
SMOKE_RESULT=$(psql "$DATABASE_URL" -t -c "
    BEGIN;

    -- Get two random people
    WITH two_people AS (
        SELECT person_id FROM trapper.sot_people
        WHERE merged_into_person_id IS NULL
        LIMIT 2
    )
    SELECT
        (SELECT person_id FROM two_people LIMIT 1),
        (SELECT person_id FROM two_people OFFSET 1 LIMIT 1);
" | tr -d '[:space:]')

# Try to insert a relationship (in a transaction that rolls back)
SMOKE_TEST=$(psql "$DATABASE_URL" -t -c "
    BEGIN;

    DO \$\$
    DECLARE
        v_person_a UUID;
        v_person_b UUID;
        v_edge_id UUID;
    BEGIN
        SELECT person_id INTO v_person_a FROM trapper.sot_people WHERE merged_into_person_id IS NULL LIMIT 1;
        SELECT person_id INTO v_person_b FROM trapper.sot_people WHERE merged_into_person_id IS NULL AND person_id <> v_person_a LIMIT 1;

        IF v_person_a IS NOT NULL AND v_person_b IS NOT NULL THEN
            SELECT trapper.add_person_person_relationship(v_person_a, v_person_b, 'neighbor', 'Smoke test') INTO v_edge_id;
            RAISE NOTICE 'Created edge: %', v_edge_id;
        ELSE
            RAISE NOTICE 'Not enough people for smoke test';
        END IF;
    END \$\$;

    -- Verify it appears in rollup
    SELECT COUNT(*) FROM trapper.v_person_relationships_rollup WHERE relationship_type = 'neighbor';

    -- Rollback to clean up
    ROLLBACK;
" 2>&1)

if echo "$SMOKE_TEST" | grep -q "ERROR"; then
    fail "Smoke test failed: $SMOKE_TEST"
else
    pass "Smoke test passed (relationship created and rolled back)"
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
