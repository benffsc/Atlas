#!/bin/bash
# acceptance_test_atlas_005.sh
# ATLAS_005 Acceptance Test Script
#
# Prerequisites:
#   1. Apply MIG_003: psql "$DATABASE_URL" -f sql/migrations/MIG_003__ingest_runs.sql
#   2. Set environment: set -a && source .env && set +a
#
# Usage:
#   ./scripts/acceptance_test_atlas_005.sh

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}ATLAS_005 Acceptance Tests${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"

# Check environment
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL not set${NC}"
    echo "Run: set -a && source .env && set +a"
    exit 1
fi

# CSV file path - use the actual file
CSV_FILE="${1:-$HOME/Desktop/AI_Ingest/airtable/trapping_requests/trapping_requests_2026-01-08.csv.csv}"

if [ ! -f "$CSV_FILE" ]; then
    echo -e "${RED}Error: CSV file not found: $CSV_FILE${NC}"
    exit 1
fi

echo -e "\n${CYAN}CSV File:${NC} $CSV_FILE"

# ============================================
# Step 1: Apply Migration (if not already applied)
# ============================================
echo -e "\n${BOLD}Step 1: Checking migration...${NC}"
echo "Run this if not already applied:"
echo "  psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_003__ingest_runs.sql"

# Check if ingest_runs table exists
TABLE_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'ingest_runs');" 2>/dev/null | xargs)
if [ "$TABLE_EXISTS" = "t" ]; then
    echo -e "  ${GREEN}✓ trapper.ingest_runs exists${NC}"
else
    echo -e "  ${RED}✗ trapper.ingest_runs NOT FOUND - apply migration first${NC}"
    exit 1
fi

# ============================================
# Step 2: Run Ingest
# ============================================
echo -e "\n${BOLD}Step 2: Running ingest...${NC}"
cd /Users/benmisdiaz/Projects/Atlas
node scripts/ingest/airtable_trapping_requests_csv.mjs --csv "$CSV_FILE"

# ============================================
# Step 3: Verify latest run row_count = 273
# ============================================
echo -e "\n${BOLD}Step 3: Verify latest run row_count = 273${NC}"
ROW_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT row_count FROM trapper.v_latest_ingest_run WHERE source_table='trapping_requests';" 2>/dev/null | xargs)
echo "  Latest run row_count: $ROW_COUNT"
if [ "$ROW_COUNT" = "273" ]; then
    echo -e "  ${GREEN}✓ PASS: row_count = 273${NC}"
else
    echo -e "  ${RED}✗ FAIL: expected 273, got $ROW_COUNT${NC}"
fi

# ============================================
# Step 4: Verify run_records count = 273
# ============================================
echo -e "\n${BOLD}Step 4: Verify run_records count = 273${NC}"
LINKED_COUNT=$(psql "$DATABASE_URL" -t -c "
SELECT COUNT(*)
FROM trapper.ingest_run_records irr
JOIN trapper.v_latest_ingest_run lr ON lr.run_id = irr.run_id
WHERE lr.source_table='trapping_requests';" 2>/dev/null | xargs)
echo "  Run records linked: $LINKED_COUNT"
if [ "$LINKED_COUNT" = "273" ]; then
    echo -e "  ${GREEN}✓ PASS: run_records = 273${NC}"
else
    echo -e "  ${RED}✗ FAIL: expected 273, got $LINKED_COUNT${NC}"
fi

# ============================================
# Step 5: Verify junk candidates count = 0
# ============================================
echo -e "\n${BOLD}Step 5: Verify junk candidates = 0${NC}"
JUNK_COUNT=$(psql "$DATABASE_URL" -t -c "
SELECT COUNT(*)
FROM trapper.v_candidate_addresses_from_trapping_requests
WHERE address_raw ILIKE '%airtableusercontent%'
   OR address_raw ~ '^[0-9]{5}(-[0-9]{4})?\$'
   OR UPPER(address_raw) IN ('CA','CALIFORNIA');" 2>/dev/null | xargs)
echo "  Junk candidates: $JUNK_COUNT"
if [ "$JUNK_COUNT" = "0" ]; then
    echo -e "  ${GREEN}✓ PASS: junk candidates = 0${NC}"
else
    echo -e "  ${RED}✗ FAIL: expected 0, got $JUNK_COUNT${NC}"
fi

# ============================================
# Step 6: Show sample candidates (sanity check)
# ============================================
echo -e "\n${BOLD}Step 6: Sample candidates (first 10)${NC}"
psql "$DATABASE_URL" -c "
SELECT
    address_role,
    LEFT(address_raw, 80) AS address_preview
FROM trapper.v_candidate_addresses_from_trapping_requests
LIMIT 10;"

# ============================================
# Step 7: Show candidate count
# ============================================
echo -e "\n${BOLD}Step 7: Candidate counts${NC}"
CANDIDATE_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.v_candidate_addresses_from_trapping_requests;" 2>/dev/null | xargs)
echo "  Total candidates available for geocoding: $CANDIDATE_COUNT"

# ============================================
# Step 8: Show suspect row stats
# ============================================
echo -e "\n${BOLD}Step 8: Suspect row summary${NC}"
psql "$DATABASE_URL" -c "
SELECT
    issue_type,
    severity,
    COUNT(*) AS count
FROM trapper.data_issues
WHERE entity_type = 'staged_record'
  AND NOT is_resolved
GROUP BY issue_type, severity
ORDER BY severity DESC, count DESC;"

# ============================================
# Step 9: source_row_id coverage
# ============================================
echo -e "\n${BOLD}Step 9: source_row_id coverage${NC}"
psql "$DATABASE_URL" -c "
SELECT
    COUNT(*) AS total,
    COUNT(source_row_id) AS with_id,
    ROUND(100.0 * COUNT(source_row_id) / COUNT(*), 1) AS coverage_pct
FROM trapper.staged_records sr
JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
JOIN trapper.v_latest_ingest_run lr ON lr.run_id = irr.run_id
WHERE lr.source_table = 'trapping_requests';"

# ============================================
# Summary
# ============================================
echo -e "\n${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}SUMMARY${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo "  Latest run row_count: $ROW_COUNT (expected: 273)"
echo "  Run records linked:   $LINKED_COUNT (expected: 273)"
echo "  Junk candidates:      $JUNK_COUNT (expected: 0)"
echo "  Total candidates:     $CANDIDATE_COUNT"
echo ""

if [ "$ROW_COUNT" = "273" ] && [ "$LINKED_COUNT" = "273" ] && [ "$JUNK_COUNT" = "0" ]; then
    echo -e "${GREEN}${BOLD}ALL ACCEPTANCE TESTS PASSED!${NC}"
    echo ""
    echo -e "${CYAN}Next steps (ATLAS_006):${NC}"
    echo "  1. Geocode small batch:"
    echo "     node scripts/normalize/geocode_candidates.mjs --limit 25 --verbose"
    echo ""
    echo "  2. Check pipeline stats:"
    echo "     psql \"\$DATABASE_URL\" -c \"SELECT * FROM trapper.v_geocode_pipeline_stats;\""
    echo ""
    echo "  3. Review failures:"
    echo "     psql \"\$DATABASE_URL\" -c \"SELECT reason, COUNT(*) FROM trapper.address_review_queue WHERE NOT is_resolved GROUP BY reason;\""
else
    echo -e "${RED}${BOLD}SOME TESTS FAILED - Review output above${NC}"
    exit 1
fi
