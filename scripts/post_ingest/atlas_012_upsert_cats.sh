#!/usr/bin/env bash
# atlas_012_upsert_cats.sh
#
# Post-ingest script to upsert cats from ClinicHQ staged records.
# Creates canonical cat records and links to owners.
#
# Prerequisites:
#   - MIG_018 and MIG_019 must be applied
#   - ClinicHQ data must be ingested (cat_info, owner_info)
#   - Identity resolution must have run (sot_people populated)
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/post_ingest/atlas_012_upsert_cats.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo -e "${BOLD}  ATLAS_012: Upsert Cats from ClinicHQ${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Database preflight check
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../_lib/db_preflight.sh"

# ============================================
# Check prerequisites
# ============================================
echo -e "${BOLD}Checking prerequisites...${RESET}"
echo "─────────────────────────────────────────────"

# Check if sot_cats table exists
TABLE_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'sot_cats';
" | tr -d '[:space:]')

if [[ "$TABLE_EXISTS" -eq 0 ]]; then
    echo -e "${RED}ERROR:${RESET} sot_cats table does not exist."
    echo ""
    echo "Please apply migrations first:"
    echo "  psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_018__sot_cats_minimal.sql"
    echo "  psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_019__upsert_cats_and_views.sql"
    echo ""
    exit 1
fi

# Check if upsert function exists
FUNC_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.routines
    WHERE routine_schema = 'trapper' AND routine_name = 'upsert_cats_from_clinichq';
" | tr -d '[:space:]')

if [[ "$FUNC_EXISTS" -eq 0 ]]; then
    echo -e "${RED}ERROR:${RESET} upsert_cats_from_clinichq function does not exist."
    echo ""
    echo "Please apply MIG_019:"
    echo "  psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_019__upsert_cats_and_views.sql"
    echo ""
    exit 1
fi

echo -e "${GREEN}Prerequisites OK${RESET}"
echo ""

# ============================================
# Show current state
# ============================================
echo -e "${BOLD}Current cat counts:${RESET}"
echo "─────────────────────────────────────────────"

echo -e "${CYAN}Staged ClinicHQ records:${RESET}"
psql "$DATABASE_URL" -c "
    SELECT source_table, COUNT(*) AS records
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
      AND source_table IN ('cat_info', 'owner_info')
    GROUP BY 1
    ORDER BY 1;
"

CATS_BEFORE=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.sot_cats;" | tr -d '[:space:]')
IDENTS_BEFORE=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.cat_identifiers;" | tr -d '[:space:]')
RELS_BEFORE=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.person_cat_relationships;" | tr -d '[:space:]')

echo -e "${CYAN}Before upsert:${RESET} $CATS_BEFORE cats, $IDENTS_BEFORE identifiers, $RELS_BEFORE relationships"
echo ""

# ============================================
# Run upsert
# ============================================
echo -e "${BOLD}Running upsert_cats_from_clinichq()...${RESET}"
echo "─────────────────────────────────────────────"

psql "$DATABASE_URL" -c "SELECT * FROM trapper.upsert_cats_from_clinichq();"

echo ""

# ============================================
# Show results
# ============================================
echo -e "${BOLD}Results:${RESET}"
echo "─────────────────────────────────────────────"

CATS_AFTER=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.sot_cats;" | tr -d '[:space:]')
IDENTS_AFTER=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.cat_identifiers;" | tr -d '[:space:]')
RELS_AFTER=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.person_cat_relationships;" | tr -d '[:space:]')

echo -e "${GREEN}After upsert:${RESET} $CATS_AFTER cats, $IDENTS_AFTER identifiers, $RELS_AFTER relationships"
echo ""

echo -e "${CYAN}Cat stats:${RESET}"
psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_cats_stats;"

echo ""
echo -e "${CYAN}Sample cats with owners:${RESET}"
psql "$DATABASE_URL" -c "
    SELECT
        display_name AS cat,
        sex,
        altered_status,
        owner_names,
        primary_source
    FROM trapper.v_cats_unified
    WHERE owner_names IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 10;
"

echo ""
echo -e "${GREEN}${BOLD}Cat upsert complete.${RESET}"
