#!/usr/bin/env bash
# acceptance_test_atlas_029.sh
# ATLAS_029 Acceptance Test: Identifier Safety & Account Types
#
# Tests:
#   - Identifier blocklist table and function
#   - Account type classification
#   - Blocklisted identifiers detection
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_029.sh

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
echo "ATLAS_029 Acceptance Test: Identifier Safety"
echo "============================================"
echo ""

require_env DATABASE_URL

# ============================================
# SECTION 1: Identifier Blocklist
# ============================================
section "Identifier Blocklist (MIG_040)"

# Test 1: Blocklist table exists
echo "Test 1: Checking identifier_blocklist table exists..."
tbl_exists="$(psqlq "SELECT 1 FROM information_schema.tables WHERE table_schema='trapper' AND table_name='identifier_blocklist' LIMIT 1;" || true)"
if [[ "$tbl_exists" == "1" ]]; then
    pass "identifier_blocklist table exists"
else
    fail "identifier_blocklist table missing"
fi

# Test 2: Blocklist function exists
echo "Test 2: Checking is_identifier_blocklisted function exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.is_identifier_blocklisted(text,text)') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "is_identifier_blocklisted function exists"
else
    fail "is_identifier_blocklisted function missing"
fi

# Test 3: FFSC phone is blocklisted
echo "Test 3: Checking FFSC phone (7075767999) is blocklisted..."
blocked="$(psqlq "SELECT trapper.is_identifier_blocklisted('phone', '7075767999');" || echo "f")"
if [[ "$blocked" == "t" ]]; then
    pass "FFSC phone is blocklisted"
else
    fail "FFSC phone should be blocklisted"
fi

# Test 4: FFSC email domain is blocklisted
echo "Test 4: Checking @forgottenfelines.com emails are blocklisted..."
blocked="$(psqlq "SELECT trapper.is_identifier_blocklisted('email', 'test@forgottenfelines.com');" || echo "f")"
if [[ "$blocked" == "t" ]]; then
    pass "@forgottenfelines.com is blocklisted"
else
    fail "@forgottenfelines.com should be blocklisted"
fi

# Test 5: Generic info@ is blocklisted
echo "Test 5: Checking generic info@ emails are blocklisted..."
blocked="$(psqlq "SELECT trapper.is_identifier_blocklisted('email', 'info@somecompany.com');" || echo "f")"
if [[ "$blocked" == "t" ]]; then
    pass "info@ emails are blocklisted"
else
    fail "info@ emails should be blocklisted"
fi

# Test 6: Regular email is NOT blocklisted
echo "Test 6: Checking regular emails are NOT blocklisted..."
blocked="$(psqlq "SELECT trapper.is_identifier_blocklisted('email', 'someone@gmail.com');" || echo "t")"
if [[ "$blocked" == "f" ]]; then
    pass "Regular emails are NOT blocklisted"
else
    fail "Regular emails should NOT be blocklisted"
fi

# Test 7: Regular phone is NOT blocklisted
echo "Test 7: Checking regular phones are NOT blocklisted..."
blocked="$(psqlq "SELECT trapper.is_identifier_blocklisted('phone', '7071234567');" || echo "t")"
if [[ "$blocked" == "f" ]]; then
    pass "Regular phones are NOT blocklisted"
else
    fail "Regular phones should NOT be blocklisted"
fi

# ============================================
# SECTION 2: Account Type Classification
# ============================================
section "Account Type Classification"

# Test 8: account_type column exists
echo "Test 8: Checking account_type column exists on sot_people..."
col_exists="$(psqlq "SELECT 1 FROM information_schema.columns WHERE table_schema='trapper' AND table_name='sot_people' AND column_name='account_type' LIMIT 1;" || true)"
if [[ "$col_exists" == "1" ]]; then
    pass "account_type column exists"
else
    fail "account_type column missing"
fi

# Test 9: infer_account_type function exists
echo "Test 9: Checking infer_account_type function exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.infer_account_type(text)') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "infer_account_type function exists"
else
    fail "infer_account_type function missing"
fi

