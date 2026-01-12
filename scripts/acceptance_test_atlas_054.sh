#!/usr/bin/env bash
# acceptance_test_atlas_054.sh
# Test: ClinicHQ observation extraction and people pipeline
#
# Verifies:
#   1. Observations are extracted with ClinicHQ field names (Owner Phone, etc.)
#   2. People are created from email/phone identifiers
#   3. Names become aliases on existing people
#   4. Search returns correct results

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

check() {
    local desc="$1"
    local query="$2"
    local expected="$3"

    result=$(psql "$DATABASE_URL" -t -A -c "$query" 2>/dev/null || echo "ERROR")

    if [[ "$result" == *"$expected"* ]]; then
        echo -e "${GREEN}✓${NC} $desc"
        ((PASS++))
    else
        echo -e "${RED}✗${NC} $desc"
        echo "  Expected: $expected"
        echo "  Got: $result"
        ((FAIL++))
    fi
}

check_gte() {
    local desc="$1"
    local query="$2"
    local min="$3"

    result=$(psql "$DATABASE_URL" -t -A -c "$query" 2>/dev/null | tr -d ' ' || echo "0")

    if [[ "$result" =~ ^[0-9]+$ ]] && [[ "$result" -ge "$min" ]]; then
        echo -e "${GREEN}✓${NC} $desc (got $result, min $min)"
        ((PASS++))
    else
        echo -e "${RED}✗${NC} $desc"
        echo "  Expected >= $min, got: $result"
        ((FAIL++))
    fi
}

echo ""
echo -e "${YELLOW}============================================${NC}"
echo -e "${YELLOW}ATLAS-054: ClinicHQ Pipeline Acceptance Test${NC}"
echo -e "${YELLOW}============================================${NC}"
echo ""

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo -e "${RED}ERROR: DATABASE_URL not set${NC}"
    exit 1
fi

# ============================================
# TEST 1: Observation Extraction
# ============================================
echo -e "${YELLOW}Test 1: Observation Extraction${NC}"

check_gte "Owner_info has phone observations" \
    "SELECT COUNT(*) FROM trapper.observations WHERE source_table = 'owner_info' AND observation_type = 'phone_signal';" \
    40000

check_gte "Owner_info has email observations" \
    "SELECT COUNT(*) FROM trapper.observations WHERE source_table = 'owner_info' AND observation_type = 'email_signal';" \
    20000

check_gte "Owner_info has name observations" \
    "SELECT COUNT(*) FROM trapper.observations WHERE source_table = 'owner_info' AND observation_type = 'name_signal';" \
    35000

check "Gary Feldman extraction includes phone" \
    "SELECT COUNT(*) FROM trapper.extract_observations_from_staged_v2('5e26b7aa-aea5-4a2f-bb3d-a96ad32f5b71'::uuid) WHERE observation_type = 'phone_signal';" \
    "1"

echo ""

# ============================================
# TEST 2: People Pipeline
# ============================================
echo -e "${YELLOW}Test 2: People Pipeline${NC}"

check_gte "Active people count" \
    "SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL;" \
    9000

check_gte "Phone identifiers exist" \
    "SELECT COUNT(*) FROM trapper.person_identifiers WHERE id_type = 'phone';" \
    1500

check_gte "Email identifiers exist" \
    "SELECT COUNT(*) FROM trapper.person_identifiers WHERE id_type = 'email';" \
    7000

check_gte "Person aliases exist" \
    "SELECT COUNT(*) FROM trapper.person_aliases;" \
    40000

check_gte "Owner_info records linked to people" \
    "SELECT COUNT(*) FROM trapper.staged_record_person_link WHERE staged_record_id IN (SELECT id FROM trapper.staged_records WHERE source_table = 'owner_info');" \
    35000

echo ""

# ============================================
# TEST 3: Search Functionality
# ============================================
echo -e "${YELLOW}Test 3: Search Functionality${NC}"

check "Gary Feldman is searchable" \
    "SELECT display_name FROM trapper.search_unified('Gary Feldman', NULL, 1);" \
    "Gary Feldman"

check "Lorie Obal is searchable" \
    "SELECT display_name FROM trapper.search_unified('Lorie Obal', NULL, 1);" \
    "Lorie Obal"

check "Adan Alvarado appears in intake search" \
    "SELECT display_name FROM trapper.search_intake('Adan Alvarado', 1);" \
    "Adan Alvarado"

check "Intake search returns contact info" \
    "SELECT phone FROM trapper.search_intake('Lorie Obal', 1);" \
    "7609002795"

echo ""

# ============================================
# TEST 4: Data Integrity
# ============================================
echo -e "${YELLOW}Test 4: Data Integrity${NC}"

check "No duplicate phone identifiers" \
    "SELECT COALESCE(MAX(cnt), 0) FROM (SELECT COUNT(*) as cnt FROM trapper.person_identifiers WHERE id_type = 'phone' GROUP BY id_value_norm HAVING COUNT(*) > 1) x;" \
    "0"

check "All linked records have valid person_id" \
    "SELECT COUNT(*) FROM trapper.staged_record_person_link srpl WHERE NOT EXISTS (SELECT 1 FROM trapper.sot_people p WHERE p.person_id = srpl.person_id);" \
    "0"

check "Source config allows clinichq canonical people" \
    "SELECT allow_canonical_people FROM trapper.source_canonical_config WHERE source_system = 'clinichq';" \
    "t"

echo ""

# ============================================
# SUMMARY
# ============================================
echo -e "${YELLOW}============================================${NC}"
TOTAL=$((PASS + FAIL))
if [[ $FAIL -eq 0 ]]; then
    echo -e "${GREEN}ALL TESTS PASSED: $PASS/$TOTAL${NC}"
    exit 0
else
    echo -e "${RED}TESTS FAILED: $FAIL/$TOTAL${NC}"
    echo -e "${GREEN}Passed: $PASS${NC}"
    exit 1
fi
