#!/usr/bin/env bash
# acceptance_test_atlas_012.sh
#
# Acceptance tests for ATLAS_012: Canonical Cats Layer.
#
# Verifies:
#   1. sot_cats count > 0
#   2. cat_identifiers count > 0
#   3. person_cat_relationships count >= 0 (warn if 0)
#   4. v_cats_unified view exists and returns rows
#   5. v_people_with_cats view exists
#   6. v_cats_stats view returns valid stats
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_012.sh

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
echo -e "${BOLD}  ATLAS_012 Acceptance Tests${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Database preflight check
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib/db_preflight.sh"

# ============================================
# TEST 1: sot_cats table exists and has rows
# ============================================
echo -e "${BOLD}Test 1: sot_cats populated${RESET}"
echo "─────────────────────────────────────────────"

TABLE_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'sot_cats';
" | tr -d '[:space:]')

if [[ "$TABLE_EXISTS" -eq 0 ]]; then
    fail "sot_cats table does not exist"
else
    pass "sot_cats table exists"

    CATS_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.sot_cats;" | tr -d '[:space:]')
    if [[ "$CATS_COUNT" -gt 0 ]]; then
        pass "sot_cats has $CATS_COUNT records"
    else
        fail "sot_cats has 0 records"
    fi
fi

echo ""

# ============================================
# TEST 2: cat_identifiers populated
# ============================================
echo -e "${BOLD}Test 2: cat_identifiers populated${RESET}"
echo "─────────────────────────────────────────────"

TABLE_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'cat_identifiers';
" | tr -d '[:space:]')

if [[ "$TABLE_EXISTS" -eq 0 ]]; then
    fail "cat_identifiers table does not exist"
else
    pass "cat_identifiers table exists"

    IDENTS_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.cat_identifiers;" | tr -d '[:space:]')
    if [[ "$IDENTS_COUNT" -gt 0 ]]; then
        pass "cat_identifiers has $IDENTS_COUNT records"
    else
        fail "cat_identifiers has 0 records"
    fi

    # Check identifier types
    echo -e "${CYAN}Identifier types:${RESET}"
    psql "$DATABASE_URL" -c "
        SELECT id_type, COUNT(*) AS count
        FROM trapper.cat_identifiers
        GROUP BY 1
        ORDER BY 2 DESC;
    "
fi

echo ""

# ============================================
# TEST 3: person_cat_relationships
# ============================================
echo -e "${BOLD}Test 3: person_cat_relationships${RESET}"
echo "─────────────────────────────────────────────"

TABLE_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'person_cat_relationships';
" | tr -d '[:space:]')

if [[ "$TABLE_EXISTS" -eq 0 ]]; then
    fail "person_cat_relationships table does not exist"
else
    pass "person_cat_relationships table exists"

    RELS_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.person_cat_relationships;" | tr -d '[:space:]')
    if [[ "$RELS_COUNT" -gt 0 ]]; then
        pass "person_cat_relationships has $RELS_COUNT records"
    else
        warn "person_cat_relationships has 0 records (owner links may need identity resolution first)"
    fi
fi

echo ""

# ============================================
# TEST 4: v_cats_unified view
# ============================================
echo -e "${BOLD}Test 4: v_cats_unified view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_cats_unified';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_cats_unified view does not exist"
else
    pass "v_cats_unified view exists"

    VIEW_ROWS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.v_cats_unified;" | tr -d '[:space:]')
    if [[ "$VIEW_ROWS" -gt 0 ]]; then
        pass "v_cats_unified returns $VIEW_ROWS rows"
    else
        fail "v_cats_unified returns 0 rows"
    fi
fi

echo ""

# ============================================
# TEST 5: v_people_with_cats view
# ============================================
echo -e "${BOLD}Test 5: v_people_with_cats view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_people_with_cats';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_people_with_cats view does not exist"
else
    pass "v_people_with_cats view exists"

    PEOPLE_WITH_CATS=$(psql "$DATABASE_URL" -t -c "
        SELECT COUNT(*) FROM trapper.v_people_with_cats WHERE cat_count > 0;
    " | tr -d '[:space:]')
    if [[ "$PEOPLE_WITH_CATS" -gt 0 ]]; then
        pass "v_people_with_cats shows $PEOPLE_WITH_CATS people with cats"
    else
        warn "v_people_with_cats shows 0 people with cats"
    fi
fi

echo ""

# ============================================
# TEST 6: v_cats_stats view
# ============================================
echo -e "${BOLD}Test 6: v_cats_stats view${RESET}"
echo "─────────────────────────────────────────────"

VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_cats_stats';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    fail "v_cats_stats view does not exist"
else
    pass "v_cats_stats view exists"

    echo -e "${CYAN}Cat layer stats:${RESET}"
    psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_cats_stats;"
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
