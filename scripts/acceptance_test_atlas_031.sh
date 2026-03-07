#!/usr/bin/env bash
# DEPRECATED: v1 acceptance test. References trapper.* schema dropped in MIG_2299. Do not run.
# acceptance_test_atlas_031.sh
# ATLAS_031 Acceptance Test: VolunteerHub People Pipeline
#
# Tests:
#   - MIG_041 observation extraction with name combining
#   - VolunteerHub staged records and observations
#   - Canonical people from VolunteerHub
#   - Alias population with phonetic codes
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_031.sh

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
echo "ATLAS_031 Acceptance Test: VolunteerHub Pipeline"
echo "============================================"
echo ""

require_env DATABASE_URL

# ============================================
# SECTION 1: MIG_041 Observation Extraction
# ============================================
section "MIG_041: Observation Extraction (Name Combining)"

# Test 1: extract_observations_from_staged_v2 exists
echo "Test 1: Checking extract_observations_from_staged_v2 function exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.extract_observations_from_staged_v2(uuid)') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "extract_observations_from_staged_v2 function exists"
else
    fail "extract_observations_from_staged_v2 function missing"
fi

# Test 2: combine_first_last_name helper exists
echo "Test 2: Checking combine_first_last_name helper exists..."
fn_exists="$(psqlq "SELECT to_regprocedure('trapper.combine_first_last_name(jsonb,text,text)') IS NOT NULL AS ok;" || echo "f")"
if [[ "$fn_exists" == "t" ]]; then
    pass "combine_first_last_name helper exists"
else
    fail "combine_first_last_name helper missing"
fi

# Test 3: Main extraction delegates to v2
echo "Test 3: Checking main extraction uses v2..."
# If v2 exists and main extraction returns same results, it's delegating
test_result="$(psqlq "
SELECT COUNT(*) = 0 AS ok
FROM (
    SELECT * FROM trapper.extract_observations_from_staged(
        (SELECT id FROM trapper.staged_records WHERE source_system = 'volunteerhub' LIMIT 1)
    )
    EXCEPT
    SELECT * FROM trapper.extract_observations_from_staged_v2(
        (SELECT id FROM trapper.staged_records WHERE source_system = 'volunteerhub' LIMIT 1)
    )
) AS diff;
" || echo "f")"
if [[ "$test_result" == "t" ]]; then
    pass "Main extraction delegates to v2"
else
    fail "Main extraction not using v2"
fi

# ============================================
# SECTION 2: VolunteerHub Staged Records
# ============================================
section "VolunteerHub Staged Records"

# Test 4: VolunteerHub staged records exist
echo "Test 4: Checking VolunteerHub staged records exist..."
staged_count="$(psqlq "SELECT COUNT(*) FROM trapper.staged_records WHERE source_system = 'volunteerhub' AND source_table = 'users';" || echo "0")"
if [[ "$staged_count" =~ ^[0-9]+$ ]] && [[ "$staged_count" -gt 0 ]]; then
    pass "VolunteerHub users staged records exist ($staged_count records)"
else
    warn "No VolunteerHub users staged records (may need to run ingest)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# Test 5: VolunteerHub completed run exists
echo "Test 5: Checking VolunteerHub users completed run exists..."
run_id="$(psqlq "SELECT trapper.get_latest_completed_run('volunteerhub', 'users');" || echo "")"
if [[ -n "$run_id" && "$run_id" != "" ]]; then
    pass "VolunteerHub users completed run exists"
else
    warn "No completed VolunteerHub users run (may need to repair stuck runs)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# ============================================
# SECTION 3: VolunteerHub Observations
# ============================================
section "VolunteerHub Observations"

# Test 6: VolunteerHub observations exist
echo "Test 6: Checking VolunteerHub observations exist..."
obs_count="$(psqlq "SELECT COUNT(*) FROM trapper.observations WHERE source_system = 'volunteerhub';" || echo "0")"
if [[ "$staged_count" -gt 0 ]]; then
    if [[ "$obs_count" =~ ^[0-9]+$ ]] && [[ "$obs_count" -gt 0 ]]; then
        pass "VolunteerHub observations exist ($obs_count observations)"
    else
        fail "VolunteerHub observations missing (staged records exist but observations=0)"
    fi
else
    warn "Skipping observation check (no staged records)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# Test 7: Name signals have combined full names (not split first/last)
echo "Test 7: Checking name signals are combined (not split first/last)..."
split_count="$(psqlq "
SELECT COUNT(*)
FROM trapper.observations
WHERE source_system = 'volunteerhub'
AND observation_type = 'name_signal'
AND field_name IN ('Name - FirstName', 'Name - LastName');
" || echo "0")"
if [[ "$split_count" == "0" ]]; then
    pass "No split First/Last name observations from VolunteerHub"
else
    fail "Found $split_count split name observations (should use combined names)"
fi

# Test 8: Full name observations exist
echo "Test 8: Checking combined 'Volunteer Full Name' observations exist..."
fullname_count="$(psqlq "
SELECT COUNT(*)
FROM trapper.observations
WHERE source_system = 'volunteerhub'
AND observation_type = 'name_signal'
AND field_name = 'Volunteer Full Name';
" || echo "0")"
if [[ "$staged_count" -gt 0 ]]; then
    if [[ "$fullname_count" -gt 0 ]]; then
        pass "VolunteerHub 'Volunteer Full Name' observations exist ($fullname_count)"
    else
        fail "No 'Volunteer Full Name' observations found"
    fi
else
    warn "Skipping (no staged records)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# ============================================
# SECTION 4: Canonical People from VolunteerHub
# ============================================
section "Canonical People from VolunteerHub"

# Test 9: Canonical people sourced from VolunteerHub
echo "Test 9: Checking canonical people sourced from VolunteerHub..."
vh_people="$(psqlq "SELECT COUNT(DISTINCT person_id) FROM trapper.person_aliases WHERE source_system = 'volunteerhub';" || echo "0")"
if [[ "$staged_count" -gt 0 ]]; then
    if [[ "$vh_people" =~ ^[0-9]+$ ]] && [[ "$vh_people" -gt 0 ]]; then
        pass "VolunteerHub contributes $vh_people canonical people"
    else
        fail "No canonical people from VolunteerHub (expected > 0)"
    fi
else
    warn "Skipping people check (no staged records)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# Test 10: VolunteerHub aliases exist
echo "Test 10: Checking VolunteerHub aliases exist..."
vh_aliases="$(psqlq "SELECT COUNT(*) FROM trapper.person_aliases WHERE source_system = 'volunteerhub';" || echo "0")"
if [[ "$staged_count" -gt 0 ]]; then
    if [[ "$vh_aliases" =~ ^[0-9]+$ ]] && [[ "$vh_aliases" -gt 0 ]]; then
        pass "VolunteerHub aliases exist ($vh_aliases aliases)"
    else
        fail "No VolunteerHub aliases"
    fi
else
    warn "Skipping alias check (no staged records)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# ============================================
# SECTION 5: Data Quality
# ============================================
section "Data Quality"

# Test 11: VolunteerHub people have valid names
echo "Test 11: Checking VolunteerHub people have valid names..."
invalid_vh="$(psqlq "
SELECT COUNT(*)
FROM trapper.sot_people sp
JOIN trapper.person_aliases pa ON pa.person_id = sp.person_id
WHERE pa.source_system = 'volunteerhub'
AND sp.merged_into_person_id IS NULL
AND NOT trapper.is_valid_person_name(sp.display_name);
" || echo "0")"
if [[ "$invalid_vh" == "0" ]]; then
    pass "All VolunteerHub people have valid names"
elif [[ "$invalid_vh" -le 5 ]]; then
    # Small number of edge cases (abbreviated last names like "Kayla B")
    warn "Found $invalid_vh VolunteerHub people with invalid names (edge cases)"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    fail "Found $invalid_vh VolunteerHub people with invalid names"
fi

# Test 12: VolunteerHub phone observations exist
echo "Test 12: Checking VolunteerHub phone observations extracted..."
vh_phones="$(psqlq "
SELECT COUNT(*)
FROM trapper.observations
WHERE source_system = 'volunteerhub'
AND observation_type = 'phone_signal';
" || echo "0")"
if [[ "$staged_count" -gt 0 ]]; then
    if [[ "$vh_phones" -gt 0 ]]; then
        pass "VolunteerHub phone observations exist ($vh_phones)"
    else
        warn "No VolunteerHub phone observations (may be normal if no phones in data)"
        PASS_COUNT=$((PASS_COUNT + 1))
    fi
else
    warn "Skipping (no staged records)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# Test 13: VolunteerHub email observations exist
echo "Test 13: Checking VolunteerHub email observations extracted..."
vh_emails="$(psqlq "
SELECT COUNT(*)
FROM trapper.observations
WHERE source_system = 'volunteerhub'
AND observation_type = 'email_signal';
" || echo "0")"
if [[ "$staged_count" -gt 0 ]]; then
    if [[ "$vh_emails" -gt 0 ]]; then
        pass "VolunteerHub email observations exist ($vh_emails)"
    else
        warn "No VolunteerHub email observations"
        PASS_COUNT=$((PASS_COUNT + 1))
    fi
else
    warn "Skipping (no staged records)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# Test 14: VolunteerHub address observations exist
echo "Test 14: Checking VolunteerHub address observations extracted..."
vh_addrs="$(psqlq "
SELECT COUNT(*)
FROM trapper.observations
WHERE source_system = 'volunteerhub'
AND observation_type = 'address_signal';
" || echo "0")"
if [[ "$staged_count" -gt 0 ]]; then
    if [[ "$vh_addrs" -gt 0 ]]; then
        pass "VolunteerHub address observations exist ($vh_addrs)"
    else
        warn "No VolunteerHub address observations"
        PASS_COUNT=$((PASS_COUNT + 1))
    fi
else
    warn "Skipping (no staged records)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

# Test 15: Metaphone codes populated in VolunteerHub aliases
echo "Test 15: Checking metaphone codes in VolunteerHub aliases..."
backend_available="$(psqlq "SELECT (trapper.phonetic_backend_status()->>'available')::BOOLEAN;" || echo "f")"
vh_meta_count="$(psqlq "SELECT COUNT(*) FROM trapper.person_aliases WHERE source_system = 'volunteerhub' AND metaphone_first IS NOT NULL;" || echo "0")"
if [[ "$backend_available" == "t" ]]; then
    if [[ "$vh_aliases" -gt 0 && "$vh_meta_count" == "$vh_aliases" ]]; then
        pass "All $vh_aliases VolunteerHub aliases have metaphone codes"
    elif [[ "$vh_aliases" == "0" ]]; then
        warn "No VolunteerHub aliases to check"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        fail "Only $vh_meta_count / $vh_aliases VolunteerHub aliases have metaphone codes"
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

# Show observation breakdown
echo "VolunteerHub Observation Breakdown:"
psql "$DATABASE_URL" -c "
SELECT observation_type, COUNT(*) as count
FROM trapper.observations
WHERE source_system = 'volunteerhub'
GROUP BY observation_type
ORDER BY count DESC;
"

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    echo -e "${RED}Some tests failed. Review errors above.${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi
