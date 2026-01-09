-- MIG_247__request_counts.sql
-- MEGA_003: Cat counts model with audit-friendly history
--
-- Core principle: "Total Cats" vs "Needing TNR" are different numbers
-- - Never discard historical count values
-- - Represent uncertainty explicitly (confidence levels)
-- - Support Beacon's "75% alteration" reporting concept
--
-- SAFE: Additive only, no destructive operations

-- ============================================================
-- PART 1: Request Counts (current best estimates)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.request_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which request this count belongs to
    request_id UUID NOT NULL REFERENCES trapper.requests(id) ON DELETE CASCADE,

    -- Raw reported totals
    cats_reported_total SMALLINT,          -- Total cats mentioned by client
    cats_needing_tnr_estimate SMALLINT,    -- Estimated cats needing TNR
    cats_already_altered_estimate SMALLINT, -- Already fixed (ear-tipped, known)
    cats_caught_or_handled SMALLINT,       -- Cats caught/handled by FFSC
    kittens_observed SMALLINT,             -- Kittens seen (may need foster)

    -- Derived progress
    cats_progress_pct NUMERIC(5,2),        -- caught/needing_tnr (guard div0)

    -- Source and confidence
    source_system TEXT NOT NULL CHECK (source_system IN (
        'airtable',     -- From Airtable intake/notes
        'clinichq',     -- From ClinicHQ appointment data
        'manual',       -- Staff entered in Cockpit
        'derived'       -- Computed from other fields
    )),
    confidence TEXT NOT NULL CHECK (confidence IN (
        'low',          -- Rough estimate, historical/messy data
        'medium',       -- Reasonable estimate
        'high'          -- Verified count (ear-tip check, known colony)
    )) DEFAULT 'medium',

    -- When these counts were captured/updated
    as_of_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE trapper.request_counts IS
'Current best estimate of cat counts for a request. Supports "Total vs TNR-needed" distinction.';

-- One active count per request (latest is authoritative)
CREATE UNIQUE INDEX IF NOT EXISTS idx_request_counts_request_unique
ON trapper.request_counts(request_id, as_of_date);

CREATE INDEX IF NOT EXISTS idx_request_counts_request
ON trapper.request_counts(request_id);

-- ============================================================
-- PART 2: Request Counts History (audit ledger)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.request_counts_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Reference to counts record (or NULL if record was deleted)
    counts_id UUID REFERENCES trapper.request_counts(id) ON DELETE SET NULL,
    request_id UUID NOT NULL,  -- Keep even if counts_id is null

    -- Snapshot of all values at this point in time
    cats_reported_total SMALLINT,
    cats_needing_tnr_estimate SMALLINT,
    cats_already_altered_estimate SMALLINT,
    cats_caught_or_handled SMALLINT,
    kittens_observed SMALLINT,
    cats_progress_pct NUMERIC(5,2),
    source_system TEXT,
    confidence TEXT,
    as_of_date DATE,
    notes TEXT,

    -- What happened
    change_type TEXT NOT NULL CHECK (change_type IN (
        'created',      -- New count record
        'updated',      -- Existing record modified
        'superseded'    -- New as_of_date record replaced this one
    )),
    change_reason TEXT,
    changed_fields TEXT[],  -- Which fields changed

    -- Audit
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_by TEXT DEFAULT 'system'
);

COMMENT ON TABLE trapper.request_counts_history IS
'Audit ledger of all count changes. Never discard prior values.';

CREATE INDEX IF NOT EXISTS idx_request_counts_history_request
ON trapper.request_counts_history(request_id);

CREATE INDEX IF NOT EXISTS idx_request_counts_history_counts
ON trapper.request_counts_history(counts_id);

-- ============================================================
-- PART 3: Trigger to auto-record history
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.fn_request_counts_audit()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO trapper.request_counts_history (
            counts_id, request_id, cats_reported_total, cats_needing_tnr_estimate,
            cats_already_altered_estimate, cats_caught_or_handled, kittens_observed,
            cats_progress_pct, source_system, confidence, as_of_date, notes,
            change_type, recorded_by
        ) VALUES (
            NEW.id, NEW.request_id, NEW.cats_reported_total, NEW.cats_needing_tnr_estimate,
            NEW.cats_already_altered_estimate, NEW.cats_caught_or_handled, NEW.kittens_observed,
            NEW.cats_progress_pct, NEW.source_system, NEW.confidence, NEW.as_of_date, NEW.notes,
            'created', NEW.created_by
        );
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        -- Record which fields changed
        INSERT INTO trapper.request_counts_history (
            counts_id, request_id, cats_reported_total, cats_needing_tnr_estimate,
            cats_already_altered_estimate, cats_caught_or_handled, kittens_observed,
            cats_progress_pct, source_system, confidence, as_of_date, notes,
            change_type, changed_fields, recorded_by
        ) VALUES (
            NEW.id, NEW.request_id, NEW.cats_reported_total, NEW.cats_needing_tnr_estimate,
            NEW.cats_already_altered_estimate, NEW.cats_caught_or_handled, NEW.kittens_observed,
            NEW.cats_progress_pct, NEW.source_system, NEW.confidence, NEW.as_of_date, NEW.notes,
            'updated',
            ARRAY_REMOVE(ARRAY[
                CASE WHEN OLD.cats_reported_total IS DISTINCT FROM NEW.cats_reported_total THEN 'cats_reported_total' END,
                CASE WHEN OLD.cats_needing_tnr_estimate IS DISTINCT FROM NEW.cats_needing_tnr_estimate THEN 'cats_needing_tnr_estimate' END,
                CASE WHEN OLD.cats_already_altered_estimate IS DISTINCT FROM NEW.cats_already_altered_estimate THEN 'cats_already_altered_estimate' END,
                CASE WHEN OLD.cats_caught_or_handled IS DISTINCT FROM NEW.cats_caught_or_handled THEN 'cats_caught_or_handled' END,
                CASE WHEN OLD.kittens_observed IS DISTINCT FROM NEW.kittens_observed THEN 'kittens_observed' END,
                CASE WHEN OLD.confidence IS DISTINCT FROM NEW.confidence THEN 'confidence' END
            ], NULL),
            COALESCE(NEW.created_by, 'system')
        );
        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_request_counts_audit ON trapper.request_counts;
