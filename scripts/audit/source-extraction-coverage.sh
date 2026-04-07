#!/bin/bash
# ==============================================================================
# Source Extraction Coverage Audit (MIG_3053 / FFS-1154)
# ==============================================================================
# Reports how much of the source.*_raw payload key universe has been promoted
# to typed columns vs ignored vs still pending review.
#
# Part of FFS-1150 Atlas Data Hardening Initiative 5.
#
# Usage:
#   ./scripts/audit/source-extraction-coverage.sh
# ==============================================================================

set -e

if [ -f .env ]; then
  export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

echo "=============================================="
echo "Source Extraction Coverage Audit"
echo "MIG_3053 / FFS-1154"
echo "=============================================="
echo ""

echo "── Refresh discovery sweep ──────────────────"
psql "$DATABASE_URL" -c "SELECT * FROM ops.refresh_extraction_registry();"
echo ""

echo "── Coverage by source table ─────────────────"
psql "$DATABASE_URL" -c "
SELECT
  source_table,
  COUNT(*) FILTER (WHERE status = 'extracted')      AS extracted,
  COUNT(*) FILTER (WHERE status = 'ignored')        AS ignored,
  COUNT(*) FILTER (WHERE status = 'pending_review') AS pending,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'extracted') /
    NULLIF(COUNT(*), 0),
    1
  ) AS extracted_pct
FROM ops.source_extraction_registry
GROUP BY source_table
ORDER BY source_table;
"
echo ""

echo "── Top 10 pending review keys ───────────────"
psql "$DATABASE_URL" -c "
SELECT
  source_table,
  payload_key,
  last_seen_at::DATE,
  notes
FROM ops.source_extraction_registry
WHERE status = 'pending_review'
ORDER BY last_seen_at DESC
LIMIT 10;
"
echo ""

echo "── Drift check: keys never seen in last 30 days ──"
psql "$DATABASE_URL" -c "
SELECT
  source_table,
  payload_key,
  last_seen_at::DATE
FROM ops.source_extraction_registry
WHERE last_seen_at < NOW() - INTERVAL '30 days'
ORDER BY last_seen_at
LIMIT 10;
"
echo ""

echo "=============================================="
echo "Audit complete"
echo "=============================================="