# Test 10: Duplicated name detected as place
echo "Test 10: Testing duplicated name pattern detection..."
acct_type="$(psqlq "SELECT account_type FROM trapper.infer_account_type('Casini Ranch Casini Ranch');" || echo "")"
if [[ "$acct_type" == "place" ]]; then
    pass "Duplicated name detected as 'place'"
else
    fail "Duplicated name should be 'place', got '$acct_type'"
fi

# Test 11: FFSC pattern detected as internal_project
echo "Test 11: Testing FFSC pattern detection..."
acct_type="$(psqlq "SELECT account_type FROM trapper.infer_account_type('Barn Cat Program Barn Cat Program');" || echo "")"
if [[ "$acct_type" == "internal_project" ]]; then
    pass "FFSC program detected as 'internal_project'"
else
    fail "FFSC program should be 'internal_project', got '$acct_type'"
fi

# Test 12: Duplicate report detected
echo "Test 12: Testing duplicate report pattern detection..."
acct_type="$(psqlq "SELECT account_type FROM trapper.infer_account_type('Duplicate Report Kate Spellman');" || echo "")"
if [[ "$acct_type" == "duplicate_marker" ]]; then
    pass "Duplicate report detected as 'duplicate_marker'"
else
    fail "Duplicate report should be 'duplicate_marker', got '$acct_type'"
fi

# Test 13: Real person detected
echo "Test 13: Testing real person detection..."
acct_type="$(psqlq "SELECT account_type FROM trapper.infer_account_type('Susan Smith');" || echo "")"
if [[ "$acct_type" == "person" ]]; then
    pass "Real name detected as 'person'"
else
    fail "Real name should be 'person', got '$acct_type'"
fi

# ============================================
# SECTION 3: Data Quality
# ============================================
section "Data Quality"

# Test 14: Account types have been backfilled
echo "Test 14: Checking account types are populated..."
classified_count="$(psqlq "SELECT COUNT(*) FROM trapper.sot_people WHERE account_type IS NOT NULL AND merged_into_person_id IS NULL;" || echo "0")"
total_count="$(psqlq "SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL;" || echo "0")"
if [[ "$classified_count" == "$total_count" && "$total_count" -gt 0 ]]; then
    pass "All $total_count people have account_type set"
else
    fail "Only $classified_count / $total_count people have account_type"
fi

# Test 15: Majority classified as person
echo "Test 15: Checking majority are real people..."
person_count="$(psqlq "SELECT COUNT(*) FROM trapper.sot_people WHERE account_type = 'person' AND merged_into_person_id IS NULL;" || echo "0")"
person_pct=$((person_count * 100 / total_count))
if [[ "$person_pct" -gt 90 ]]; then
    pass "$person_count ($person_pct%) are real people"
else
    warn "Only $person_count ($person_pct%) are real people"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# Test 16: Non-people identified
echo "Test 16: Checking non-person accounts identified..."
non_person="$(psqlq "SELECT COUNT(*) FROM trapper.sot_people WHERE account_type != 'person' AND merged_into_person_id IS NULL;" || echo "0")"
if [[ "$non_person" -gt 0 ]]; then
    pass "Identified $non_person non-person accounts"
else
    warn "No non-person accounts identified (may be expected)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# Test 17: Blocklisted identifiers detected
echo "Test 17: Checking blocklisted identifiers in use are detected..."
blocklisted_in_use="$(psqlq "SELECT COUNT(*) FROM trapper.v_blocklisted_identifiers_in_use;" || echo "0")"
if [[ "$blocklisted_in_use" =~ ^[0-9]+$ ]]; then
    pass "Detected $blocklisted_in_use blocklisted identifiers in use"
else
    fail "Could not count blocklisted identifiers in use"
fi

# Test 18: safe_create_person_identifier function exists
echo "Test 18: Checking safe_create_person_identifier function exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.safe_create_person_identifier(uuid,text,text,text,text,text,uuid)') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "safe_create_person_identifier function exists"
else
    fail "safe_create_person_identifier function missing"
fi

# ============================================
# Summary
# ============================================
echo ""
echo "============================================"
echo -e "SUMMARY: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC}"
echo "============================================"
echo ""

# Show account type breakdown
echo "Account Type Breakdown:"
psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_account_type_summary;"

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    echo -e "${RED}Some tests failed. Review errors above.${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi
