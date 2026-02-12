#!/bin/bash
#
# Deploy V2 Architecture Migrations for Atlas
#
# This script deploys the 3-layer data architecture overhaul:
# - Layer 1 (Source): Raw ingested data from external systems
# - Layer 2 (OPS): Operational workflow tables
# - Layer 3 (SOT): Canonical entity tables (source of truth)
#
# Plus: Quarantine infrastructure, dual-write triggers, source change detection
#
# Usage:
#   source .env && ./scripts/deploy_v2_architecture.sh
#
# Prerequisites:
#   - DATABASE_URL environment variable set
#   - psql installed

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}ERROR: DATABASE_URL environment variable not set${NC}"
  echo "Set it with: source .env"
  exit 1
fi

# Check psql
if ! command -v psql &> /dev/null; then
  echo -e "${RED}ERROR: psql not found${NC}"
  echo "Install PostgreSQL client tools or use Supabase SQL Editor"
  exit 1
fi

# Navigate to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$PROJECT_ROOT/sql/schema/sot"

echo ""
echo "=============================================="
echo "  Atlas V2 Architecture Migration Deployment"
echo "=============================================="
echo ""
echo "This deploys the 3-layer data architecture:"
echo "  - source.* (raw external data)"
echo "  - ops.* (operational workflows)"
echo "  - sot.* (canonical entities)"
echo "  - audit.* (pattern detection)"
echo "  - quarantine.* (failed records)"
echo "  - atlas.* (configuration)"
echo ""

# V2 migrations in dependency order
# Phase 1: Core infrastructure (MIG_1000-1007) - in sql/schema/sot/
# Phase 1.5: Gaps and lessons (MIG_1008-1013) - in sql/schema/sot/
# Phase 2: Fresh Start (MIG_2000+) - in sql/schema/v2/
#
# NOTE: MIG_1005 is SKIPPED - we want fresh data processing, not V1 copy
# NOTE: Phase 2 migrations have "v2/" prefix to indicate different directory
MIGRATIONS=(
  # Phase 1: Core V2 Architecture (from /sql/schema/sot/)
  "MIG_1000__v2_create_schemas.sql"
  "MIG_1001__v2_quarantine_infrastructure.sql"
  "MIG_1002__v2_sot_tables.sql"
  "MIG_1003__v2_ops_tables.sql"
  "MIG_1004__v2_dual_write_triggers.sql"
  # SKIPPED: "MIG_1005__v2_historical_migration.sql" - V2 Fresh Start approach
  "MIG_1006__v2_source_change_detection.sql"
  "MIG_1007__v2_unified_detection_integration.sql"
  # Phase 1.5: Critical Gaps + Architectural Lessons (from /sql/schema/sot/)
  "MIG_1008__v2_badge_system.sql"
  "MIG_1009__v2_colony_architecture.sql"
  "MIG_1010__v2_dual_write_fixes.sql"
  "MIG_1011__v2_identity_functions.sql"
  "MIG_1012__v2_field_provenance.sql"
  "MIG_1013__v2_shelterluv_microchip_fix.sql"
  # Phase 2: Fresh Start (from /sql/schema/v2/)
  # These create source.*_raw tables and enhance OPS layer
  "v2/MIG_2000__v2_truncate_for_fresh_start.sql"
  "v2/MIG_2001__v2_raw_storage_tables.sql"
  "v2/MIG_2002__v2_ops_enhancements.sql"
)

# Track results
SUCCEEDED=0
FAILED=0
SKIPPED=0

echo -e "${BLUE}Starting migration deployment...${NC}"
echo ""

for mig in "${MIGRATIONS[@]}"; do
  # Handle v2/ prefix for Phase 2 migrations (in /sql/schema/v2/)
  if [[ "$mig" == v2/* ]]; then
    mig_path="$PROJECT_ROOT/sql/schema/$mig"
  else
    mig_path="$MIGRATIONS_DIR/$mig"
  fi

  if [ ! -f "$mig_path" ]; then
    echo -e "${YELLOW}SKIP${NC}: $mig (file not found)"
    ((SKIPPED++))
    continue
  fi

  # Extract migration number from filename
  mig_num=$(echo "$mig" | grep -oE 'MIG_[0-9]+' | grep -oE '[0-9]+')
  mig_desc=$(echo "$mig" | sed 's/MIG_[0-9]*__//' | sed 's/.sql$//' | tr '_' ' ')

  echo -n "[$mig_num] $mig_desc... "

  # Run migration with error capture
  if output=$(psql "$DATABASE_URL" -f "$mig_path" 2>&1); then
    # Check if output contains ERROR (some psql versions return 0 even on error)
    if echo "$output" | grep -q "ERROR:"; then
      echo -e "${RED}FAILED${NC}"
      ((FAILED++))
      echo "  Error:"
      echo "$output" | grep -A3 "ERROR:" | head -10
      echo ""
    else
      echo -e "${GREEN}OK${NC}"
      ((SUCCEEDED++))

      # Record in tracking table (if it exists)
      psql "$DATABASE_URL" -c "SELECT trapper.record_migration($mig_num, '$mig');" > /dev/null 2>&1 || true
    fi
  else
    echo -e "${RED}FAILED${NC}"
    ((FAILED++))

    # Show error details
    echo "  Error details:"
    echo "$output" | head -20
    echo ""
  fi
done

echo ""
echo "=============================================="
echo "  Deployment Summary"
echo "=============================================="
echo -e "Succeeded: ${GREEN}$SUCCEEDED${NC}"
echo -e "Failed:    ${RED}$FAILED${NC}"
echo -e "Skipped:   ${YELLOW}$SKIPPED${NC}"
echo ""

if [ $FAILED -gt 0 ]; then
  echo -e "${RED}Some migrations failed. Check errors above.${NC}"
  echo ""
  echo "You may need to fix errors and re-run, or run migrations"
  echo "manually in the Supabase SQL Editor."
  exit 1
fi

echo -e "${GREEN}All V2 migrations deployed successfully!${NC}"
echo ""
echo "Next steps:"
echo "  1. Dual-write is DISABLED by default"
echo "  2. Phase 2 (MIG_2000-2002) creates source.*_raw tables for fresh data processing"
echo "  3. Create V2 ingest scripts in /scripts/ingest-v2/"
echo "  4. Process source data fresh into V2"
echo "  5. To check status: SELECT * FROM atlas.v_migration_status;"
echo "  6. To view detection health: SELECT * FROM atlas.v_detection_health;"
echo ""
