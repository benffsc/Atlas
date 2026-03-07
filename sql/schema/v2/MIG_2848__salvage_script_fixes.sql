BEGIN;

-- MIG_2848: Fix airtable salvage script bugs (FFS-246, FFS-247, FFS-248)

-- FFS-248: UNIQUE constraint for idempotent equipment checkout re-runs
-- NOTE: ops.equipment_checkouts may not exist yet (created by salvage Phase C).
-- Use DO block to conditionally add constraint only if table exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'ops' AND table_name = 'equipment_checkouts') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_equipment_checkouts_source') THEN
      ALTER TABLE ops.equipment_checkouts
      ADD CONSTRAINT uq_equipment_checkouts_source UNIQUE(source_system, source_record_id);
    END IF;
  END IF;
END $$;

-- FFS-248: Source tracking on trip reports for idempotent re-runs
ALTER TABLE ops.trapper_trip_reports
ADD COLUMN IF NOT EXISTS source_system TEXT DEFAULT 'web_ui',
ADD COLUMN IF NOT EXISTS source_record_id TEXT;

-- FFS-248: UNIQUE constraint for idempotent trip report re-runs
-- Partial index: only enforce uniqueness when source_record_id is set
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_reports_source
ON ops.trapper_trip_reports (source_system, source_record_id)
WHERE source_record_id IS NOT NULL;

-- FFS-246: Fix free-text feeding_frequency → enum values, preserve raw in internal_notes
-- internal_notes gets the raw text appended BEFORE we overwrite feeding_frequency
UPDATE ops.requests SET
  internal_notes = CASE
    WHEN feeding_frequency NOT IN ('daily','few_times_week','occasionally','rarely')
    THEN COALESCE(internal_notes,'') || E'\n[Airtable feeding info] ' || feeding_frequency
    ELSE internal_notes END,
  feeding_frequency = CASE
    WHEN LOWER(feeding_frequency) LIKE '%daily%' THEN 'daily'
    WHEN LOWER(feeding_frequency) LIKE '%few times%' THEN 'few_times_week'
    WHEN LOWER(feeding_frequency) LIKE '%occasional%' OR LOWER(feeding_frequency) LIKE '%weekly%' THEN 'occasionally'
    WHEN LOWER(feeding_frequency) LIKE '%rare%' THEN 'rarely'
    ELSE NULL END
WHERE source_system LIKE 'airtable%'
  AND feeding_frequency IS NOT NULL
  AND feeding_frequency NOT IN ('daily','few_times_week','occasionally','rarely');

-- FFS-248: Backfill source_system on trapper assignments created by salvage script
UPDATE ops.request_trapper_assignments
SET source_system = 'airtable'
WHERE assigned_by = 'airtable_salvage' AND source_system IS NULL;

COMMIT;
