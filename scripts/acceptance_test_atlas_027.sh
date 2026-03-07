#!/usr/bin/env bash
# DEPRECATED: v1 acceptance test. References trapper.* schema dropped in MIG_2299. Do not run.
# acceptance_test_atlas_027.sh
# ATLAS_027 Acceptance Test: Entity Resolution V2
#
# Tests:
#   - Address registry enhancements (precision, last_geocoded_at)
#   - Place significance and kind classification
#   - Person phonetic matching (metaphone)
#   - Cat fuzzy matching (review queue)
#   - Unified match workflow
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_027.sh

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
echo "ATLAS_027 Acceptance Test: Entity Resolution V2"
echo "============================================"
echo ""

require_env DATABASE_URL

# ============================================
# SECTION 1: Address Registry Enhancements
# ============================================
section "Address Registry (MIG_033)"

# Test 1: precision column exists
echo "Test 1: Checking precision column exists..."
col_exists="$(psqlq "SELECT 1 FROM information_schema.columns WHERE table_schema='trapper' AND table_name='sot_addresses' AND column_name='precision' LIMIT 1;" || true)"
if [[ "$col_exists" == "1" ]]; then
    pass "precision column exists in sot_addresses"
else
    fail "precision column missing from sot_addresses"
fi

# Test 2: last_geocoded_at column exists
echo "Test 2: Checking last_geocoded_at column exists..."
col_exists="$(psqlq "SELECT 1 FROM information_schema.columns WHERE table_schema='trapper' AND table_name='sot_addresses' AND column_name='last_geocoded_at' LIMIT 1;" || true)"
if [[ "$col_exists" == "1" ]]; then
    pass "last_geocoded_at column exists in sot_addresses"
else
    fail "last_geocoded_at column missing from sot_addresses"
fi

# Test 3: find_nearby_addresses function exists
echo "Test 3: Checking find_nearby_addresses function exists..."
fn_exists="$(psqlq "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='trapper' AND p.proname='find_nearby_addresses' LIMIT 1;" || true)"
if [[ "$fn_exists" == "1" ]]; then
    pass "find_nearby_addresses function exists"
else
    fail "find_nearby_addresses function missing"
fi

# Test 4: address_match_score function exists
echo "Test 4: Checking address_match_score function exists..."
fn_exists="$(psqlq "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='trapper' AND p.proname='address_match_score' LIMIT 1;" || true)"
if [[ "$fn_exists" == "1" ]]; then
    pass "address_match_score function exists"
else
    fail "address_match_score function missing"
fi

# Test 5: Precision values are populated
echo "Test 5: Checking precision values are populated..."
precision_count="$(psqlq "SELECT COUNT(*) FROM trapper.sot_addresses WHERE precision IS NOT NULL;" || echo "0")"
if [[ "$precision_count" =~ ^[0-9]+$ ]] && [[ "$precision_count" -gt 0 ]]; then
    pass "Precision populated for $precision_count addresses"
else
    fail "No addresses have precision values"
fi

# ============================================
# SECTION 2: Place Significance (MIG_034)
# ============================================
section "Place Significance (MIG_034)"

# Test 6: is_significant column exists
echo "Test 6: Checking is_significant column exists..."
col_exists="$(psqlq "SELECT 1 FROM information_schema.columns WHERE table_schema='trapper' AND table_name='places' AND column_name='is_significant' LIMIT 1;" || true)"
if [[ "$col_exists" == "1" ]]; then
    pass "is_significant column exists in places"
else
    fail "is_significant column missing from places"
fi

# Test 7: activity_score column exists
echo "Test 7: Checking activity_score column exists..."
col_exists="$(psqlq "SELECT 1 FROM information_schema.columns WHERE table_schema='trapper' AND table_name='places' AND column_name='activity_score' LIMIT 1;" || true)"
if [[ "$col_exists" == "1" ]]; then
    pass "activity_score column exists in places"
else
    fail "activity_score column missing from places"
fi

# Test 8: is_business_like_name function exists
echo "Test 8: Checking is_business_like_name function exists..."
fn_exists="$(psqlq "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='trapper' AND p.proname='is_business_like_name' LIMIT 1;" || true)"
if [[ "$fn_exists" == "1" ]]; then
    pass "is_business_like_name function exists"
