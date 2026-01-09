#!/usr/bin/env bash
# atlas_013_link_cats_to_places.sh
#
# Post-ingest script to link cats to places via owner addresses.
# Uses existing person-place relationships to establish cat locations.
#
# Prerequisites:
#   - MIG_020 and MIG_021 must be applied
#   - ATLAS_012 cats upsert must have run (sot_cats populated)
#   - person_place_relationships must have data
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/post_ingest/atlas_013_link_cats_to_places.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo -e "${BOLD}  ATLAS_013: Link Cats to Places${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Database preflight check
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../_lib/db_preflight.sh"

# ============================================
# Check prerequisites
# ============================================
echo -e "${BOLD}Checking prerequisites...${RESET}"
echo "─────────────────────────────────────────────"

# Check if cat_place_relationships table exists
TABLE_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'cat_place_relationships';
" | tr -d '[:space:]')

if [[ "$TABLE_EXISTS" -eq 0 ]]; then
    echo -e "${RED}ERROR:${RESET} cat_place_relationships table does not exist."
    echo ""
    echo "Please apply migrations first:"
    echo "  psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_020__cat_place_relationships.sql"
    echo "  psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_021__link_cats_to_places.sql"
    echo ""
    exit 1
fi

# Check if function exists
FUNC_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.routines
    WHERE routine_schema = 'trapper' AND routine_name = 'link_cats_to_places';
" | tr -d '[:space:]')

if [[ "$FUNC_EXISTS" -eq 0 ]]; then
    echo -e "${RED}ERROR:${RESET} link_cats_to_places function does not exist."
    echo ""
    echo "Please apply MIG_021:"
    echo "  psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_021__link_cats_to_places.sql"
    echo ""
    exit 1
fi

echo -e "${GREEN}Prerequisites OK${RESET}"
echo ""

# ============================================
# Show current state
# ============================================
echo -e "${BOLD}Current state:${RESET}"
echo "─────────────────────────────────────────────"

CATS_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.sot_cats;" | tr -d '[:space:]')
OWNERS_WITH_PLACES=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(DISTINCT pcr.person_id)
    FROM trapper.person_cat_relationships pcr
    JOIN trapper.person_place_relationships ppr ON ppr.person_id = trapper.canonical_person_id(pcr.person_id);
" | tr -d '[:space:]')
RELS_BEFORE=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM trapper.cat_place_relationships;" | tr -d '[:space:]')

echo -e "${CYAN}Total cats:${RESET} $CATS_COUNT"
echo -e "${CYAN}Cat owners with known places:${RESET} $OWNERS_WITH_PLACES"
echo -e "${CYAN}Existing cat-place relationships:${RESET} $RELS_BEFORE"
echo ""

# ============================================
# Run linker
# ============================================
echo -e "${BOLD}Running link_cats_to_places()...${RESET}"
echo "─────────────────────────────────────────────"

psql "$DATABASE_URL" -c "SELECT * FROM trapper.link_cats_to_places();"

echo ""

# Update place activity flags
echo -e "${CYAN}Updating place activity flags...${RESET}"
psql "$DATABASE_URL" -c "SELECT trapper.update_place_cat_activity_flags() AS places_updated;"

echo ""

# ============================================
# Show results
# ============================================
echo -e "${BOLD}Results:${RESET}"
echo "─────────────────────────────────────────────"

echo -e "${CYAN}Cat-place stats:${RESET}"
psql "$DATABASE_URL" -c "SELECT * FROM trapper.v_cat_place_stats;"

echo ""
echo -e "${CYAN}Sample cats with places:${RESET}"
psql "$DATABASE_URL" -c "
    SELECT
        cat_name,
        place_name,
        LEFT(formatted_address, 40) AS address,
        relationship_type,
        confidence
    FROM trapper.v_cat_primary_place
    WHERE place_id IS NOT NULL
    ORDER BY cat_name
    LIMIT 10;
"

echo ""
echo -e "${CYAN}Places with most cats:${RESET}"
psql "$DATABASE_URL" -c "
    SELECT
        place_name,
        LEFT(formatted_address, 35) AS address,
        total_cats,
        cats_home
    FROM trapper.v_places_with_cat_activity
    ORDER BY total_cats DESC
    LIMIT 10;
"

echo ""
echo -e "${GREEN}${BOLD}Cat-place linking complete.${RESET}"
echo ""
echo "Follow-up queries:"
echo "  psql \"\$DATABASE_URL\" -f sql/queries/QRY_023__cats_places_summary.sql"
echo "  psql \"\$DATABASE_URL\" -f sql/queries/QRY_024__top_places_by_cat_count.sql"
echo "  psql \"\$DATABASE_URL\" -f sql/queries/QRY_025__cats_missing_place.sql"
