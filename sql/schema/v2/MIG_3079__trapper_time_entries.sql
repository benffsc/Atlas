-- MIG_3079: Trapper Time Entries
--
-- Tracks paid trapper hours per period (weekly for employees, monthly for contractors).
-- Crystal Furtado transitioned from monthly contractor to weekly paid employee.
-- Historical monthly data is preserved for Beacon analytics.
--
-- Designed to scale: currently only Crystal is paid, but any trapper
-- could become paid in the future.

BEGIN;

-- =============================================================================
-- TABLE: ops.trapper_time_entries
-- =============================================================================

CREATE TABLE ops.trapper_time_entries (
  entry_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who
  person_id         UUID NOT NULL REFERENCES sot.people(person_id),

  -- When (period)
  period_type       TEXT NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,

  -- Hours breakdown
  hours_total       NUMERIC(6,2) NOT NULL DEFAULT 0,
  hours_trapping    NUMERIC(6,2) DEFAULT 0,
  hours_admin       NUMERIC(6,2) DEFAULT 0,
  hours_transport   NUMERIC(6,2) DEFAULT 0,
  hours_training    NUMERIC(6,2) DEFAULT 0,
  hours_other       NUMERIC(6,2) DEFAULT 0,

  -- Compensation
  pay_type          TEXT NOT NULL DEFAULT 'hourly' CHECK (pay_type IN ('hourly', 'flat', 'stipend')),
  hourly_rate       NUMERIC(8,2),
  total_pay         NUMERIC(10,2),

  -- Workflow
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved')),
  submitted_at      TIMESTAMPTZ,
  approved_by       TEXT,
  approved_at       TIMESTAMPTZ,

  -- Context
  notes             TEXT,
  work_summary      TEXT,  -- brief description of what was done

  -- Provenance
  source_system     TEXT DEFAULT 'atlas_ui',
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate entries for same trapper + period
  UNIQUE (person_id, period_start, period_end),

  -- Period_end must be after period_start
  CHECK (period_end >= period_start)
);

CREATE INDEX idx_tte_person ON ops.trapper_time_entries(person_id);
CREATE INDEX idx_tte_period ON ops.trapper_time_entries(period_start, period_end);
CREATE INDEX idx_tte_status ON ops.trapper_time_entries(status);

COMMENT ON TABLE ops.trapper_time_entries IS 'Paid trapper hours per period. Weekly for employees, monthly for contractors. Feeds Beacon trapper activity analytics.';
COMMENT ON COLUMN ops.trapper_time_entries.period_type IS 'weekly = paid employee timesheets, monthly = contractor invoices (legacy for Crystal pre-2026).';
COMMENT ON COLUMN ops.trapper_time_entries.hours_total IS 'Total hours worked. Should equal sum of category hours, but allowed to diverge for flexibility.';
COMMENT ON COLUMN ops.trapper_time_entries.pay_type IS 'hourly = per-hour rate, flat = flat fee per period, stipend = fixed monthly amount.';

-- Trigger: updated_at
CREATE TRIGGER trg_trapper_time_entries_updated_at
  BEFORE UPDATE ON ops.trapper_time_entries
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

-- =============================================================================
-- VIEW: ops.v_trapper_time_summary
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_trapper_time_summary AS
SELECT
  tte.entry_id,
  tte.person_id,
  p.display_name AS trapper_name,
  pr.trapper_type,
  tte.period_type,
  tte.period_start,
  tte.period_end,
  tte.hours_total::float8 AS hours_total,
  tte.hours_trapping::float8 AS hours_trapping,
  tte.hours_admin::float8 AS hours_admin,
  tte.hours_transport::float8 AS hours_transport,
  tte.hours_training::float8 AS hours_training,
  tte.hours_other::float8 AS hours_other,
  tte.pay_type,
  tte.hourly_rate::float8 AS hourly_rate,
  tte.total_pay::float8 AS total_pay,
  tte.status,
  tte.submitted_at,
  tte.approved_by,
  tte.approved_at,
  tte.notes,
  tte.work_summary,
  tte.created_at,
  tte.updated_at
FROM ops.trapper_time_entries tte
JOIN sot.people p ON p.person_id = tte.person_id
LEFT JOIN sot.person_roles pr ON pr.person_id = tte.person_id AND pr.role = 'trapper';

COMMENT ON VIEW ops.v_trapper_time_summary IS 'Trapper time entries with display names and trapper type. Used by /api/admin/trapper-hours.';

-- =============================================================================
-- NAV ITEM
-- =============================================================================

INSERT INTO ops.nav_items (sidebar, section, label, path, icon, sort_order)
VALUES ('admin', 'Dashboard', 'Trapper Hours', '/admin/trapper-hours', 'clock', 26);

COMMIT;