else
    fail "is_business_like_name function missing"
fi

# Test 9: infer_place_significance function exists
echo "Test 9: Checking infer_place_significance function exists..."
fn_exists="$(psqlq "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='trapper' AND p.proname='infer_place_significance' LIMIT 1;" || true)"
if [[ "$fn_exists" == "1" ]]; then
    pass "infer_place_significance function exists"
else
    fail "infer_place_significance function missing"
fi

# Test 10: Significant places exist
echo "Test 10: Checking significant places exist..."
sig_count="$(psqlq "SELECT COUNT(*) FROM trapper.places WHERE is_significant = TRUE;" || echo "0")"
if [[ "$sig_count" =~ ^[0-9]+$ ]] && [[ "$sig_count" -gt 0 ]]; then
    pass "Found $sig_count significant places"
else
    warn "No significant places found (may be expected if no activity)"
fi

# ============================================
# SECTION 3: People Phonetic Matching (MIG_035)
# ============================================
section "People Phonetic Matching (MIG_035)"

# Test 11: fuzzystrmatch extension available
echo "Test 11: Checking fuzzystrmatch functions available..."
fn_exists="$(psqlq "SELECT 1 FROM pg_proc WHERE proname='dmetaphone' LIMIT 1;" || true)"
if [[ "$fn_exists" == "1" ]]; then
    pass "dmetaphone function available"
else
    fail "dmetaphone function not available (fuzzystrmatch extension)"
fi

# Test 12: metaphone columns in person_aliases
echo "Test 12: Checking metaphone columns in person_aliases..."
col_exists="$(psqlq "SELECT 1 FROM information_schema.columns WHERE table_schema='trapper' AND table_name='person_aliases' AND column_name='metaphone_first' LIMIT 1;" || true)"
if [[ "$col_exists" == "1" ]]; then
    pass "metaphone_first column exists in person_aliases"
else
    fail "metaphone_first column missing from person_aliases"
fi

# Test 13: encode_name_phonetic function exists
echo "Test 13: Checking encode_name_phonetic function exists..."
fn_exists="$(psqlq "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='trapper' AND p.proname='encode_name_phonetic' LIMIT 1;" || true)"
if [[ "$fn_exists" == "1" ]]; then
    pass "encode_name_phonetic function exists"
else
    fail "encode_name_phonetic function missing"
fi

# Test 14: phonetic_name_similarity function exists
echo "Test 14: Checking phonetic_name_similarity function exists..."
fn_exists="$(psqlq "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='trapper' AND p.proname='phonetic_name_similarity' LIMIT 1;" || true)"
if [[ "$fn_exists" == "1" ]]; then
    pass "phonetic_name_similarity function exists"
else
    fail "phonetic_name_similarity function missing"
fi

# Test 15: Phonetic similarity test (Susan vs Susana)
echo "Test 15: Testing phonetic similarity (Susan Smith vs Susana Smyth)..."
sim_score="$(psqlq "SELECT (trapper.phonetic_name_similarity('Susan Smith', 'Susana Smyth')->>'score')::NUMERIC;" || echo "-1")"
if [[ "$sim_score" =~ ^[0-9.]+$ ]] && (( $(echo "$sim_score > 0.4" | bc -l) )); then
    pass "Phonetic similarity Susan/Susana = $sim_score (> 0.4)"
else
    fail "Phonetic similarity too low: $sim_score"
fi

# Test 16: Metaphone codes populated
echo "Test 16: Checking metaphone codes populated..."
meta_count="$(psqlq "SELECT COUNT(*) FROM trapper.person_aliases WHERE metaphone_first IS NOT NULL;" || echo "0")"
if [[ "$meta_count" =~ ^[0-9]+$ ]] && [[ "$meta_count" -gt 0 ]]; then
    pass "Metaphone codes populated for $meta_count aliases"
else
    fail "No metaphone codes populated"
fi

