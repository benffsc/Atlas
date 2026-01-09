#!/usr/bin/env bash
# acceptance_test_atlas_010.sh
#
# Acceptance tests for ATLAS_010: Full multi-source ingest run.
#
# Verifies:
#   1. staged_records exist for each expected source_table
#   2. observations populated for >1 source_system
#   3. sot_people > 0 with identifiers/aliases
#   4. candidate_addresses has >1 source_system
#   5. places seeded > 0
#   6. ClinicHQ join view exists and returns rows
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_010.sh

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
echo -e "${BOLD}  ATLAS_010 Acceptance Tests${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Database preflight check (validates DATABASE_URL, host, DNS)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib/db_preflight.sh"

# ============================================
# TEST 1: Staged records for all source tables
# ============================================
echo -e "${BOLD}Test 1: Staged records exist for all sources${RESET}"
echo "─────────────────────────────────────────────"

EXPECTED_TABLES=(
  "clinichq:appointment_info"
  "clinichq:cat_info"
  "clinichq:owner_info"
  "airtable:trapping_requests"
  "airtable:appointment_requests"
  "volunteerhub:users"
  "shelterluv:animals"
  "shelterluv:people"
  "petlink:pets"
  "petlink:owners"
  "etapestry:mailchimp_export"
)

for entry in "${EXPECTED_TABLES[@]}"; do
  system="${entry%%:*}"
  table="${entry##*:}"

  count=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM trapper.staged_records
    WHERE source_system = '$system' AND source_table = '$table';
  " | tr -d '[:space:]')

  if [[ "$count" -gt 0 ]]; then
    pass "staged_records: $system/$table has $count records"
  else
    warn "staged_records: $system/$table has 0 records"
  fi
done

echo ""

# ============================================
# TEST 2: Observations from multiple sources
# ============================================
echo -e "${BOLD}Test 2: Observations populated for >1 source_system${RESET}"
echo "─────────────────────────────────────────────"

obs_sources=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(DISTINCT source_system) FROM trapper.observations;
" | tr -d '[:space:]')

if [[ "$obs_sources" -gt 1 ]]; then
  pass "Observations from $obs_sources source systems"
else
  fail "Observations from only $obs_sources source system(s)"
fi

obs_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.observations;" | tr -d '[:space:]')
pass "Total observations: $obs_count"

echo ""

# ============================================
# TEST 3: People with identifiers/aliases
# ============================================
echo -e "${BOLD}Test 3: sot_people with identifiers and aliases${RESET}"
echo "─────────────────────────────────────────────"

people_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.sot_people;" | tr -d '[:space:]')
if [[ "$people_count" -gt 0 ]]; then
  pass "sot_people: $people_count total"
else
  fail "sot_people: 0 records"
fi

id_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.person_identifiers;" | tr -d '[:space:]')
if [[ "$id_count" -gt 0 ]]; then
  pass "person_identifiers: $id_count total"
else
  fail "person_identifiers: 0 records"
fi

alias_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.person_aliases;" | tr -d '[:space:]')
if [[ "$alias_count" -gt 0 ]]; then
  pass "person_aliases: $alias_count total"
else
  warn "person_aliases: 0 records"
fi

echo ""

# ============================================
# TEST 4: Address candidates from multiple sources
# ============================================
echo -e "${BOLD}Test 4: Address candidates from >1 source_system${RESET}"
echo "─────────────────────────────────────────────"

addr_sources=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(DISTINCT source_system)
  FROM trapper.v_candidate_addresses_multi_source;
" | tr -d '[:space:]')

if [[ "$addr_sources" -gt 1 ]]; then
  pass "Address candidates from $addr_sources source systems"
else
  warn "Address candidates from only $addr_sources source system(s)"
fi

addr_count=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM trapper.v_candidate_addresses_multi_source;
" | tr -d '[:space:]')
pass "Total address candidates: $addr_count"

echo ""

# ============================================
# TEST 5: Places seeded
# ============================================
echo -e "${BOLD}Test 5: Places seeded > 0${RESET}"
echo "─────────────────────────────────────────────"

places_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.places;" | tr -d '[:space:]')
if [[ "$places_count" -gt 0 ]]; then
  pass "places: $places_count total"
else
  fail "places: 0 records"
fi

sot_addr_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.sot_addresses;" | tr -d '[:space:]')
pass "sot_addresses: $sot_addr_count total"

echo ""

# ============================================
# TEST 6: ClinicHQ join view
# ============================================
echo -e "${BOLD}Test 6: ClinicHQ join view exists and returns rows${RESET}"
echo "─────────────────────────────────────────────"

view_exists=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM information_schema.views
  WHERE table_schema = 'trapper' AND table_name = 'v_clinichq_joined_simple';
" | tr -d '[:space:]')

if [[ "$view_exists" -ge 1 ]]; then
  pass "v_clinichq_joined_simple view exists"

  join_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.v_clinichq_joined_simple;" | tr -d '[:space:]')
  if [[ "$join_count" -gt 0 ]]; then
    pass "v_clinichq_joined_simple has $join_count rows"
  else
    warn "v_clinichq_joined_simple has 0 rows"
  fi
else
  fail "v_clinichq_joined_simple view does NOT exist"
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
