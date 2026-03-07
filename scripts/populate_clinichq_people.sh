#!/usr/bin/env bash
# DEPRECATED: References v1 trapper.* schema (dropped MIG_2299). Do not run.
# populate_clinichq_people.sh
# ATLAS_028: One-command ClinicHQ canonical people population
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/populate_clinichq_people.sh
#
# Options:
#   --dry-run    Preview what would happen without making changes
#   --no-repair  Skip stuck run repair step
#
# This script:
#   1. Repairs any stuck ClinicHQ ingest runs
#   2. Populates observations from owner_info
#   3. Creates canonical people
#   4. Populates aliases
#   5. Updates display names
#   6. Shows final counts

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
# Parse arguments
# ============================================
DRY_RUN=false
REPAIR_STUCK=true

for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --no-repair)
            REPAIR_STUCK=false
            shift
            ;;
        *)
            # Unknown option
            ;;
    esac
done

# ============================================
# Check environment
# ============================================
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo -e "${RED}ERROR: DATABASE_URL is not set${NC}"
    echo "Run: set -a && source .env && set +a"
    exit 1
fi

# ============================================
# Header
# ============================================
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}ClinicHQ Canonical People Population${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}DRY RUN MODE - No changes will be made${NC}"
    echo ""
fi

# ============================================
# Step 1: Check for stuck runs
# ============================================
echo -e "${BLUE}Step 1: Checking for stuck ClinicHQ runs...${NC}"

stuck_count=$(psql "$DATABASE_URL" -t -A -c "
SELECT COUNT(*)
FROM trapper.v_stuck_ingest_runs
WHERE source_system = 'clinichq';
" 2>/dev/null || echo "0")

if [[ "$stuck_count" -gt 0 ]]; then
    echo -e "${YELLOW}  Found $stuck_count stuck run(s)${NC}"

    if [[ "$REPAIR_STUCK" == "true" ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
            echo "  Preview of repairs:"
            psql "$DATABASE_URL" -c "
SELECT source_table, run_age_minutes, suggested_action
FROM trapper.v_stuck_ingest_runs
WHERE source_system = 'clinichq';
"
        else
            echo "  Repairing stuck runs..."
            psql "$DATABASE_URL" -c "
SELECT * FROM trapper.repair_stuck_ingest_runs('clinichq', 30, FALSE);
"
        fi
    else
        echo -e "${YELLOW}  Skipping repair (--no-repair flag)${NC}"
    fi
else
    echo -e "${GREEN}  No stuck runs found${NC}"
fi
echo ""

# ============================================
# Step 2: Check for completed run
# ============================================
echo -e "${BLUE}Step 2: Checking for completed owner_info run...${NC}"

run_id=$(psql "$DATABASE_URL" -t -A -c "
SELECT trapper.get_latest_completed_run('clinichq', 'owner_info');
" 2>/dev/null || echo "")

if [[ -z "$run_id" || "$run_id" == "" ]]; then
    echo -e "${RED}  ERROR: No completed clinichq owner_info run found${NC}"
    echo "  Please run ingest first or repair stuck runs"
    exit 1
fi

echo -e "${GREEN}  Found completed run: ${run_id:0:8}...${NC}"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}DRY RUN - Stopping here. Run without --dry-run to proceed.${NC}"
    exit 0
fi

# ============================================
# Step 3: Populate observations
# ============================================
echo -e "${BLUE}Step 3: Populating observations...${NC}"

obs_count=$(psql "$DATABASE_URL" -t -A -c "
SELECT trapper.populate_observations_for_latest_run('owner_info');
" 2>/dev/null || echo "0")

echo -e "${GREEN}  Observations created: $obs_count${NC}"
echo ""

# ============================================
# Step 4: Create canonical people
# ============================================
echo -e "${BLUE}Step 4: Creating canonical people...${NC}"

psql "$DATABASE_URL" -c "
SELECT * FROM trapper.upsert_people_from_observations('owner_info');
"
echo ""

# ============================================
# Step 5: Populate aliases
# ============================================
echo -e "${BLUE}Step 5: Populating aliases...${NC}"

alias_count=$(psql "$DATABASE_URL" -t -A -c "
SELECT trapper.populate_aliases_from_name_signals('owner_info');
" 2>/dev/null || echo "0")

echo -e "${GREEN}  Aliases added: $alias_count${NC}"
echo ""

# ============================================
# Step 6: Update display names
# ============================================
echo -e "${BLUE}Step 6: Updating display names...${NC}"

display_count=$(psql "$DATABASE_URL" -t -A -c "
SELECT trapper.update_all_person_display_names();
" 2>/dev/null || echo "0")

echo -e "${GREEN}  Display names updated: $display_count${NC}"
echo ""

# ============================================
# Final summary
# ============================================
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Final Summary${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

psql "$DATABASE_URL" -c "
SELECT
    'Canonical People' AS metric,
    COUNT(*) AS count
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL

UNION ALL

SELECT
    'Valid Names' AS metric,
    COUNT(*) AS count
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
AND trapper.is_valid_person_name(display_name)

UNION ALL

SELECT
    'Person Aliases' AS metric,
    COUNT(*) AS count
FROM trapper.person_aliases

UNION ALL

SELECT
    'ClinicHQ Observations' AS metric,
    COUNT(*) AS count
FROM trapper.observations
WHERE source_system = 'clinichq';
"

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}ClinicHQ people population complete!${NC}"
echo -e "${GREEN}============================================${NC}"
