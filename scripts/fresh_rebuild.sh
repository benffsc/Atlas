#!/usr/bin/env bash
# DEPRECATED: References v1 trapper.* schema (dropped MIG_2299). Do not run.
# fresh_rebuild.sh
# ATLAS_024: Fresh database rebuild with fixed person extraction
#
# Usage:
#   set -a && source .env && set +a
#   ./scripts/fresh_rebuild.sh
#
# This script:
#   1. Applies all migrations in order (using existing DATABASE_URL)
#   2. Re-runs ingests with fixed extraction logic
#   3. Verifies the results

set -euo pipefail

# ============================================
# Colors
# ============================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}ATLAS Fresh Rebuild${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# ============================================
# Check environment
# ============================================
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo -e "${RED}ERROR: DATABASE_URL is not set${NC}"
    echo "Run: set -a && source .env && set +a"
    exit 1
fi

echo -e "${GREEN}DATABASE_URL is set${NC}"

# ============================================
# Step 1: Apply migrations in order
# ============================================
echo ""
echo -e "${BLUE}Step 1: Applying migrations...${NC}"

MIGRATIONS_DIR="sql/migrations"
for mig in $(ls -1 "$MIGRATIONS_DIR"/MIG_*.sql | sort -V); do
    echo -e "  Applying: ${YELLOW}$(basename "$mig")${NC}"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$mig" 2>&1 | grep -v "^$" | head -5 || true
done

echo -e "${GREEN}  All migrations applied.${NC}"

# ============================================
# Step 2: Clear derived people data
# ============================================
echo ""
echo -e "${BLUE}Step 2: Clearing derived people data...${NC}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'EOF'
-- Clear person-entity relationships
TRUNCATE trapper.person_cat_relationships CASCADE;
TRUNCATE trapper.person_place_relationships CASCADE;

-- Clear person linking
TRUNCATE trapper.staged_record_person_link CASCADE;

-- Clear person data
TRUNCATE trapper.person_aliases CASCADE;
TRUNCATE trapper.person_identifiers CASCADE;

-- Delete all people
DELETE FROM trapper.sot_people;

-- Clear observations (will re-populate)
TRUNCATE trapper.observations CASCADE;
EOF

echo -e "${GREEN}  Derived data cleared.${NC}"

# ============================================
# Step 3: Re-populate observations
# ============================================
echo ""
echo -e "${BLUE}Step 3: Re-populating observations...${NC}"

# Get list of source tables that have staged records
TABLES=$(psql "$DATABASE_URL" -t -A -c "SELECT DISTINCT source_table FROM trapper.staged_records WHERE source_table IS NOT NULL ORDER BY 1;")

for table in $TABLES; do
    echo -e "  Processing: ${YELLOW}${table}${NC}"
    count=$(psql "$DATABASE_URL" -t -A -c "SELECT trapper.populate_observations_for_latest_run('${table}');")
    echo -e "    Observations created: ${count}"
done

echo -e "${GREEN}  Observations populated.${NC}"

# ============================================
# Step 4: Create canonical people
# ============================================
echo ""
echo -e "${BLUE}Step 4: Creating canonical people...${NC}"

for table in $TABLES; do
    echo -e "  Processing: ${YELLOW}${table}${NC}"
    result=$(psql "$DATABASE_URL" -t -A -c "SELECT * FROM trapper.upsert_people_from_observations('${table}');")
    echo -e "    Result: ${result}"
done

echo -e "${GREEN}  People created.${NC}"

# ============================================
# Step 5: Update display names
# ============================================
echo ""
echo -e "${BLUE}Step 5: Updating display names...${NC}"

count=$(psql "$DATABASE_URL" -t -A -c "SELECT trapper.update_all_person_display_names();")
echo -e "  Display names updated: ${count}"

echo -e "${GREEN}  Display names updated.${NC}"

# ============================================
# Step 6: Verification
# ============================================
echo ""
echo -e "${BLUE}Step 6: Verification...${NC}"

echo ""
echo "People counts:"
psql "$DATABASE_URL" -c "
SELECT
    COUNT(*) AS total_people,
    COUNT(*) FILTER (WHERE trapper.is_valid_person_name(display_name)) AS valid_names,
    COUNT(*) FILTER (WHERE trapper.name_token_count(display_name) < 2) AS single_token,
    COUNT(*) FILTER (WHERE display_name ILIKE '%<%' OR display_name ILIKE '%http%') AS html_or_url
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL;
"

echo ""
echo "Observation field names (name_signal):"
psql "$DATABASE_URL" -c "
SELECT field_name, COUNT(*) AS count
FROM trapper.observations
WHERE observation_type = 'name_signal'
GROUP BY field_name
ORDER BY count DESC
LIMIT 10;
"

echo ""
echo "Check for split First/Last observations (should be 0):"
psql "$DATABASE_URL" -c "
SELECT COUNT(*) AS split_name_signals
FROM trapper.observations
WHERE observation_type = 'name_signal'
  AND field_name IN ('First Name', 'Last Name', 'Owner First Name', 'Owner Last Name');
"

# ============================================
# Done
# ============================================
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}Fresh rebuild complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Run acceptance tests: ./scripts/acceptance_test_atlas_019.sh"
echo "  2. Start dev server: cd apps/web && npm run dev"
echo "  3. Test search at http://localhost:3000"
echo ""
