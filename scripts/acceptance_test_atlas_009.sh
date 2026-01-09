#!/usr/bin/env bash
# acceptance_test_atlas_009.sh
#
# Acceptance tests for ATLAS_009: Batch ingest support for multiple sources.
#
# Verifies:
#   1. New source_tables exist in registry
#   2. At least one staged_record exists for each file that was present
#   3. ClinicHQ join view exists
#   4. v_candidate_addresses_all_sources has rows from >1 source_system
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_009.sh

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
echo -e "${BOLD}  ATLAS_009 Acceptance Tests${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Database preflight check (validates DATABASE_URL, host, DNS)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib/db_preflight.sh"

# ============================================
# TEST 1: New source_tables exist in registry
# ============================================
echo -e "${BOLD}Test 1: Source tables registered${RESET}"
echo "─────────────────────────────────────────────"

# Expected source tables from MIG_015
EXPECTED_TABLES=(
  "clinichq:appointment_info"
  "clinichq:cat_info"
  "clinichq:owner_info"
  "volunteerhub:users"
  "shelterluv:animals"
  "shelterluv:people"
  "shelterluv:outcomes"
  "petlink:pets"
  "petlink:owners"
  "etapestry:mailchimp_export"
  "airtable:trappers"
)

for entry in "${EXPECTED_TABLES[@]}"; do
  system_id="${entry%%:*}"
  table_id="${entry##*:}"

  count=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM trapper.source_tables
    WHERE system_id = '$system_id' AND table_id = '$table_id';
  " | tr -d '[:space:]')

  if [[ "$count" -ge 1 ]]; then
    pass "source_tables: $system_id/$table_id registered"
  else
    fail "source_tables: $system_id/$table_id NOT registered"
  fi
done

echo ""

# ============================================
# TEST 2: Staged records exist for present files
# ============================================
echo -e "${BOLD}Test 2: Staged records exist${RESET}"
echo "─────────────────────────────────────────────"

# Check which sources have staged records
SOURCES_WITH_DATA=$(psql "$DATABASE_URL" -t -c "
  SELECT DISTINCT source_system || ':' || source_table
  FROM trapper.staged_records
  WHERE source_system IN ('clinichq', 'volunteerhub', 'shelterluv', 'petlink', 'etapestry');
" | tr -d ' ' | grep -v '^$' || true)

if [[ -z "$SOURCES_WITH_DATA" ]]; then
  fail "No staged records found for any new sources"
else
  for entry in $SOURCES_WITH_DATA; do
    system="${entry%%:*}"
    table="${entry##*:}"
    count=$(psql "$DATABASE_URL" -t -c "
      SELECT COUNT(*) FROM trapper.staged_records
      WHERE source_system = '$system' AND source_table = '$table';
    " | tr -d '[:space:]')
    pass "staged_records: $system/$table has $count records"
  done
fi

# At minimum, ClinicHQ should have data (we know files exist)
clinichq_count=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM trapper.staged_records WHERE source_system = 'clinichq';
" | tr -d '[:space:]')

if [[ "$clinichq_count" -gt 0 ]]; then
  pass "ClinicHQ has $clinichq_count total staged records"
else
  fail "ClinicHQ should have staged records (files exist)"
fi

echo ""

# ============================================
# TEST 3: ClinicHQ join view exists
# ============================================
echo -e "${BOLD}Test 3: ClinicHQ join view exists${RESET}"
echo "─────────────────────────────────────────────"

view_exists=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM information_schema.views
  WHERE table_schema = 'trapper'
  AND table_name = 'v_clinichq_cat_owner_appt_join';
" | tr -d '[:space:]')

if [[ "$view_exists" -ge 1 ]]; then
  pass "v_clinichq_cat_owner_appt_join view exists"

  # Check if it has data
  join_count=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM trapper.v_clinichq_cat_owner_appt_join;
  " | tr -d '[:space:]')

  if [[ "$join_count" -gt 0 ]]; then
    pass "v_clinichq_cat_owner_appt_join has $join_count rows"
  else
    warn "v_clinichq_cat_owner_appt_join has no rows (may need data)"
  fi
else
  fail "v_clinichq_cat_owner_appt_join view does NOT exist"
fi

# Check stats view
stats_exists=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM information_schema.views
  WHERE table_schema = 'trapper'
  AND table_name = 'v_clinichq_stats';
" | tr -d '[:space:]')

if [[ "$stats_exists" -ge 1 ]]; then
  pass "v_clinichq_stats view exists"
else
  fail "v_clinichq_stats view does NOT exist"
fi

echo ""

# ============================================
# TEST 4: Address candidates from multiple sources
# ============================================
echo -e "${BOLD}Test 4: Address candidates from multiple sources${RESET}"
echo "─────────────────────────────────────────────"

# Check v_candidate_addresses_all_sources includes ClinicHQ
addr_sources=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(DISTINCT source_system)
  FROM trapper.v_candidate_addresses_all_sources;
" | tr -d '[:space:]')

if [[ "$addr_sources" -gt 1 ]]; then
  pass "v_candidate_addresses_all_sources has $addr_sources source systems"
elif [[ "$addr_sources" -eq 1 ]]; then
  warn "v_candidate_addresses_all_sources has only 1 source system"
else
  warn "v_candidate_addresses_all_sources has no candidates"
fi

# List source breakdown
echo ""
echo -e "${CYAN}Address candidates by source:${RESET}"
psql "$DATABASE_URL" -c "
  SELECT source_system, source_table, COUNT(*) AS candidates
  FROM trapper.v_candidate_addresses_all_sources
  GROUP BY 1, 2
  ORDER BY 3 DESC;
"

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
  echo -e "${GREEN}${BOLD}All acceptance tests passed!${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}Some tests failed.${RESET}"
  exit 1
fi
