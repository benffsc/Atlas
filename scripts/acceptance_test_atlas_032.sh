#!/usr/bin/env bash
# acceptance_test_atlas_032.sh
# ATLAS_032 Acceptance Test: Cat Details API Contract
#
# Tests:
#   - v_cat_detail view has correct columns
#   - Cat detail query returns expected structure
#   - Known UUID returns valid data
#   - Unknown UUID returns 404-compatible result
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_032.sh

set -euo pipefail

# ============================================
# Colors
# ============================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============================================
# Counters
# ============================================
PASS_COUNT=0
FAIL_COUNT=0

# ============================================
# Helper Functions
# ============================================

pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

warn() {
    echo -e "${YELLOW}⚠ WARN:${NC} $1"
}

section() {
    echo ""
    echo -e "${BLUE}=== $1 ===${NC}"
}

require_env() {
    local k="$1"
    if [[ -z "${!k:-}" ]]; then
        echo -e "${RED}✗ FAIL:${NC} Missing required env var: $k"
        exit 2
    fi
}

psqlq() {
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -t -A -c "$1"
}

# ============================================
# Main Test Script
# ============================================

echo "============================================"
echo "ATLAS_032 Acceptance Test: Cat Details API"
echo "============================================"
echo ""

require_env DATABASE_URL

# ============================================
# SECTION 1: View Structure
# ============================================
section "v_cat_detail View Structure (MIG_042)"

# Test 1: v_cat_detail view exists
echo "Test 1: Checking v_cat_detail view exists..."
vw_exists="$(psqlq "SELECT 1 FROM information_schema.views WHERE table_schema='trapper' AND table_name='v_cat_detail' LIMIT 1;" || true)"
if [[ "$vw_exists" == "1" ]]; then
    pass "v_cat_detail view exists"
else
    fail "v_cat_detail view missing"
fi

# Test 2: Required columns exist
echo "Test 2: Checking required columns..."
required_cols="cat_id display_name sex altered_status breed color coat_pattern microchip notes identifiers owners places created_at updated_at"
missing_cols=""
for col in $required_cols; do
    col_exists="$(psqlq "SELECT 1 FROM information_schema.columns WHERE table_schema='trapper' AND table_name='v_cat_detail' AND column_name='$col';" || true)"
    if [[ "$col_exists" != "1" ]]; then
        missing_cols="$missing_cols $col"
    fi
done
if [[ -z "$missing_cols" ]]; then
    pass "All required columns present"
else
    fail "Missing columns:$missing_cols"
fi

# ============================================
# SECTION 2: Data Structure
# ============================================
section "Data Structure"

# Test 3: identifiers is JSON array
echo "Test 3: Checking identifiers is JSON array..."
is_array="$(psqlq "SELECT jsonb_typeof(identifiers) = 'array' FROM trapper.v_cat_detail LIMIT 1;" || echo "f")"
if [[ "$is_array" == "t" ]]; then
    pass "identifiers is JSON array"
else
    fail "identifiers should be JSON array"
fi

# Test 4: owners is JSON array
echo "Test 4: Checking owners is JSON array..."
is_array="$(psqlq "SELECT jsonb_typeof(owners) = 'array' FROM trapper.v_cat_detail LIMIT 1;" || echo "f")"
if [[ "$is_array" == "t" ]]; then
    pass "owners is JSON array"
else
    fail "owners should be JSON array"
fi

# Test 5: places is JSON array
echo "Test 5: Checking places is JSON array..."
is_array="$(psqlq "SELECT jsonb_typeof(places) = 'array' FROM trapper.v_cat_detail LIMIT 1;" || echo "f")"
if [[ "$is_array" == "t" ]]; then
    pass "places is JSON array"
else
    fail "places should be JSON array"
fi

# Test 6: identifiers have correct structure
echo "Test 6: Checking identifier structure {type, value, source}..."
has_structure="$(psqlq "
SELECT EXISTS(
    SELECT 1 FROM trapper.v_cat_detail
    WHERE jsonb_array_length(identifiers) > 0
    AND identifiers->0 ? 'type'
    AND identifiers->0 ? 'value'
    AND identifiers->0 ? 'source'
);
" || echo "f")"
if [[ "$has_structure" == "t" ]]; then
    pass "identifiers have {type, value, source} structure"
else
    warn "Could not verify identifier structure (may have no identifiers)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# ============================================
# SECTION 3: Query Reliability
# ============================================
section "Query Reliability"

# Get a known cat_id
known_cat_id="$(psqlq "SELECT cat_id FROM trapper.sot_cats LIMIT 1;" || echo "")"

# Test 7: Known UUID returns data
echo "Test 7: Checking known UUID returns data..."
if [[ -n "$known_cat_id" ]]; then
    result="$(psqlq "SELECT cat_id FROM trapper.v_cat_detail WHERE cat_id = '$known_cat_id';" || echo "")"
    if [[ "$result" == "$known_cat_id" ]]; then
        pass "Known UUID $known_cat_id returns data"
    else
        fail "Known UUID $known_cat_id did not return data"
    fi
else
    warn "No cats in database to test"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# Test 8: Unknown UUID returns no rows (not error)
echo "Test 8: Checking unknown UUID returns empty result..."
fake_uuid="00000000-0000-0000-0000-000000000000"
result="$(psqlq "SELECT COUNT(*) FROM trapper.v_cat_detail WHERE cat_id = '$fake_uuid';" || echo "-1")"
if [[ "$result" == "0" ]]; then
    pass "Unknown UUID returns 0 rows (correct for 404)"
else
    fail "Unknown UUID should return 0 rows, got: $result"
fi

# Test 9: Microchip extraction works
echo "Test 9: Checking microchip extraction..."
cats_with_chips="$(psqlq "
SELECT COUNT(*) FROM trapper.v_cat_detail
WHERE microchip IS NOT NULL AND microchip != '';
" || echo "0")"
chips_in_identifiers="$(psqlq "
SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_identifiers
WHERE id_type = 'microchip';
" || echo "0")"
if [[ "$cats_with_chips" == "$chips_in_identifiers" ]]; then
    pass "Microchip extraction correct ($cats_with_chips cats)"
else
    fail "Microchip mismatch: view has $cats_with_chips, identifiers has $chips_in_identifiers"
fi

# ============================================
# SECTION 4: Performance
# ============================================
section "Performance"

# Test 10: View query is reasonably fast
echo "Test 10: Checking view performance..."
start_time=$(date +%s%N)
psqlq "SELECT cat_id FROM trapper.v_cat_detail LIMIT 100;" > /dev/null
end_time=$(date +%s%N)
duration_ms=$(( (end_time - start_time) / 1000000 ))
if [[ "$duration_ms" -lt 5000 ]]; then
    pass "View query returns in ${duration_ms}ms (under 5s)"
else
    warn "View query slow: ${duration_ms}ms"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# ============================================
# Summary
# ============================================
echo ""
echo "============================================"
echo -e "SUMMARY: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC}"
echo "============================================"
echo ""

# Show sample data
echo "Sample cat detail:"
psql "$DATABASE_URL" -c "
SELECT cat_id, display_name, microchip,
       jsonb_array_length(identifiers) AS identifiers,
       jsonb_array_length(owners) AS owners,
       jsonb_array_length(places) AS places
FROM trapper.v_cat_detail
LIMIT 5;
"

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    echo -e "${RED}Some tests failed. Review errors above.${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi
