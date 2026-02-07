#!/bin/bash
# ==============================================================================
# Atlas Data Cleaning Pipeline - Entity Linking
# ==============================================================================
# Runs the full entity linking process that connects staged records to SoT.
#
# This is what the cron job runs every 15 minutes. You can run it manually
# to trigger immediate processing.
#
# Usage:
#   ./scripts/pipeline/run_entity_linking.sh
# ==============================================================================

set -e

# Load environment
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

echo "=============================================="
echo "Atlas Data Cleaning Pipeline - ENTITY LINKING"
echo "=============================================="
echo ""

# Run entity linking steps in order
echo "Step 1a: process_clinichq_cat_info..."
psql "$DATABASE_URL" -c "SELECT * FROM trapper.process_clinichq_cat_info(500);" 2>&1

echo ""
echo "Step 1b: process_clinichq_owner_info..."
psql "$DATABASE_URL" -c "SELECT * FROM trapper.process_clinichq_owner_info(NULL, 500);" 2>&1

echo ""
echo "Step 1c: process_clinichq_unchipped_cats..."
psql "$DATABASE_URL" -c "SELECT * FROM trapper.process_clinichq_unchipped_cats(500);" 2>&1

echo ""
echo "Step 1d: process_clinic_euthanasia..."
psql "$DATABASE_URL" -c "SELECT * FROM trapper.process_clinic_euthanasia(500);" 2>&1

echo ""
echo "Step 1e: process_embedded_microchips_in_animal_names..."
psql "$DATABASE_URL" -c "SELECT * FROM trapper.process_embedded_microchips_in_animal_names();" 2>&1

echo ""
echo "Step 1f: retry_unmatched_master_list_entries..."
psql "$DATABASE_URL" -c "SELECT * FROM trapper.retry_unmatched_master_list_entries(100);" 2>&1

echo ""
echo "Step 2: run_all_entity_linking..."
psql "$DATABASE_URL" -c "SELECT * FROM trapper.run_all_entity_linking();" 2>&1

echo ""
echo "=============================================="
echo "Entity Linking Complete"
echo "=============================================="
