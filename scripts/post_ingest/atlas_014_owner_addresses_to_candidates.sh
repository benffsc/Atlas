#!/usr/bin/env bash
# atlas_014_owner_addresses_to_candidates.sh
#
# Post-ingest script to extract ClinicHQ owner addresses into the
# address pipeline, geocode them, and derive person-place relationships.
#
# This dramatically increases cat-to-place coverage by creating
# person_place_relationships for cat owners.
#
# Prerequisites:
#   - MIG_022 must be applied
#   - ClinicHQ owner_info must be ingested
#   - GOOGLE_PLACES_API_KEY must be set for geocoding
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/post_ingest/atlas_014_owner_addresses_to_candidates.sh
#   ./scripts/post_ingest/atlas_014_owner_addresses_to_candidates.sh --limit 500
#   ./scripts/post_ingest/atlas_014_owner_addresses_to_candidates.sh --dry-run

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# Defaults
GEOCODE_LIMIT="${GEOCODE_LIMIT:-200}"
DRY_RUN=false

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --limit) GEOCODE_LIMIT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) shift ;;
  esac
done

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"
echo -e "${BOLD}  ATLAS_014: Owner Addresses Pipeline${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════${RESET}"

# Database preflight check
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../_lib/db_preflight.sh"

# ============================================
# Check prerequisites
# ============================================
echo -e "${BOLD}Checking prerequisites...${RESET}"
echo "─────────────────────────────────────────────"

# Check if v_clinichq_owner_latest view exists
VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'trapper' AND table_name = 'v_clinichq_owner_latest';
" | tr -d '[:space:]')

if [[ "$VIEW_EXISTS" -eq 0 ]]; then
    echo -e "${RED}ERROR:${RESET} v_clinichq_owner_latest view does not exist."
    echo ""
    echo "Please apply MIG_022 first:"
    echo "  psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_022__owner_addresses_to_candidates.sql"
    echo ""
    exit 1
fi

# Check for Google API key
if [[ -z "$GOOGLE_PLACES_API_KEY" ]] && [[ "$DRY_RUN" != "true" ]]; then
    echo -e "${YELLOW}WARN:${RESET} GOOGLE_PLACES_API_KEY not set. Geocoding will be skipped."
    echo "  Set in .env to enable geocoding."
    SKIP_GEOCODE=true
else
    SKIP_GEOCODE=false
fi

echo -e "${GREEN}Prerequisites OK${RESET}"
echo ""

# ============================================
# Baseline counts
# ============================================
echo -e "${BOLD}Baseline counts:${RESET}"
echo "─────────────────────────────────────────────"

echo -e "${CYAN}Owner address stats:${RESET}"
psql "$DATABASE_URL" -c "SELECT * FROM sot.v_owner_address_stats;"

BASELINE_PPR=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM sot.person_place_relationships;" | tr -d '[:space:]')
BASELINE_CPR=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM sot.cat_place_relationships;" | tr -d '[:space:]')
BASELINE_ADDRESSES=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM sot.addresses;" | tr -d '[:space:]')

echo -e "${CYAN}Baseline:${RESET}"
echo "  person_place_relationships: $BASELINE_PPR"
echo "  cat_place_relationships: $BASELINE_CPR"
echo "  sot_addresses: $BASELINE_ADDRESSES"
echo ""

# ============================================
# Step 1: Geocode owner addresses
# ============================================
if [[ "$SKIP_GEOCODE" != "true" ]]; then
    echo -e "${BOLD}Step 1: Geocoding owner addresses...${RESET}"
    echo "─────────────────────────────────────────────"
    echo -e "${CYAN}Limit:${RESET} $GEOCODE_LIMIT addresses"
    echo ""

    DRY_RUN_FLAG=""
    if [[ "$DRY_RUN" == "true" ]]; then
        DRY_RUN_FLAG="--dry-run"
    fi

    node scripts/normalize/geocode_owner_addresses.mjs --limit "$GEOCODE_LIMIT" $DRY_RUN_FLAG

    echo ""
else
    echo -e "${BOLD}Step 1: Skipping geocoding (no API key)${RESET}"
    echo "─────────────────────────────────────────────"
    echo ""
fi

# ============================================
# Step 2: Seed places from new addresses
# ============================================
if [[ "$DRY_RUN" != "true" ]]; then
    echo -e "${BOLD}Step 2: Seeding places from addresses...${RESET}"
    echo "─────────────────────────────────────────────"

    psql "$DATABASE_URL" -c "SELECT sot.seed_places_from_addresses() AS places_seeded;"

    echo ""
fi

# ============================================
# Step 3: Derive person-place relationships
# ============================================
if [[ "$DRY_RUN" != "true" ]]; then
    echo -e "${BOLD}Step 3: Deriving person-place relationships...${RESET}"
    echo "─────────────────────────────────────────────"

    psql "$DATABASE_URL" -c "SELECT sot.derive_person_place_relationships('owner_info') AS relationships_created;"

    echo ""
fi

# ============================================
# Step 4: Rerun cat-place linker
# ============================================
if [[ "$DRY_RUN" != "true" ]]; then
    echo -e "${BOLD}Step 4: Relinking cats to places...${RESET}"
    echo "─────────────────────────────────────────────"

    psql "$DATABASE_URL" -c "SELECT * FROM sot.link_cats_to_places();"

    # Update place activity flags
    psql "$DATABASE_URL" -c "SELECT sot.update_place_cat_activity_flags() AS places_updated;"

    echo ""
fi

# ============================================
# Results
# ============================================
echo -e "${BOLD}Results:${RESET}"
echo "─────────────────────────────────────────────"

NEW_PPR=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM sot.person_place_relationships;" | tr -d '[:space:]')
NEW_CPR=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM sot.cat_place_relationships;" | tr -d '[:space:]')
NEW_ADDRESSES=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM sot.addresses;" | tr -d '[:space:]')

echo -e "${CYAN}After pipeline:${RESET}"
echo "  sot_addresses: $BASELINE_ADDRESSES → $NEW_ADDRESSES (+$((NEW_ADDRESSES - BASELINE_ADDRESSES)))"
echo "  person_place_relationships: $BASELINE_PPR → $NEW_PPR (+$((NEW_PPR - BASELINE_PPR)))"
echo "  cat_place_relationships: $BASELINE_CPR → $NEW_CPR (+$((NEW_CPR - BASELINE_CPR)))"
echo ""

echo -e "${CYAN}Cat-place coverage:${RESET}"
psql "$DATABASE_URL" -c "
    SELECT
        (SELECT COUNT(*) FROM sot.cats) AS total_cats,
        (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place_relationships) AS cats_with_place,
        ROUND(100.0 * (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place_relationships) /
            NULLIF((SELECT COUNT(*) FROM sot.cats), 0), 1) AS pct_coverage;
"

echo ""
echo -e "${GREEN}${BOLD}Owner address pipeline complete.${RESET}"
echo ""
echo "Follow-up queries:"
echo "  psql \"\$DATABASE_URL\" -f sql/queries/QRY_026__owner_addresses_stats.sql"
echo "  psql \"\$DATABASE_URL\" -f sql/queries/QRY_027__address_candidate_funnel.sql"
echo "  psql \"\$DATABASE_URL\" -f sql/queries/QRY_028__cat_place_coverage.sql"
