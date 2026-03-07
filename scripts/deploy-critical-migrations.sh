#!/bin/bash
#
# Deploy Critical Migrations for Atlas
#
# This script deploys the migrations required for:
# - Beacon Analytics (colony status, TNR metrics)
# - Data Quality Functions (Tippy tools)
#
# Usage:
#   ./scripts/deploy-critical-migrations.sh
#
# Prerequisites:
#   - DATABASE_URL environment variable set
#   - psql installed

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}ERROR: DATABASE_URL environment variable not set${NC}"
  echo "Set it with: export DATABASE_URL='postgres://...'"
  exit 1
fi

# Check psql
if ! command -v psql &> /dev/null; then
  echo -e "${RED}ERROR: psql not found${NC}"
  echo "Install PostgreSQL client tools"
  exit 1
fi

# Navigate to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$PROJECT_ROOT/sql/schema/sot"

echo "======================================"
echo "Atlas Critical Migrations Deployment"
echo "======================================"
echo ""

# Critical migrations in dependency order
MIGRATIONS=(
  # Infrastructure
  "MIG_489__migration_tracking.sql"

  # Colony tracking (dependency for Beacon)
  "MIG_209__colony_size_tracking.sql"

  # Seasonal analysis
  "MIG_291__seasonal_analysis_views.sql"

  # Beacon verification columns
  "MIG_293__add_verification_to_beacon_data.sql"

  # Source confidence (dependency for Beacon calculations)
  "MIG_482__source_confidence.sql"

  # Beacon calculation views
  "MIG_340__beacon_calculation_views.sql"

  # Beacon clustering
  "MIG_341__beacon_clustering.sql"

  # Data quality dependencies
  "MIG_483__junk_detection.sql"

  # Tippy data quality functions
  "MIG_487__tippy_data_quality.sql"
)

# Track results
SUCCEEDED=0
FAILED=0
SKIPPED=0

for mig in "${MIGRATIONS[@]}"; do
  mig_path="$MIGRATIONS_DIR/$mig"

  if [ ! -f "$mig_path" ]; then
    echo -e "${YELLOW}SKIP${NC}: $mig (file not found)"
    ((SKIPPED++))
    continue
  fi

  # Extract migration number from filename
  mig_num=$(echo "$mig" | grep -oE 'MIG_[0-9]+' | grep -oE '[0-9]+')

  echo -n "Deploying $mig... "

  # Run migration
  if psql "$DATABASE_URL" -f "$mig_path" > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
    ((SUCCEEDED++))

    # Record in tracking table (if it exists)
    psql "$DATABASE_URL" -c "SELECT ops.record_migration($mig_num, '$mig');" > /dev/null 2>&1 || true
  else
    echo -e "${RED}FAILED${NC}"
    ((FAILED++))

    # Show error details
    echo "  Error details:"
    psql "$DATABASE_URL" -f "$mig_path" 2>&1 | head -20
    echo ""
  fi
done

echo ""
echo "======================================"
echo "Deployment Summary"
echo "======================================"
echo -e "Succeeded: ${GREEN}$SUCCEEDED${NC}"
echo -e "Failed:    ${RED}$FAILED${NC}"
echo -e "Skipped:   ${YELLOW}$SKIPPED${NC}"
echo ""

if [ $FAILED -gt 0 ]; then
  echo -e "${RED}Some migrations failed. Check errors above.${NC}"
  exit 1
fi

echo -e "${GREEN}All critical migrations deployed successfully!${NC}"
echo ""
echo "Verify with:"
echo "  curl http://localhost:3000/api/health/db"
echo "  curl http://localhost:3000/api/beacon/health"
