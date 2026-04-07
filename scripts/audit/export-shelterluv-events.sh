#!/bin/bash
# ==============================================================================
# ShelterLuv Events Decision-Ready Export (FFS-1154 triage)
# ==============================================================================
# Part of FFS-1150 Atlas Data Hardening, Initiative 5 follow-up.
#
# Dumps ShelterLuv event data from source.shelterluv_raw in a format
# designed for human triage of whether/how to ingest them into
# sot.cat_lifecycle_events.
#
# Background: 13,691 events in source.shelterluv_raw span 2004-04-30 to
# 2026-03-06, touching 4,131 distinct animals and 3,070 distinct people.
# sot.cat_lifecycle_events already has 42,777 rows (mostly tnr_procedure
# from ClinicHQ). Some ShelterLuv event types appear partially mapped
# (adoption, foster_start, foster_end, mortality). Others are unmapped
# (Intake.FeralWildlife, Intake.Stray, Intake.OwnerSurrender).
#
# This script tells you exactly what's in the gap so you can decide:
# (a) mass-ingest everything unmapped, (b) pick specific event types,
# (c) leave it for later.
#
# Usage:
#   ./scripts/audit/export-shelterluv-events.sh
#
# ==============================================================================

set -e
cd "$(dirname "$0")/../.."

if [ -f .env ]; then
  export DATABASE_URL=$(grep "^DATABASE_URL=" .env | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

echo "================================================================"
echo "  ShelterLuv Events Triage Export"
echo "  FFS-1154 Source Extraction Registry follow-up"
echo "================================================================"
echo ""

echo "── 1. Event type distribution (source.shelterluv_raw) ───────────"
psql "$DATABASE_URL" -c "
SELECT
  payload->>'Type'    AS event_type,
  payload->>'Subtype' AS subtype,
  COUNT(*)            AS count
FROM source.shelterluv_raw
WHERE record_type = 'event'
GROUP BY 1, 2
ORDER BY count DESC
LIMIT 30;"

echo ""
echo "── 2. Date range of events ──────────────────────────────────────"
psql "$DATABASE_URL" -c "
WITH ev AS (
  SELECT TO_TIMESTAMP((payload->>'Time')::BIGINT) AS event_at
  FROM source.shelterluv_raw WHERE record_type='event'
)
SELECT
  MIN(event_at)::DATE AS earliest,
  MAX(event_at)::DATE AS latest,
  COUNT(*)            AS total_events,
  ROUND(EXTRACT(YEAR FROM AGE(MAX(event_at), MIN(event_at))), 1) AS years_covered
FROM ev;"

echo ""
echo "── 3. Existing sot.cat_lifecycle_events coverage ────────────────"
psql "$DATABASE_URL" -c "
SELECT event_type, COUNT(*)
FROM sot.cat_lifecycle_events
GROUP BY 1
ORDER BY 2 DESC;"

echo ""
echo "── 4. Gap analysis: unmapped ShelterLuv event types ─────────────"
echo "   (heuristic match — verify before trusting)"
psql "$DATABASE_URL" -c "
WITH sl_types AS (
  SELECT payload->>'Type' AS sl_type, COUNT(*) AS sl_count
  FROM source.shelterluv_raw WHERE record_type='event'
  GROUP BY 1
),
atlas_types AS (
  SELECT event_type, COUNT(*) AS atlas_count
  FROM sot.cat_lifecycle_events
  GROUP BY 1
)
SELECT
  sl.sl_type                                            AS shelterluv_type,
  sl.sl_count                                           AS shelterluv_count,
  COALESCE(at.atlas_count, 0)                           AS atlas_count_closest,
  CASE
    WHEN sl.sl_type = 'Outcome.Adoption'       THEN 'likely maps to adoption'
    WHEN sl.sl_type = 'Outcome.Foster'         THEN 'likely maps to foster_start'
    WHEN sl.sl_type = 'Intake.FosterReturn'    THEN 'likely maps to foster_end'
    WHEN sl.sl_type = 'Outcome.Euthanasia'     THEN 'likely maps to mortality'
    WHEN sl.sl_type = 'Outcome.DiedInCare'     THEN 'likely maps to mortality'
    WHEN sl.sl_type = 'Outcome.Transfer'       THEN 'likely maps to transfer'
    WHEN sl.sl_type = 'Outcome.FeralWildlife'  THEN 'likely maps to return_to_field'
    WHEN sl.sl_type LIKE 'Intake.%'            THEN 'UNMAPPED — new intake event type'
    WHEN sl.sl_type LIKE 'Outcome.%'           THEN 'UNMAPPED — new outcome event type'
    ELSE 'unknown'
  END AS hypothesis
FROM sl_types sl
LEFT JOIN atlas_types at ON FALSE  -- just for shape
GROUP BY 1, 2, 3
ORDER BY 2 DESC;"

echo ""
echo "── 5. Sample records for each major event type ──────────────────"
psql "$DATABASE_URL" -c "
WITH ranked AS (
  SELECT
    payload->>'Type'    AS event_type,
    TO_TIMESTAMP((payload->>'Time')::BIGINT)::DATE AS event_date,
    payload->>'User'    AS user_field,
    payload->'AssociatedRecords' AS assoc,
    ROW_NUMBER() OVER (PARTITION BY payload->>'Type' ORDER BY (payload->>'Time')::BIGINT DESC) AS rn
  FROM source.shelterluv_raw
  WHERE record_type='event'
)
SELECT event_type, event_date, user_field, jsonb_pretty(assoc) AS associated_records
FROM ranked
WHERE rn = 1
ORDER BY event_type;"

echo ""
echo "── 6. Coverage by animal: how many Atlas cats would get events? ─"
psql "$DATABASE_URL" -c "
WITH event_animals AS (
  SELECT DISTINCT ar->>'Id' AS slv_internal_id
  FROM source.shelterluv_raw e,
       jsonb_array_elements(e.payload->'AssociatedRecords') ar
  WHERE e.record_type='event' AND ar->>'Type'='Animal'
)
SELECT
  COUNT(*) AS shelterluv_animals_with_events,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM sot.cat_identifiers ci
    WHERE ci.id_type='shelterluv_animal_id' AND ci.id_value = ea.slv_internal_id
  )) AS matched_via_identifier_table,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM sot.cats c WHERE c.shelterluv_animal_id = ea.slv_internal_id
  )) AS matched_via_denormalized_column,
  COUNT(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM sot.cat_identifiers ci
    WHERE ci.id_type='shelterluv_animal_id' AND ci.id_value = ea.slv_internal_id
  ) AND NOT EXISTS (
    SELECT 1 FROM sot.cats c WHERE c.shelterluv_animal_id = ea.slv_internal_id
  )) AS orphan_animals
