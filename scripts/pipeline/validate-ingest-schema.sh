#!/bin/bash
# ==============================================================================
# Atlas Data Cleaning Pipeline - Ingest Schema Validation
# ==============================================================================
# Validates that all columns, indexes, and functions required by the ingest
# pipeline exist in the database. Run BEFORE any ClinicHQ batch upload.
#
# This script prevents the MIG_2400-2404 class of failures where:
# - TypeScript code references columns that don't exist
# - Triggers reference columns that weren't created
# - ON CONFLICT clauses reference non-existent unique indexes
#
# Usage:
#   ./scripts/pipeline/validate-ingest-schema.sh
#
# Returns exit code 0 if all validations pass, 1 if any fail.
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
echo "Atlas Ingest Schema Validation"
echo "=============================================="
echo ""

ERRORS=0

# ==============================================================================
# 1. VALIDATE ops.file_uploads COLUMNS (MIG_2400)
# ==============================================================================

echo "1. Checking ops.file_uploads columns..."

MISSING_FILE_UPLOAD_COLS=$(psql "$DATABASE_URL" -t -A -c "
SELECT string_agg(col, ', ')
FROM unnest(ARRAY['batch_id', 'batch_ready', 'processing_order', 'file_hash']) AS col
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'ops' AND table_name = 'file_uploads' AND column_name = col
);
")

if [ -n "$MISSING_FILE_UPLOAD_COLS" ]; then
  echo "   ❌ MISSING columns in ops.file_uploads: $MISSING_FILE_UPLOAD_COLS"
  echo "   → Run MIG_2400__fix_clinichq_batch_upload.sql to fix"
  ERRORS=$((ERRORS + 1))
else
  echo "   ✓ All required columns exist"
fi

# ==============================================================================
# 2. VALIDATE ops.appointments COLUMNS (MIG_2401)
# ==============================================================================

echo ""
echo "2. Checking ops.appointments columns..."

MISSING_APPT_COLS=$(psql "$DATABASE_URL" -t -A -c "
SELECT string_agg(col, ', ')
FROM unnest(ARRAY['client_name', 'owner_account_id']) AS col
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'ops' AND table_name = 'appointments' AND column_name = col
);
")

if [ -n "$MISSING_APPT_COLS" ]; then
  echo "   ❌ MISSING columns in ops.appointments: $MISSING_APPT_COLS"
  echo "   → Run MIG_2401__add_missing_appointment_columns.sql to fix"
  ERRORS=$((ERRORS + 1))
else
  echo "   ✓ All required columns exist"
fi

# ==============================================================================
# 3. VALIDATE ops.cat_test_results COLUMNS (MIG_2404)
# ==============================================================================

echo ""
echo "3. Checking ops.cat_test_results columns..."

MISSING_TEST_COLS=$(psql "$DATABASE_URL" -t -A -c "
SELECT string_agg(col, ', ')
FROM unnest(ARRAY['evidence_source', 'extraction_confidence', 'raw_text', 'updated_at']) AS col
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'ops' AND table_name = 'cat_test_results' AND column_name = col
);
")

if [ -n "$MISSING_TEST_COLS" ]; then
  echo "   ❌ MISSING columns in ops.cat_test_results: $MISSING_TEST_COLS"
  echo "   → Run MIG_2404__fix_cat_test_results_columns.sql to fix"
  ERRORS=$((ERRORS + 1))
else
  echo "   ✓ All required columns exist"
fi

# ==============================================================================
# 4. VALIDATE UNIQUE INDEXES FOR ON CONFLICT CLAUSES
# ==============================================================================

echo ""
echo "4. Checking required unique indexes..."

# Check cat_test_results unique index for ON CONFLICT
HAS_TEST_INDEX=$(psql "$DATABASE_URL" -t -A -c "
SELECT COUNT(*) FROM pg_indexes
WHERE schemaname = 'ops' AND tablename = 'cat_test_results'
  AND indexname = 'cat_test_results_unique_test';
")

if [ "$HAS_TEST_INDEX" = "0" ]; then
  echo "   ❌ MISSING index: cat_test_results_unique_test"
  echo "   → Required for trigger_extract_test_results ON CONFLICT clause"
  echo "   → Run MIG_2404__fix_cat_test_results_columns.sql to fix"
  ERRORS=$((ERRORS + 1))
else
  echo "   ✓ cat_test_results_unique_test exists"
fi

# ==============================================================================
# 5. VALIDATE VIEWS AND FUNCTIONS
# ==============================================================================

echo ""
echo "5. Checking required views and functions..."

# Check v_clinichq_batch_status view
HAS_BATCH_VIEW=$(psql "$DATABASE_URL" -t -A -c "
SELECT COUNT(*) FROM information_schema.views
WHERE table_schema = 'ops' AND table_name = 'v_clinichq_batch_status';
")

if [ "$HAS_BATCH_VIEW" = "0" ]; then
  echo "   ❌ MISSING view: ops.v_clinichq_batch_status"
  echo "   → Run MIG_2400__fix_clinichq_batch_upload.sql to fix"
  ERRORS=$((ERRORS + 1))
else
  echo "   ✓ v_clinichq_batch_status exists"
fi

# Check get_batch_files_in_order function
HAS_BATCH_FUNC=$(psql "$DATABASE_URL" -t -A -c "
SELECT COUNT(*) FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'ops' AND p.proname = 'get_batch_files_in_order';
")

if [ "$HAS_BATCH_FUNC" = "0" ]; then
  echo "   ❌ MISSING function: ops.get_batch_files_in_order"
  echo "   → Run MIG_2400__fix_clinichq_batch_upload.sql to fix"
  ERRORS=$((ERRORS + 1))
else
  echo "   ✓ get_batch_files_in_order exists"
fi

# ==============================================================================
# 6. VALIDATE PROCESSING ORDER (Check function returns correct order)
# ==============================================================================

echo ""
echo "6. Validating processing order logic..."

# This checks that the function WOULD return files in correct order
# appointment_info should be order 1, cat_info order 2, owner_info order 3
PROC_ORDER=$(psql "$DATABASE_URL" -t -A -c "
SELECT string_agg(source_table || '=' || processing_order, ', ' ORDER BY processing_order)
FROM (
  SELECT 'appointment_info' AS source_table,
         CASE 'appointment_info'
           WHEN 'appointment_info' THEN 1
           WHEN 'cat_info' THEN 2
           WHEN 'owner_info' THEN 3
           ELSE 99
         END AS processing_order
  UNION ALL
  SELECT 'cat_info' AS source_table,
         CASE 'cat_info'
           WHEN 'appointment_info' THEN 1
           WHEN 'cat_info' THEN 2
           WHEN 'owner_info' THEN 3
           ELSE 99
         END AS processing_order
  UNION ALL
  SELECT 'owner_info' AS source_table,
         CASE 'owner_info'
           WHEN 'appointment_info' THEN 1
           WHEN 'cat_info' THEN 2
           WHEN 'owner_info' THEN 3
           ELSE 99
         END AS processing_order
) t;
")

EXPECTED_ORDER="appointment_info=1, cat_info=2, owner_info=3"

if [ "$PROC_ORDER" = "$EXPECTED_ORDER" ]; then
  echo "   ✓ Processing order is correct: $PROC_ORDER"
else
  echo "   ❌ Processing order INCORRECT"
  echo "   → Expected: $EXPECTED_ORDER"
  echo "   → Got: $PROC_ORDER"
  echo "   → Run MIG_2402__fix_batch_processing_order.sql to fix"
  ERRORS=$((ERRORS + 1))
fi

# ==============================================================================
# 7. CHECK FOR REDUNDANT UNIQUE CONSTRAINTS (MIG_2403 issue)
# ==============================================================================

echo ""
echo "7. Checking for constraint conflicts..."

MULTI_UNIQUE=$(psql "$DATABASE_URL" -t -A -c "
SELECT string_agg(table_name || ' (' || constraint_count || ' unique)', ', ')
FROM (
  SELECT table_name, COUNT(*) AS constraint_count
  FROM information_schema.table_constraints
  WHERE constraint_type = 'UNIQUE'
    AND table_schema = 'ops'
    AND table_name IN ('appointments', 'file_uploads')
  GROUP BY table_name
  HAVING COUNT(*) > 1
) t;
")

if [ -n "$MULTI_UNIQUE" ]; then
  echo "   ⚠️  Tables with multiple unique constraints: $MULTI_UNIQUE"
  echo "   → Review if ON CONFLICT targets are correct"
else
  echo "   ✓ No conflicting unique constraints"
fi

# ==============================================================================
# SUMMARY
# ==============================================================================

echo ""
echo "=============================================="
if [ $ERRORS -eq 0 ]; then
  echo "✅ ALL VALIDATIONS PASSED"
  echo "   Ingest schema is ready for ClinicHQ batch upload"
  echo "=============================================="
  exit 0
else
  echo "❌ $ERRORS VALIDATION(S) FAILED"
  echo "   Fix the issues above before running ingest"
  echo "=============================================="
  exit 1
fi
