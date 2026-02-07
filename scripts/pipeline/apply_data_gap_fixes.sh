#!/bin/bash
# ==============================================================================
# Atlas Data Cleaning Pipeline - Apply All Data Gap Fixes
# ==============================================================================
# Applies all data gap fix migrations in order.
#
# Usage:
#   ./scripts/pipeline/apply_data_gap_fixes.sh
#   ./scripts/pipeline/apply_data_gap_fixes.sh --dry-run
# ==============================================================================

set -e

DRY_RUN=false
if [ "$1" = "--dry-run" ]; then
  DRY_RUN=true
  echo "DRY RUN MODE - No changes will be made"
fi

# Load environment
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

echo "=============================================="
echo "Atlas Data Cleaning Pipeline - APPLY FIXES"
echo "=============================================="
echo ""

# List of data gap migrations in order
MIGRATIONS=(
  # DATA_GAP_009: FFSC org email pollution
  "sql/schema/sot/MIG_915__should_be_person_email_check.sql"
  "sql/schema/sot/MIG_916__sandra_cat_cleanup.sql"

  # DATA_GAP_010: Linda Price / location-as-person
  "sql/schema/sot/MIG_917__linda_price_cleanup.sql"

  # DATA_GAP_013: Identity resolution consolidation
  "sql/schema/sot/MIG_918__fix_intake_columns.sql"
  "sql/schema/sot/MIG_919__data_engine_consolidated_gate.sql"

  # DATA_GAP_014: Frances Batey / Bettina Kirby
  "sql/schema/sot/MIG_921__frances_bettina_fix.sql"
)

for mig in "${MIGRATIONS[@]}"; do
  if [ -f "$mig" ]; then
    echo "Applying: $mig"
    if [ "$DRY_RUN" = false ]; then
      psql "$DATABASE_URL" -f "$mig" 2>&1 | head -50
    else
      echo "  (dry run - skipped)"
    fi
    echo ""
  else
    echo "SKIP: $mig (file not found)"
  fi
done

echo "=============================================="
echo "Fixes Applied"
echo "=============================================="
echo ""
echo "Run ./scripts/pipeline/run_audit.sh to verify"
