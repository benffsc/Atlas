-- MIG_3046: Cat Determining System (CDS) infrastructure
-- Prerequisite: MIG_3043 (adds weight_lbs, match_score, match_signals to clinic_day_entries)
--
-- CDS is a 7-phase pipeline that automatically determines which master list line
-- maps to which ClinicHQ cat. It wraps existing SQL passes + composite matching
-- and adds waiver bridge, weight disambiguation, constraint propagation, and
-- optional LLM tiebreaker (gated, never auto-accepted).

BEGIN;

-- ── CDS run audit trail ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ops.cds_runs (
  run_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_date         DATE NOT NULL,
  triggered_by        TEXT NOT NULL,  -- 'import', 'rematch', 'manual'
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  phase_results       JSONB NOT NULL DEFAULT '{}',
  total_entries       INT NOT NULL DEFAULT 0,
  matched_before      INT NOT NULL DEFAULT 0,
  matched_after       INT NOT NULL DEFAULT 0,
  manual_preserved    INT NOT NULL DEFAULT 0,
  llm_suggestions     INT NOT NULL DEFAULT 0,
  unmatched_remaining INT NOT NULL DEFAULT 0,
  has_waivers         BOOLEAN NOT NULL DEFAULT FALSE,
  has_weights         BOOLEAN NOT NULL DEFAULT FALSE,
  config_snapshot     JSONB
);

CREATE INDEX IF NOT EXISTS idx_cds_runs_clinic_date
  ON ops.cds_runs(clinic_date);

CREATE INDEX IF NOT EXISTS idx_cds_runs_triggered
  ON ops.cds_runs(triggered_by, started_at DESC);

-- ── New columns on clinic_day_entries ────────────────────────────────────

ALTER TABLE ops.clinic_day_entries
  ADD COLUMN IF NOT EXISTS cds_run_id UUID REFERENCES ops.cds_runs(run_id),
  ADD COLUMN IF NOT EXISTS cds_method TEXT,
  ADD COLUMN IF NOT EXISTS cds_llm_reasoning TEXT;

-- Index for finding entries by CDS run
CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_cds_run
  ON ops.clinic_day_entries(cds_run_id)
  WHERE cds_run_id IS NOT NULL;

-- Index for finding CDS suggestions needing review
CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_cds_method
  ON ops.clinic_day_entries(cds_method)
  WHERE cds_method = 'cds_suggestion';

-- ── CDS config keys ─────────────────────────────────────────────────────

INSERT INTO ops.app_config (key, value, category, description) VALUES
  ('cds.thresholds.weight_gap_min', '1.0', 'cds', 'Min weight gap (lbs) for weight disambiguation'),
  ('cds.thresholds.waiver_bridge', '0.90', 'cds', 'Min confidence for waiver bridge match'),
  ('cds.llm.enabled', 'false', 'cds', 'Enable LLM tiebreaker for ambiguous matches'),
  ('cds.llm.max_calls_per_day', '5', 'cds', 'Max LLM calls per clinic day'),
  ('cds.llm.min_confidence', '0.70', 'cds', 'Min LLM confidence to keep suggestion')
ON CONFLICT (key) DO NOTHING;

COMMIT;
