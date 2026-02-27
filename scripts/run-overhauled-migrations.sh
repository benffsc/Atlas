#!/bin/bash
# Run all Atlas Overhauled System migrations
#
# Usage: ./scripts/run-overhauled-migrations.sh
#
# Prerequisites:
# - DATABASE_URL environment variable set
# - psql installed
#
# This script runs migrations needed for:
# - CHUNK 12: Staff Verification
# - CHUNK 21: Data Quality Monitoring
# - CHUNK 22: VolunteerHub Enrichment
# - Request Intelligence (MIG_2522-2525)
# - Request Status Simplification (MIG_2530-2533)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "=============================================="
echo "  Atlas Overhauled System Migrations"
echo "=============================================="
echo ""

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  # Try to load from .env.local
  if [ -f ".env.local" ]; then
    export $(grep -E "^DATABASE_URL=" .env.local | xargs)
  fi

  if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL not set${NC}"
    echo "Set DATABASE_URL environment variable or create .env.local"
    exit 1
  fi
fi

echo -e "${GREEN}Database connection found${NC}"

# Navigate to migrations directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG_DIR="$SCRIPT_DIR/../sql/schema/v2"

if [ ! -d "$MIG_DIR" ]; then
  echo -e "${RED}Error: Migration directory not found: $MIG_DIR${NC}"
  exit 1
fi

cd "$MIG_DIR"
echo "Running migrations from: $MIG_DIR"
echo ""

# Function to run migration
run_mig() {
  local mig_file="$1"
  local description="$2"

  if [ ! -f "$mig_file" ]; then
    echo -e "${YELLOW}SKIP: $mig_file not found${NC}"
    return 0
  fi

  echo -e "${YELLOW}Running: $description${NC}"
  psql "$DATABASE_URL" -f "$mig_file" 2>&1 | grep -E "(NOTICE|ERROR|CRITICAL)" || true

  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo -e "${GREEN}✓ $description complete${NC}"
  else
    echo -e "${RED}✗ $description failed${NC}"
    exit 1
  fi
  echo ""
}

# Phase 1: Foundation
echo "====== Phase 1: Foundation ======"
run_mig "MIG_2514__staff_verification_schema.sql" "MIG_2514: Staff Verification Schema"
run_mig "MIG_2515__data_quality_monitoring.sql" "MIG_2515: Data Quality Monitoring"
run_mig "MIG_2516__volunteerhub_enrichment.sql" "MIG_2516: VolunteerHub Enrichment"

# Phase 2: Request Intelligence
echo "====== Phase 2: Request Intelligence ======"
run_mig "MIG_2522__requestor_site_contact_distinction.sql" "MIG_2522: Requestor vs Site Contact"
run_mig "MIG_2523__request_appointment_linking.sql" "MIG_2523: Request-Appointment Linking"
run_mig "MIG_2524__request_place_classification.sql" "MIG_2524: Request Place Classification"
run_mig "MIG_2525__request_list_view_site_contact.sql" "MIG_2525: Request List View"

# Phase 3: Request Status
echo "====== Phase 3: Request Status ======"
run_mig "MIG_2530__simplified_request_status.sql" "MIG_2530: Simplified Request Status"
run_mig "MIG_2531__intake_request_field_unification.sql" "MIG_2531: Intake-Request Field Unification"
run_mig "MIG_2532__complete_request_field_coverage.sql" "MIG_2532: Complete Request Field Coverage"
run_mig "MIG_2533__backfill_requests_from_intakes.sql" "MIG_2533: Backfill Requests from Intakes"

echo ""
echo "=============================================="
echo -e "${GREEN}  All migrations complete!${NC}"
echo "=============================================="
echo ""
echo "Next steps:"
echo "1. Restart the Atlas web app"
echo "2. Test /requests page"
echo "3. Test /admin/data-quality page"
echo ""
