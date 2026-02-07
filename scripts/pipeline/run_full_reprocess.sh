#!/bin/bash
# ==============================================================================
# Atlas Data Cleaning Pipeline - Full Reprocess
# ==============================================================================
# Runs the complete pipeline: all data gap fixes + entity linking + audit.
#
# This is the "nuclear option" - use when you want to ensure all data has been
# processed through the latest cleaning rules.
#
# Usage:
#   ./scripts/pipeline/run_full_reprocess.sh
#   ./scripts/pipeline/run_full_reprocess.sh --dry-run
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY_RUN=false

if [ "$1" = "--dry-run" ]; then
  DRY_RUN=true
  echo "DRY RUN MODE - Will only show what would be done"
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
echo "Atlas Data Cleaning Pipeline - FULL REPROCESS"
echo "=============================================="
echo ""
echo "This will:"
echo "  1. Apply all data gap fix migrations"
echo "  2. Run entity linking"
echo "  3. Run full audit"
echo ""

if [ "$DRY_RUN" = false ]; then
  read -p "Continue? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

echo ""
echo "=============================================="
echo "Step 1: Applying Data Gap Fixes"
echo "=============================================="
echo ""

if [ "$DRY_RUN" = true ]; then
  "$SCRIPT_DIR/apply_data_gap_fixes.sh" --dry-run
else
  "$SCRIPT_DIR/apply_data_gap_fixes.sh"
fi

echo ""
echo "=============================================="
echo "Step 2: Running Entity Linking"
echo "=============================================="
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "(dry run - skipping entity linking)"
else
  "$SCRIPT_DIR/run_entity_linking.sh"
fi

echo ""
echo "=============================================="
echo "Step 3: Running Audit"
echo "=============================================="
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "(dry run - skipping audit)"
else
  "$SCRIPT_DIR/run_audit.sh"
fi

echo ""
echo "=============================================="
echo "Full Reprocess Complete"
echo "=============================================="
echo ""
echo "Review the audit results above."
echo "If issues remain, see docs/DATA_GAPS.md"
