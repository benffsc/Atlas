#!/usr/bin/env bash
# acceptance_test_atlas_008.sh
#
# Verifies ATLAS_008 deliverables:
#   - MIG_010: Extensions + Normalizers
#   - MIG_011: Canonical People + Strong Identifiers
#   - MIG_012: Fuzzy Matching + Auto-Merge
#   - MIG_013: Undo/Reject/Split Workflow
#   - MIG_014: Relationships
#   - Query files
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/acceptance_test_atlas_008.sh

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
echo -e "${BOLD}  ATLAS_008 Acceptance Tests${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Database preflight check (validates DATABASE_URL, host, DNS)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib/db_preflight.sh"

# ============================================
# 1. MIG_010: Extensions + Normalizers
# ============================================
header "1. MIG_010: Extensions + Normalizers"

# Check extensions
for ext in pg_trgm unaccent fuzzystrmatch; do
  if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_extension WHERE extname = '$ext';" | grep -q 1; then
    pass "Extension $ext installed"
  else
    fail "Extension $ext missing"
  fi
done

# Check normalizer functions
for fn in norm_email norm_phone_us norm_name_key name_similarity extract_last_token name_token_count; do
  if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_proc WHERE proname = '$fn' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');" | grep -q 1; then
    pass "Function $fn exists"
  else
    fail "Function $fn missing"
  fi
done

# Test normalizers
if [[ $(psql "$DATABASE_URL" -t -c "SELECT trapper.norm_email('Test+tag@Gmail.com');" | tr -d '[:space:]') == "test@gmail.com" ]]; then
  pass "norm_email works correctly"
else
  fail "norm_email incorrect"
fi

if [[ $(psql "$DATABASE_URL" -t -c "SELECT trapper.norm_phone_us('(707) 555-1234');" | tr -d '[:space:]') == "7075551234" ]]; then
  pass "norm_phone_us works correctly"
else
  fail "norm_phone_us incorrect"
fi

# ============================================
# 2. MIG_011: People Core
# ============================================
header "2. MIG_011: People Core"

# Check tables
for tbl in sot_people person_identifiers person_aliases staged_record_person_link; do
  if psql "$DATABASE_URL" -t -c "SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = '$tbl';" | grep -q 1; then
    pass "Table $tbl exists"
  else
    fail "Table $tbl missing"
  fi
done

# Check functions
for fn in canonical_person_id upsert_people_from_observations populate_aliases_from_name_signals; do
  if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_proc WHERE proname = '$fn' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');" | grep -q 1; then
    pass "Function $fn exists"
  else
    fail "Function $fn missing"
  fi
done

# Check people exist
PEOPLE_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.sot_people;" | tr -d '[:space:]')
if [[ "$PEOPLE_COUNT" -gt 0 ]]; then
  pass "sot_people has $PEOPLE_COUNT records"
else
  fail "sot_people is empty"
fi

# ============================================
# 3. MIG_012: Fuzzy Matching
# ============================================
header "3. MIG_012: Fuzzy Matching"

# Check tables
for tbl in person_match_candidates person_match_decisions person_merges; do
  if psql "$DATABASE_URL" -t -c "SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = '$tbl';" | grep -q 1; then
    pass "Table $tbl exists"
  else
    fail "Table $tbl missing"
  fi
done

# Check functions
for fn in is_pair_blocked have_conflicting_identifiers have_shared_address_context generate_person_match_candidates apply_automerge_very_confident; do
  if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_proc WHERE proname = '$fn' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');" | grep -q 1; then
    pass "Function $fn exists"
  else
    fail "Function $fn missing"
  fi
done

# Test generate_person_match_candidates runs without error
RESULT=$(psql "$DATABASE_URL" -t -c "SELECT trapper.generate_person_match_candidates(NULL, 10);" 2>&1)
if [[ "$RESULT" =~ ^[[:space:]]*[0-9]+ ]]; then
  pass "generate_person_match_candidates executes OK"
else
  fail "generate_person_match_candidates failed: $RESULT"
fi

# Test apply_automerge_very_confident runs without error
RESULT=$(psql "$DATABASE_URL" -t -c "SELECT * FROM trapper.apply_automerge_very_confident(10);" 2>&1)
if [[ $? -eq 0 ]]; then
  pass "apply_automerge_very_confident executes OK"
else
  fail "apply_automerge_very_confident failed"
fi

# ============================================
# 4. MIG_013: Undo/Split Workflow
# ============================================
header "4. MIG_013: Undo/Split Workflow"

# Check functions
for fn in reject_person_match undo_person_merge split_person_create_new rebuild_person_after_split; do
  if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_proc WHERE proname = '$fn' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');" | grep -q 1; then
    pass "Function $fn exists"
  else
    fail "Function $fn missing"
  fi
done

# ============================================
# 5. MIG_014: Relationships
# ============================================
header "5. MIG_014: Relationships"

# Check tables
for tbl in person_relationships person_place_relationships; do
  if psql "$DATABASE_URL" -t -c "SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = '$tbl';" | grep -q 1; then
    pass "Table $tbl exists"
  else
    fail "Table $tbl missing"
  fi
done

# Check functions
if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_proc WHERE proname = 'derive_person_place_relationships' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');" | grep -q 1; then
  pass "Function derive_person_place_relationships exists"
else
  fail "Function derive_person_place_relationships missing"
fi

# ============================================
# 6. Query Files
# ============================================
header "6. Query Files"

for qry in QRY_007__person_candidate_review.sql QRY_008__people_with_places.sql QRY_009__automerge_audit.sql; do
  if [[ -f "sql/queries/$qry" ]]; then
    pass "Query file $qry exists"
  else
    fail "Query file $qry missing"
  fi
done

# ============================================
# 7. Data Stats
# ============================================
header "7. Data Stats"

info "People stats:"
psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_people_stats;"

info "Identifiers by type:"
psql "$DATABASE_URL" -c "SELECT id_type, COUNT(*) FROM trapper.person_identifiers GROUP BY 1 ORDER BY 1;"

info "Match candidates by status:"
psql "$DATABASE_URL" -c "SELECT status, COUNT(*) FROM trapper.person_match_candidates GROUP BY 1 ORDER BY 1;"

info "Person merges:"
psql "$DATABASE_URL" -c "SELECT is_reverted, COUNT(*) FROM trapper.person_merges GROUP BY 1;"

info "Person-place relationships:"
psql "$DATABASE_URL" -t -c "SELECT COUNT(*) AS person_place_count FROM trapper.person_place_relationships;"

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
