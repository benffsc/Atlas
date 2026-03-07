#!/usr/bin/env bash
# DEPRECATED: v1 acceptance test. References trapper.* schema dropped in MIG_2299. Do not run.
# acceptance_test_atlas_028.sh
# ATLAS_028 Acceptance Test: ClinicHQ Pipeline & Phonetic Portability
#
# Tests:
#   - ClinicHQ observations exist (when staged records present)
#   - Canonical people sourced from ClinicHQ
#   - Phonetic wrapper functions exist and work
#   - Phonetic backend detection
#   - Ingest run repair infrastructure
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_028.sh

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
echo "ATLAS_028 Acceptance Test: ClinicHQ & Phonetics"
echo "============================================"
echo ""

require_env DATABASE_URL

# ============================================
# SECTION 1: Phonetic Wrapper Functions
# ============================================
section "Phonetic Portability (MIG_038)"

# Test 1: trapper.dmetaphone wrapper exists
echo "Test 1: Checking trapper.dmetaphone wrapper exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.dmetaphone(text)') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "trapper.dmetaphone wrapper exists"
else
    fail "trapper.dmetaphone wrapper missing"
fi

# Test 2: trapper.difference wrapper exists
echo "Test 2: Checking trapper.difference wrapper exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.difference(text,text)') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "trapper.difference wrapper exists"
else
    fail "trapper.difference wrapper missing"
fi

# Test 3: trapper.soundex wrapper exists
echo "Test 3: Checking trapper.soundex wrapper exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.soundex(text)') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "trapper.soundex wrapper exists"
else
    fail "trapper.soundex wrapper missing"
fi

# Test 4: detect_phonetic_schema function exists
echo "Test 4: Checking detect_phonetic_schema function exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.detect_phonetic_schema()') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "detect_phonetic_schema function exists"
else
    fail "detect_phonetic_schema function missing"
fi

# Test 5: phonetic_backend_status function exists
echo "Test 5: Checking phonetic_backend_status function exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.phonetic_backend_status()') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "phonetic_backend_status function exists"
else
    fail "phonetic_backend_status function missing"
fi

# Test 6: Phonetic backend is available OR graceful degradation
echo "Test 6: Checking phonetic backend availability..."
backend_available="$(psqlq "SELECT (trapper.phonetic_backend_status()->>'available')::BOOLEAN;" || echo "f")"
backend_schema="$(psqlq "SELECT trapper.phonetic_backend_status()->>'schema';" || echo "")"
if [[ "$backend_available" == "t" ]]; then
    pass "Phonetic backend available (schema: $backend_schema)"
else
    warn "Phonetic backend not available - graceful degradation mode"
    PASS_COUNT=$((PASS_COUNT + 1))  # This is acceptable
fi

# Test 7: dmetaphone returns expected result (or NULL if unavailable)
echo "Test 7: Testing dmetaphone wrapper..."
dmeta_result="$(psqlq "SELECT trapper.dmetaphone('Smith');" || echo "")"
if [[ "$backend_available" == "t" ]]; then
    if [[ "$dmeta_result" == "SM0" ]]; then
        pass "dmetaphone('Smith') = SM0 (correct)"
    else
        fail "dmetaphone('Smith') = '$dmeta_result' (expected SM0)"
    fi
else
    if [[ -z "$dmeta_result" || "$dmeta_result" == "" ]]; then
        pass "dmetaphone returns NULL in degraded mode (expected)"
    else
        fail "dmetaphone should return NULL in degraded mode"
    fi
fi

# Test 8: Matching still works even if phonetics unavailable
echo "Test 8: Testing phonetic_name_similarity function..."
sim_result="$(psqlq "SELECT (trapper.phonetic_name_similarity('John Smith', 'Jon Smyth')->>'score')::NUMERIC;" || echo "-1")"
if [[ "$sim_result" =~ ^[0-9.]+$ ]] && (( $(echo "$sim_result >= 0" | bc -l) )); then
    pass "phonetic_name_similarity works (score: $sim_result)"
else
    fail "phonetic_name_similarity failed: $sim_result"
fi

# ============================================
# SECTION 2: Ingest Run Repair Infrastructure
# ============================================
section "Ingest Run Repair (MIG_039)"

# Test 9: ingest_run_repairs table exists
echo "Test 9: Checking ingest_run_repairs audit table exists..."
tbl_exists="$(psqlq "SELECT 1 FROM information_schema.tables WHERE table_schema='trapper' AND table_name='ingest_run_repairs' LIMIT 1;" || true)"
if [[ "$tbl_exists" == "1" ]]; then
    pass "ingest_run_repairs audit table exists"
else
    fail "ingest_run_repairs audit table missing"
fi

# Test 10: repair_stuck_ingest_runs function exists
echo "Test 10: Checking repair_stuck_ingest_runs function exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.repair_stuck_ingest_runs(text,int,boolean)') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "repair_stuck_ingest_runs function exists"
else
    fail "repair_stuck_ingest_runs function missing"
fi