# Test 17: score_person_match_candidate function exists
echo "Test 17: Checking score_person_match_candidate function exists..."
fn_exists="$(psqlq "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='trapper' AND p.proname='score_person_match_candidate' LIMIT 1;" || true)"
if [[ "$fn_exists" == "1" ]]; then
    pass "score_person_match_candidate function exists"
else
    fail "score_person_match_candidate function missing"
fi

# ============================================
# SECTION 4: Cat Fuzzy Matching (MIG_036)
# ============================================
section "Cat Fuzzy Matching (MIG_036)"

# Test 18: cat_match_candidates table exists
echo "Test 18: Checking cat_match_candidates table exists..."
tbl_exists="$(psqlq "SELECT 1 FROM information_schema.tables WHERE table_schema='trapper' AND table_name='cat_match_candidates' LIMIT 1;" || true)"
if [[ "$tbl_exists" == "1" ]]; then
    pass "cat_match_candidates table exists"
else
    fail "cat_match_candidates table missing"
fi

# Test 19: score_cat_match_candidate function exists
echo "Test 19: Checking score_cat_match_candidate function exists..."
fn_exists="$(psqlq "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='trapper' AND p.proname='score_cat_match_candidate' LIMIT 1;" || true)"
if [[ "$fn_exists" == "1" ]]; then
    pass "score_cat_match_candidate function exists"
else
    fail "score_cat_match_candidate function missing"
fi

# Test 20: generate_cat_match_candidates function exists
echo "Test 20: Checking generate_cat_match_candidates function exists..."
fn_exists="$(psqlq "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='trapper' AND p.proname='generate_cat_match_candidates' LIMIT 1;" || true)"
if [[ "$fn_exists" == "1" ]]; then
    pass "generate_cat_match_candidates function exists"
else
    fail "generate_cat_match_candidates function missing"
fi

# Test 21: Cat auto-merge disabled by default
echo "Test 21: Checking cat auto-merge disabled by default..."
auto_merge="$(psqlq "SELECT config_value FROM trapper.entity_match_config WHERE entity_type='cat' AND config_key='enable_auto_merge';" || echo "-1")"
if [[ "$auto_merge" == "0" ]]; then
    pass "Cat auto-merge disabled (enable_auto_merge = 0)"
else
    fail "Cat auto-merge should be disabled by default, got: $auto_merge"
fi

# ============================================
# SECTION 5: Unified Match Workflow (MIG_037)
# ============================================
section "Unified Match Workflow (MIG_037)"

# Test 22: generate_match_candidates function exists
echo "Test 22: Checking generate_match_candidates function exists..."
fn_exists="$(psqlq "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='trapper' AND p.proname='generate_match_candidates' LIMIT 1;" || true)"
if [[ "$fn_exists" == "1" ]]; then
    pass "generate_match_candidates function exists"
else
    fail "generate_match_candidates function missing"
fi

# Test 23: v_match_review_queue view exists
echo "Test 23: Checking v_match_review_queue view exists..."
vw_exists="$(psqlq "SELECT 1 FROM information_schema.views WHERE table_schema='trapper' AND table_name='v_match_review_queue' LIMIT 1;" || true)"
if [[ "$vw_exists" == "1" ]]; then
    pass "v_match_review_queue view exists"
else
    fail "v_match_review_queue view missing"
fi

# Test 24: v_entity_resolution_stats view exists
echo "Test 24: Checking v_entity_resolution_stats view exists..."
vw_exists="$(psqlq "SELECT 1 FROM information_schema.views WHERE table_schema='trapper' AND table_name='v_entity_resolution_stats' LIMIT 1;" || true)"
if [[ "$vw_exists" == "1" ]]; then
    pass "v_entity_resolution_stats view exists"
else
    fail "v_entity_resolution_stats view missing"
fi

# Test 25: search_places_with_significance function exists
echo "Test 25: Checking search_places_with_significance function exists..."
fn_exists="$(psqlq "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='trapper' AND p.proname='search_places_with_significance' LIMIT 1;" || true)"
if [[ "$fn_exists" == "1" ]]; then
    pass "search_places_with_significance function exists"
else
    fail "search_places_with_significance function missing"
fi

