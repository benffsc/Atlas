#!/bin/bash
#
# Deploy Unified Data Engine Migrations (MIG_467 - MIG_470)
#
# These migrations add:
#   - MIG_467: Unified Data Engine Core (processor registry, dispatch function)
#   - MIG_468: VolunteerHub Processing (volunteer + foster role capture)
#   - MIG_469: ShelterLuv Foster/Adopter (adopter role, foster detection)
#   - MIG_470: Intake Relationships (feeder/caretaker capture)
#
# Usage:
#   ./scripts/deploy_migrations_467_470.sh
#
# Prerequisites:
#   - DATABASE_URL environment variable set
#   - psql installed and accessible

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Deploy Unified Data Engine Migrations (MIG_467 - MIG_470)          ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check for DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}ERROR: DATABASE_URL environment variable is not set${NC}"
    echo ""
    echo "Please set DATABASE_URL before running this script:"
    echo "  export DATABASE_URL='postgresql://...'"
    echo ""
    exit 1
fi

# Verify connection
echo -e "${YELLOW}Verifying database connection...${NC}"
if ! psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Cannot connect to database${NC}"
    exit 1
fi
echo -e "${GREEN}Connection verified${NC}"
echo ""

# Show what will be deployed
echo -e "${YELLOW}Migrations to deploy:${NC}"
echo "  1. MIG_467__unified_data_engine.sql (18KB)"
echo "     - Processor registry table"
echo "     - assign_person_role() function"
echo "     - Unified dispatch function"
echo ""
echo "  2. MIG_468__volunteerhub_processing.sql (15KB)"
echo "     - VolunteerHub user processor"
echo "     - Volunteer role assignment"
echo "     - Foster detection from tags"
echo ""
echo "  3. MIG_469__shelterluv_foster_adopter.sql (21KB)"
echo "     - Adopter role creation"
echo "     - Foster detection from animals"
echo "     - Backfill existing relationships"
echo ""
echo "  4. MIG_470__intake_relationships.sql (10KB)"
echo "     - Feeder/caretaker relationships"
echo "     - Intake auto-processing trigger"
echo ""

# Confirm
read -p "Continue with deployment? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Deployment cancelled${NC}"
    exit 0
fi

echo ""
echo -e "${CYAN}Starting deployment...${NC}"
echo ""

# Run migrations
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_DIR="$SCRIPT_DIR/../sql/schema/sot"

run_migration() {
    local file=$1
    local name=$2
    echo -e "${YELLOW}Running $name...${NC}"
    if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL_DIR/$file" 2>&1; then
        echo -e "${GREEN}$name completed${NC}"
        echo ""
    else
        echo -e "${RED}ERROR: $name failed${NC}"
        exit 1
    fi
}

run_migration "MIG_467__unified_data_engine.sql" "MIG_467"
run_migration "MIG_468__volunteerhub_processing.sql" "MIG_468"
run_migration "MIG_469__shelterluv_foster_adopter.sql" "MIG_469"
run_migration "MIG_470__intake_relationships.sql" "MIG_470"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Deployment Complete!                                                ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Verification
echo -e "${YELLOW}Verifying deployment...${NC}"
echo ""

echo "Registered processors:"
psql "$DATABASE_URL" -c "SELECT processor_name, source_system, source_table, entity_type FROM ops.data_engine_processors ORDER BY priority;"

echo ""
echo "Role distribution:"
psql "$DATABASE_URL" -c "SELECT role, COUNT(*) as count FROM sot.person_roles GROUP BY role ORDER BY count DESC;"

echo ""
echo -e "${GREEN}All migrations deployed successfully!${NC}"
echo ""
echo "Next steps:"
echo "  1. Verify the app is working: GET /api/version"
echo "  2. Check processors: /admin/data-engine/processors"
echo "  3. Monitor logs for any errors"
echo ""