CREATE TRIGGER trg_request_counts_audit
AFTER INSERT OR UPDATE ON trapper.request_counts
FOR EACH ROW EXECUTE FUNCTION trapper.fn_request_counts_audit();

-- ============================================================
-- PART 4: View for best current counts per request
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_request_counts_best AS
SELECT DISTINCT ON (request_id)
    request_id,
    cats_reported_total,
    cats_needing_tnr_estimate,
    cats_already_altered_estimate,
    cats_caught_or_handled,
    kittens_observed,
    -- Calculate progress (guard div0)
    CASE
        WHEN COALESCE(cats_needing_tnr_estimate, 0) > 0 THEN
            ROUND((COALESCE(cats_caught_or_handled, 0)::NUMERIC / cats_needing_tnr_estimate) * 100, 1)
        ELSE NULL
    END AS progress_pct,
    source_system,
    confidence,
    as_of_date,
    notes
FROM trapper.request_counts
ORDER BY request_id, as_of_date DESC, created_at DESC;

COMMENT ON VIEW trapper.v_request_counts_best IS
'Latest/best cat count estimates per request. Use this for display.';

-- ============================================================
-- PART 5: Helper function to update counts
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.upsert_request_counts(
    p_request_id UUID,
    p_cats_reported_total SMALLINT DEFAULT NULL,
    p_cats_needing_tnr SMALLINT DEFAULT NULL,
    p_cats_already_altered SMALLINT DEFAULT NULL,
    p_cats_caught SMALLINT DEFAULT NULL,
    p_kittens SMALLINT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'manual',
    p_confidence TEXT DEFAULT 'medium',
    p_notes TEXT DEFAULT NULL,
    p_created_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
    v_counts_id UUID;
    v_today DATE := CURRENT_DATE;
BEGIN
    -- Try to update existing record for today
    UPDATE trapper.request_counts
    SET cats_reported_total = COALESCE(p_cats_reported_total, cats_reported_total),
        cats_needing_tnr_estimate = COALESCE(p_cats_needing_tnr, cats_needing_tnr_estimate),
        cats_already_altered_estimate = COALESCE(p_cats_already_altered, cats_already_altered_estimate),
        cats_caught_or_handled = COALESCE(p_cats_caught, cats_caught_or_handled),
        kittens_observed = COALESCE(p_kittens, kittens_observed),
        source_system = p_source_system,
        confidence = p_confidence,
        notes = COALESCE(p_notes, notes),
        updated_at = NOW(),
        created_by = p_created_by
    WHERE request_id = p_request_id AND as_of_date = v_today
    RETURNING id INTO v_counts_id;

    -- If no existing record for today, insert new
    IF v_counts_id IS NULL THEN
        INSERT INTO trapper.request_counts (
            request_id, cats_reported_total, cats_needing_tnr_estimate,
            cats_already_altered_estimate, cats_caught_or_handled, kittens_observed,
            source_system, confidence, as_of_date, notes, created_by
        ) VALUES (
            p_request_id, p_cats_reported_total, p_cats_needing_tnr,
            p_cats_already_altered, p_cats_caught, p_kittens,
            p_source_system, p_confidence, v_today, p_notes, p_created_by
        )
        RETURNING id INTO v_counts_id;
    END IF;

    RETURN v_counts_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.upsert_request_counts IS
'Upsert cat counts for a request. Creates history automatically via trigger.';

-- ============================================================
-- Verification
-- ============================================================

\echo ''
\echo 'MIG_247 applied. Request counts schema created.'
\echo ''

\echo 'Tables created:'
SELECT tablename FROM pg_tables
WHERE schemaname = 'trapper'
AND tablename IN ('request_counts', 'request_counts_history')
ORDER BY tablename;