# Test 26: v_place_list_v3 view exists
echo "Test 26: Checking v_place_list_v3 view exists..."
vw_exists="$(psqlq "SELECT 1 FROM information_schema.views WHERE table_schema='trapper' AND table_name='v_place_list_v3' LIMIT 1;" || true)"
if [[ "$vw_exists" == "1" ]]; then
    pass "v_place_list_v3 view exists"
else
    fail "v_place_list_v3 view missing"
fi

# ============================================
# SECTION 6: Configuration Tables
# ============================================
section "Configuration Tables"

# Test 27: entity_match_config has person settings
echo "Test 27: Checking person match config exists..."
cfg_count="$(psqlq "SELECT COUNT(*) FROM trapper.entity_match_config WHERE entity_type='person';" || echo "0")"
if [[ "$cfg_count" =~ ^[0-9]+$ ]] && [[ "$cfg_count" -ge 5 ]]; then
    pass "Person match config has $cfg_count settings"
else
    fail "Person match config incomplete: $cfg_count settings"
fi

# Test 28: entity_match_config has cat settings
echo "Test 28: Checking cat match config exists..."
cfg_count="$(psqlq "SELECT COUNT(*) FROM trapper.entity_match_config WHERE entity_type='cat';" || echo "0")"
if [[ "$cfg_count" =~ ^[0-9]+$ ]] && [[ "$cfg_count" -ge 5 ]]; then
    pass "Cat match config has $cfg_count settings"
else
    fail "Cat match config incomplete: $cfg_count settings"
fi

# Test 29: entity_match_config has place settings
echo "Test 29: Checking place match config exists..."
cfg_count="$(psqlq "SELECT COUNT(*) FROM trapper.entity_match_config WHERE entity_type='place';" || echo "0")"
if [[ "$cfg_count" =~ ^[0-9]+$ ]] && [[ "$cfg_count" -ge 3 ]]; then
    pass "Place match config has $cfg_count settings"
else
    fail "Place match config incomplete: $cfg_count settings"
fi

# Test 30: entity_match_config has address settings
echo "Test 30: Checking address match config exists..."
cfg_count="$(psqlq "SELECT COUNT(*) FROM trapper.entity_match_config WHERE entity_type='address';" || echo "0")"
if [[ "$cfg_count" =~ ^[0-9]+$ ]] && [[ "$cfg_count" -ge 3 ]]; then
    pass "Address match config has $cfg_count settings"
else
    fail "Address match config incomplete: $cfg_count settings"
fi

# ============================================
# SECTION 7: No Regression Tests
# ============================================
section "Regression Tests"

# Test 31: No split First/Last observations (from ATLAS_024)
echo "Test 31: Checking no split First/Last Name observations..."
split_count="$(psqlq "SELECT COUNT(*) FROM trapper.observations WHERE observation_type = 'name_signal' AND field_name IN ('First Name', 'Last Name', 'Owner First Name', 'Owner Last Name');" || echo "-1")"
if [[ "$split_count" == "0" ]]; then
    pass "No split First/Last Name observations"
else
    fail "Found $split_count split First/Last Name observations (regression)"
fi

# Test 32: All canonical people have valid names
echo "Test 32: Checking all canonical people have valid names..."
invalid_count="$(psqlq "SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL AND NOT trapper.is_valid_person_name(display_name);" || echo "-1")"
if [[ "$invalid_count" == "0" ]]; then
    pass "All canonical people have valid names"
else
    fail "Found $invalid_count people with invalid names (regression)"
fi

# Test 33: Places are address-backed (constraint check)
echo "Test 33: Checking address-backed place constraint..."
orphan_count="$(psqlq "SELECT COUNT(*) FROM trapper.places WHERE is_address_backed = TRUE AND sot_address_id IS NULL;" || echo "-1")"
if [[ "$orphan_count" == "0" ]]; then
    pass "All address-backed places have sot_address_id"
else
    fail "Found $orphan_count address-backed places without sot_address_id"
fi

# ============================================
# Summary
# ============================================
echo ""
echo "============================================"
echo -e "SUMMARY: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC}"
echo "============================================"
echo ""

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    echo -e "${RED}Some tests failed. Review errors above.${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi
