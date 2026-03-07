#!/usr/bin/env bash
# DEPRECATED: v1 acceptance test. References trapper.* schema dropped in MIG_2299. Do not run.
# acceptance_test_atlas_007.sh
#
# Verifies ATLAS_007 deliverables:
#   - MIG_005 hardening (name classification/candidates)
#   - MIG_006 hardening (observations)
#   - MIG_009 (unified candidates + context surface)
#   - Project 75 ingest script
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_007.sh

# Don't use set -e since we want to continue on test failures

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  echo -e "${GREEN}PASS${RESET}: $1"
  ((PASS_COUNT++))
}

fail() {
  echo -e "${RED}FAIL${RESET}: $1"
  ((FAIL_COUNT++))
}

info() {
  echo -e "${CYAN}INFO${RESET}: $1"
}

header() {
  echo ""
  echo -e "${BOLD}$1${RESET}"
  echo "─────────────────────────────────────────────"
}

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo -e "${BOLD}  ATLAS_007 Acceptance Tests${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Check DATABASE_URL
if [[ -z "$DATABASE_URL" ]]; then
  echo -e "${RED}ERROR${RESET}: DATABASE_URL not set"
  echo "Run: set -a && source .env && set +a"
  exit 1
fi

# ============================================
# 1. MIG_005 Name Classification
# ============================================
header "1. MIG_005 Name Classification"

# Check classify_name function exists
if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_proc WHERE proname = 'classify_name' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');" | grep -q 1; then
  pass "classify_name function exists"
else
  fail "classify_name function missing"
fi

# Check name_kind enum
if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_type WHERE typname = 'name_kind';" | grep -q 1; then
  pass "name_kind enum exists"
else
  fail "name_kind enum missing"
fi

# Check name_candidates table
if psql "$DATABASE_URL" -t -c "SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'name_candidates';" | grep -q 1; then
  pass "name_candidates table exists"
else
  fail "name_candidates table missing"
fi

# Test classify_name on known values
if psql "$DATABASE_URL" -t -c "SELECT kind FROM trapper.classify_name('John Smith');" | grep -q "person"; then
  pass "classify_name('John Smith') = person"
else
  fail "classify_name('John Smith') failed"
fi

# Test that function returns valid kind enum values
RESULT=$(psql "$DATABASE_URL" -t -c "SELECT kind FROM trapper.classify_name('Walmart');" | tr -d '[:space:]')
if [[ "$RESULT" =~ ^(person|place|unknown|nonsense)$ ]]; then
  pass "classify_name('Walmart') returns valid kind: $RESULT"
else
  fail "classify_name('Walmart') returned invalid kind: $RESULT"
fi

RESULT=$(psql "$DATABASE_URL" -t -c "SELECT kind FROM trapper.classify_name('asdf123');" | tr -d '[:space:]')
if [[ "$RESULT" =~ ^(person|place|unknown|nonsense)$ ]]; then
  pass "classify_name('asdf123') returns valid kind: $RESULT"
else
  fail "classify_name('asdf123') returned invalid kind: $RESULT"
fi

# ============================================
# 2. MIG_006 Observations
# ============================================
header "2. MIG_006 Observations"

# Check observation_type enum
if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_type WHERE typname = 'observation_type';" | grep -q 1; then
  pass "observation_type enum exists"
else
  fail "observation_type enum missing"
fi

# Check observations table
if psql "$DATABASE_URL" -t -c "SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'observations';" | grep -q 1; then
  pass "observations table exists"
else
  fail "observations table missing"
fi

# Check extract function exists
if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_proc WHERE proname = 'extract_observations_from_staged' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');" | grep -q 1; then
  pass "extract_observations_from_staged function exists"
else
  fail "extract_observations_from_staged function missing"
fi

# Check populate function exists
if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_proc WHERE proname = 'populate_observations_for_latest_run' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');" | grep -q 1; then
  pass "populate_observations_for_latest_run function exists"
else
  fail "populate_observations_for_latest_run function missing"
fi

# ============================================
# 3. MIG_009 Unified Candidates + Context Surface
# ============================================
header "3. MIG_009 Unified Candidates + Context Surface"

# Check unified view exists
if psql "$DATABASE_URL" -t -c "SELECT 1 FROM information_schema.views WHERE table_schema = 'trapper' AND table_name = 'v_candidate_addresses_all_sources';" | grep -q 1; then
  pass "v_candidate_addresses_all_sources view exists"
else
  fail "v_candidate_addresses_all_sources view missing"
fi

# Check view includes project75_survey
if psql "$DATABASE_URL" -t -c "SELECT pg_get_viewdef('trapper.v_candidate_addresses_all_sources'::regclass);" | grep -q "project75_survey"; then
  pass "Unified view includes project75_survey"
else
  fail "Unified view missing project75_survey"
fi

# Check context surface function
if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_proc WHERE proname = 'fn_context_surface' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');" | grep -q 1; then
  pass "fn_context_surface function exists"
else
  fail "fn_context_surface function missing"
fi

# Test context surface function (should not error)
SURFACE_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.fn_context_surface(38.44, -122.71, 10000, 100);" 2>&1)
if [[ "$SURFACE_COUNT" =~ ^[[:space:]]*[0-9]+ ]]; then
  SURFACE_COUNT=$(echo "$SURFACE_COUNT" | tr -d '[:space:]')
  pass "fn_context_surface executes OK (returned $SURFACE_COUNT places)"
else
  fail "fn_context_surface execution failed"
fi

# ============================================
# 4. Project 75 Ingest Script
# ============================================
header "4. Project 75 Ingest Script"

# Check script exists
if [[ -f "scripts/ingest/airtable_project75_survey_csv.mjs" ]]; then
  pass "airtable_project75_survey_csv.mjs exists"
else
  fail "airtable_project75_survey_csv.mjs missing"
fi

# Check script is executable or at least parseable
if node --check scripts/ingest/airtable_project75_survey_csv.mjs 2>/dev/null; then
  pass "Script syntax valid"
else
  fail "Script has syntax errors"
fi

# Check it uses shared libs
if grep -q "from './_lib/csv_rfc4180.mjs'" scripts/ingest/airtable_project75_survey_csv.mjs; then
  pass "Uses shared csv_rfc4180.mjs"
else
  fail "Not using shared csv_rfc4180.mjs"
fi

if grep -q "from './_lib/ingest_run.mjs'" scripts/ingest/airtable_project75_survey_csv.mjs; then
  pass "Uses shared ingest_run.mjs"
else
  fail "Not using shared ingest_run.mjs"
fi

# ============================================
# 5. Shared Libraries
# ============================================
header "5. Shared Libraries"

if [[ -f "scripts/ingest/_lib/csv_rfc4180.mjs" ]]; then
  pass "csv_rfc4180.mjs exists"
else
  fail "csv_rfc4180.mjs missing"
fi

if [[ -f "scripts/ingest/_lib/ingest_run.mjs" ]]; then
  pass "ingest_run.mjs exists"
else
  fail "ingest_run.mjs missing"
fi

# ============================================
# 6. Pipeline Stats
# ============================================
header "6. Pipeline Stats"

info "Address candidates by source:"
psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_address_pipeline_by_source;"

info "Places count:"
psql "$DATABASE_URL" -t -c "SELECT COUNT(*) AS place_count FROM trapper.places;"

info "SoT addresses count:"
psql "$DATABASE_URL" -t -c "SELECT COUNT(*) AS sot_count FROM trapper.sot_addresses;"

# ============================================
# Summary
# ============================================
echo ""
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Summary${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${GREEN}PASS${RESET}: $PASS_COUNT"
echo -e "  ${RED}FAIL${RESET}: $FAIL_COUNT"
echo ""

if [[ $FAIL_COUNT -eq 0 ]]; then
  echo -e "${GREEN}All acceptance tests passed!${RESET}"
  exit 0
else
  echo -e "${RED}Some tests failed. Review output above.${RESET}"
  exit 1
fi