FROM event_animals ea;"

echo ""
echo "── 7. Decision matrix ──────────────────────────────────────────"
cat <<'EOF'

Based on the data above, your options:

  A) MASS INGEST (riskiest, highest reward)
     - Write a migration that iterates source.shelterluv_raw events,
       maps Type/Subtype to sot.cat_lifecycle_events.event_type via
       a lookup table, populates the 4,131 matched animals.
     - Pro: 13,691 years of historical operational data promoted
     - Con: Some mappings are guesses (especially Intake.* types).
       Wrong mappings pollute historical metrics.

  B) PICK SPECIFIC TYPES (surgical)
     - Only ingest types where the mapping is unambiguous:
       Outcome.Adoption → adoption, Outcome.Euthanasia → mortality,
       etc. Skip the fuzzy ones (Intake.FeralWildlife — what IS this?).
     - Pro: Low risk of pollution. Can expand later.
     - Con: Leaves some rich data on the table.

  C) EXPAND THE SCHEMA
     - Add new event types to the existing cat_lifecycle_events enum
       or constraint (Intake.FeralWildlife → feral_intake, etc.).
       Then ingest.
     - Pro: Most expressive, no lossy mapping.
     - Con: Requires schema change + retrofit of existing consumers.

  D) LEAVE FOR LATER
     - Mark AssociatedRecords as extracted=false in the registry with
       a note "deferred until event semantics confirmed with FFSC".
     - Pro: Zero risk.
     - Con: Data keeps aging in bronze.

Recommendation: B for quick wins, then C for the unmapped Intake.*
types after verifying semantics with a ShelterLuv power user.
EOF
