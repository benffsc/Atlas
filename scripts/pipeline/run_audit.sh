#!/bin/bash
# ==============================================================================
# Atlas Data Cleaning Pipeline - Audit Script
# ==============================================================================
# Runs all audit queries to identify data quality issues without making changes.
# Safe to run anytime.
#
# Usage:
#   ./scripts/pipeline/run_audit.sh
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
echo "Atlas Data Cleaning Pipeline - AUDIT"
echo "=============================================="
echo ""

# Run comprehensive audit
echo "Running DATA_GAP_013 audit..."
psql "$DATABASE_URL" -f sql/schema/sot/MIG_920__data_gap_013_audit.sql

echo ""
echo "=============================================="
echo "Additional Audits"
echo "=============================================="

# Check for merge chain issues
echo ""
echo "Checking for merge chain issues..."
psql "$DATABASE_URL" -c "
SELECT 'Multi-hop merge chains' as issue, COUNT(*) as count
FROM sot.people p1
JOIN sot.people p2 ON p1.merged_into_person_id = p2.person_id
WHERE p2.merged_into_person_id IS NOT NULL;
"

# Check for duplicate identifiers
echo ""
echo "Checking for duplicate email assignments..."
psql "$DATABASE_URL" -c "
SELECT pi.id_value_norm as email, COUNT(DISTINCT pi.person_id) as person_count
FROM sot.person_identifiers pi
JOIN sot.people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
WHERE pi.id_type = 'email'
GROUP BY pi.id_value_norm
HAVING COUNT(DISTINCT pi.person_id) > 1
ORDER BY person_count DESC
LIMIT 10;
"

# Check for Frances/Bettina type issues
echo ""
echo "Checking for potential name-email mismatches (trapper emails on non-trapper records)..."
psql "$DATABASE_URL" -c "
SELECT p.display_name, pi.id_value_norm as email,
  (SELECT role FROM sot.person_roles WHERE person_id = p.person_id LIMIT 1) as role
FROM sot.people p
JOIN sot.person_identifiers pi ON pi.person_id = p.person_id AND pi.id_type = 'email'
WHERE p.merged_into_person_id IS NULL
  AND pi.id_value_norm LIKE '%kirby%'
  OR pi.id_value_norm LIKE '%brady%'
  OR pi.id_value_norm LIKE '%nicander%'
ORDER BY p.display_name;
"

echo ""
echo "=============================================="
echo "Entity Linking Health Check"
echo "=============================================="

echo ""
echo "Running ops.check_entity_linking_health()..."
psql "$DATABASE_URL" -c "SELECT * FROM ops.check_entity_linking_health();"

echo ""
echo "Recent entity linking runs (last 7 days)..."
psql "$DATABASE_URL" -c "
SELECT run_id, status, created_at,
  result->>'step1_coverage_pct' as place_coverage,
  result->>'step2_cats_linked' as cats_linked,
  result->>'step5_appointments_linked_to_owners' as appts_to_owners,
  result->>'step6_appointments_linked_to_requests_tier1' as appts_to_requests,
  result->>'duration_ms' as duration_ms
FROM ops.entity_linking_runs
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 5;
"

echo ""
echo "=============================================="
echo "Audit Complete"
echo "=============================================="
echo ""
echo "Review results above. If issues found, see docs/DATA_GAPS.md"
