-- MIG_2959: System resilience foundation
-- FFS-635: App config change history (audit trail for ops.app_config)
-- FFS-636: Request status transition history (lifecycle analytics)
-- FFS-639: Clinic addresses moved from hardcoded values to config
--
-- All three are independent but grouped because they're Batch 1 of the
-- V2.6 System Resilience epic (FFS-634).

BEGIN;

-- ==========================================================================
-- Section A: FFS-635 — App Config Change History
-- ==========================================================================

CREATE TABLE IF NOT EXISTS ops.app_config_history (
  history_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  config_key   TEXT NOT NULL,
  old_value    JSONB,
  new_value    JSONB,
  changed_by   TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_source TEXT  -- e.g. 'web_ui', 'migration', 'api'
);

CREATE INDEX IF NOT EXISTS idx_app_config_history_key
  ON ops.app_config_history(config_key, changed_at DESC);

-- Trigger function: fires BEFORE UPDATE on ops.app_config
-- Only logs when value actually changed
CREATE OR REPLACE FUNCTION ops.app_config_log_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.value IS DISTINCT FROM NEW.value THEN
    INSERT INTO ops.app_config_history (config_key, old_value, new_value, changed_by, change_source)
    VALUES (OLD.key, OLD.value, NEW.value, NEW.updated_by, 'web_ui');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_config_log_change ON ops.app_config;
CREATE TRIGGER trg_app_config_log_change
  BEFORE UPDATE ON ops.app_config
  FOR EACH ROW
  EXECUTE FUNCTION ops.app_config_log_change();


-- ==========================================================================
-- Section B: FFS-636 — Request Status Transition History
-- ==========================================================================

CREATE TABLE IF NOT EXISTS ops.request_status_history (
  history_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id   UUID NOT NULL REFERENCES ops.requests(request_id),
  old_status   TEXT,
  new_status   TEXT NOT NULL,
  changed_by   TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason       TEXT
);

CREATE INDEX IF NOT EXISTS idx_request_status_history_request
  ON ops.request_status_history(request_id, changed_at DESC);

-- Trigger function: fires BEFORE UPDATE on ops.requests
-- Captures old/new status when status actually changes
CREATE OR REPLACE FUNCTION ops.request_log_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO ops.request_status_history (request_id, old_status, new_status)
    VALUES (OLD.request_id, OLD.status::TEXT, NEW.status::TEXT);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_request_log_status_change ON ops.requests;
CREATE TRIGGER trg_request_log_status_change
  BEFORE UPDATE ON ops.requests
  FOR EACH ROW
  EXECUTE FUNCTION ops.request_log_status_change();

-- View: Request lifecycle metrics
-- Computes time spent in each status via LAG window function
CREATE OR REPLACE VIEW ops.v_request_lifecycle_metrics AS
SELECT
  h.history_id,
  h.request_id,
  h.old_status,
  h.new_status,
  h.changed_by,
  h.changed_at,
  h.reason,
  EXTRACT(EPOCH FROM (
    h.changed_at - LAG(h.changed_at) OVER (PARTITION BY h.request_id ORDER BY h.changed_at)
  )) / 3600.0 AS hours_in_previous_status
FROM ops.request_status_history h;


-- ==========================================================================
-- Section C: FFS-639 — Clinic Addresses to Config
-- ==========================================================================

-- Insert config rows for clinic address patterns
INSERT INTO ops.app_config (key, value, description, category)
VALUES (
  'org.clinic_address_patterns',
  '["%1814%Empire Industrial%", "%1820%Empire Industrial%", "%845 Todd%"]'::jsonb,
  'ILIKE patterns for identifying FFSC clinic addresses. Used by ops.is_clinic_address() and health checks.',
  'org'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO ops.app_config (key, value, description, category)
VALUES (
  'org.clinic_place_kind',
  '"clinic"'::jsonb,
  'Place kind value used for clinic-type places.',
  'org'
)
ON CONFLICT (key) DO NOTHING;

-- Function: check if an address matches known clinic patterns
-- Reads patterns from ops.app_config so changing clinic addresses doesn't require code changes
CREATE OR REPLACE FUNCTION ops.is_clinic_address(p_address TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_patterns JSONB;
  v_pattern TEXT;
BEGIN
  IF p_address IS NULL THEN
    RETURN FALSE;
  END IF;

  v_patterns := ops.get_config('org.clinic_address_patterns', '[]'::jsonb);

  FOR v_pattern IN SELECT jsonb_array_elements_text(v_patterns)
  LOOP
    IF p_address ILIKE v_pattern THEN
      RETURN TRUE;
    END IF;
  END LOOP;

  RETURN FALSE;
END;
$$;

COMMIT;