# Test 11: v_stuck_ingest_runs view exists
echo "Test 11: Checking v_stuck_ingest_runs view exists..."
vw_exists="$(psqlq "SELECT 1 FROM information_schema.views WHERE table_schema='trapper' AND table_name='v_stuck_ingest_runs' LIMIT 1;" || true)"
if [[ "$vw_exists" == "1" ]]; then
    pass "v_stuck_ingest_runs view exists"
else
    fail "v_stuck_ingest_runs view missing"
fi

# Test 12: get_latest_completed_run function exists
echo "Test 12: Checking get_latest_completed_run function exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.get_latest_completed_run(text,text)') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "get_latest_completed_run function exists"
else
    fail "get_latest_completed_run function missing"
fi

# Test 13: populate_clinichq_people function exists
echo "Test 13: Checking populate_clinichq_people function exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.populate_clinichq_people(boolean,boolean)') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "populate_clinichq_people function exists"
else
    fail "populate_clinichq_people function missing"
fi

# ============================================
# SECTION 3: ClinicHQ Data Pipeline
# ============================================
section "ClinicHQ Data Pipeline"

# Test 14: ClinicHQ staged records exist
echo "Test 14: Checking ClinicHQ staged records exist..."
staged_count="$(psqlq "SELECT COUNT(*) FROM trapper.staged_records WHERE source_system = 'clinichq' AND source_table = 'owner_info';" || echo "0")"
if [[ "$staged_count" =~ ^[0-9]+$ ]] && [[ "$staged_count" -gt 0 ]]; then
    pass "ClinicHQ owner_info staged records exist ($staged_count records)"
else
    warn "No ClinicHQ owner_info staged records (may need to run ingest)"
fi

# Test 15: ClinicHQ observations exist (when staged records present)
echo "Test 15: Checking ClinicHQ observations exist..."
obs_count="$(psqlq "SELECT COUNT(*) FROM trapper.observations WHERE source_system = 'clinichq';" || echo "0")"
if [[ "$staged_count" -gt 0 ]]; then
    if [[ "$obs_count" =~ ^[0-9]+$ ]] && [[ "$obs_count" -gt 0 ]]; then
        pass "ClinicHQ observations exist ($obs_count observations)"
    else
        fail "ClinicHQ observations missing (staged records exist but observations=0)"
    fi
else
    warn "Skipping observation check (no staged records)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# Test 16: Canonical people from ClinicHQ
echo "Test 16: Checking canonical people sourced from ClinicHQ..."
clinichq_people="$(psqlq "SELECT COUNT(DISTINCT person_id) FROM trapper.person_aliases WHERE source_system = 'clinichq';" || echo "0")"
if [[ "$staged_count" -gt 0 ]]; then
    if [[ "$clinichq_people" =~ ^[0-9]+$ ]] && [[ "$clinichq_people" -gt 0 ]]; then
        pass "ClinicHQ contributes $clinichq_people canonical people"
    else
        fail "No canonical people from ClinicHQ (expected > 0)"
    fi
else
    warn "Skipping people check (no staged records)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# Test 17: ClinicHQ completed run exists
echo "Test 17: Checking ClinicHQ owner_info completed run exists..."
run_id="$(psqlq "SELECT trapper.get_latest_completed_run('clinichq', 'owner_info');" || echo "")"
if [[ -n "$run_id" && "$run_id" != "" ]]; then
    pass "ClinicHQ owner_info completed run exists"
else
    warn "No completed ClinicHQ owner_info run (may need to repair stuck runs)"
fi

# ============================================
# SECTION 4: Data Quality
# ============================================
section "Data Quality"

# Test 18: All canonical people have valid names
echo "Test 18: Checking all canonical people have valid names..."
invalid_count="$(psqlq "SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL AND NOT trapper.is_valid_person_name(display_name);" || echo "-1")"
if [[ "$invalid_count" == "0" ]]; then
    pass "All canonical people have valid names"
else
    fail "Found $invalid_count people with invalid names"
fi

# Test 19: No split First/Last observations
echo "Test 19: Checking no split First/Last Name observations..."
split_count="$(psqlq "SELECT COUNT(*) FROM trapper.observations WHERE observation_type = 'name_signal' AND field_name IN ('First Name', 'Last Name', 'Owner First Name', 'Owner Last Name');" || echo "-1")"
if [[ "$split_count" == "0" ]]; then
    pass "No split First/Last Name observations"
else
    fail "Found $split_count split First/Last Name observations (regression)"
fi

# Test 20: Phonetic codes populated in aliases
echo "Test 20: Checking metaphone codes populated in aliases..."
meta_count="$(psqlq "SELECT COUNT(*) FROM trapper.person_aliases WHERE metaphone_first IS NOT NULL;" || echo "0")"
alias_count="$(psqlq "SELECT COUNT(*) FROM trapper.person_aliases;" || echo "0")"
if [[ "$backend_available" == "t" ]]; then
    if [[ "$meta_count" == "$alias_count" && "$alias_count" -gt 0 ]]; then
        pass "All $alias_count aliases have metaphone codes"
    else
        fail "Only $meta_count / $alias_count aliases have metaphone codes"
    fi
else
    pass "Phonetics disabled - metaphone check skipped"
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
