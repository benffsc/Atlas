-- =====================================================
-- MIG_518: Tippy Proposed Data Corrections
-- =====================================================
-- Enables Tippy to propose data corrections when finding
-- discrepancies, with staff approval workflow integrated
-- into the existing data_improvements system.
-- =====================================================

\echo '=========================================='
\echo 'MIG_518: Tippy Proposed Data Corrections'
\echo '=========================================='

-- -----------------------------------------------------
-- PART 1: Create proposed corrections table
-- -----------------------------------------------------

\echo ''
\echo '1. Creating proposed corrections table...'

CREATE TABLE IF NOT EXISTS trapper.tippy_proposed_corrections (
    correction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What Tippy found
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'cat', 'place', 'request', 'appointment')),
    entity_id UUID NOT NULL,
    field_name TEXT NOT NULL,
    current_value JSONB,
    proposed_value JSONB NOT NULL,

    -- Context
    discovery_context TEXT NOT NULL, -- What question led Tippy to find this
    confidence TEXT DEFAULT 'low' CHECK (confidence IN ('low', 'medium', 'high')),
    reasoning TEXT, -- Why Tippy thinks this is correct

    -- Source evidence
    evidence_sources JSONB DEFAULT '[]', -- Array of {source, value, confidence}
    conversation_id UUID,

    -- Workflow
    status TEXT DEFAULT 'proposed' CHECK (status IN (
        'proposed',      -- Tippy proposed, awaiting review
        'approved',      -- Staff approved, awaiting application
        'applied',       -- Change applied to database
        'rejected',      -- Staff rejected
        'auto_applied'   -- High-confidence auto-fix (rare)
    )),

    -- Resolution tracking
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    applied_at TIMESTAMPTZ,
    applied_by UUID,
    edit_id UUID, -- Links to entity_edits for audit trail

    -- Links to other systems
    data_improvement_id UUID,
    feedback_id UUID,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tippy_corrections_pending
    ON trapper.tippy_proposed_corrections(status)
    WHERE status IN ('proposed', 'approved');

CREATE INDEX IF NOT EXISTS idx_tippy_corrections_entity
    ON trapper.tippy_proposed_corrections(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_tippy_corrections_conversation
    ON trapper.tippy_proposed_corrections(conversation_id);

CREATE INDEX IF NOT EXISTS idx_tippy_corrections_created
    ON trapper.tippy_proposed_corrections(created_at DESC);

COMMENT ON TABLE trapper.tippy_proposed_corrections IS
'Data corrections proposed by Tippy when finding discrepancies. Staff approval required before application.';

-- -----------------------------------------------------
-- PART 2: Create function to propose a correction
-- -----------------------------------------------------

\echo ''
\echo '2. Creating propose_correction function...'

CREATE OR REPLACE FUNCTION trapper.tippy_propose_correction(
    p_entity_type TEXT,
    p_entity_id UUID,
    p_field_name TEXT,
    p_current_value JSONB,
    p_proposed_value JSONB,
    p_discovery_context TEXT,
    p_evidence_sources JSONB DEFAULT '[]',
    p_reasoning TEXT DEFAULT NULL,
    p_confidence TEXT DEFAULT 'low',
    p_conversation_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_correction_id UUID;
    v_existing_id UUID;
BEGIN
    -- Check for existing pending correction on same entity/field
    SELECT correction_id INTO v_existing_id
    FROM trapper.tippy_proposed_corrections
    WHERE entity_type = p_entity_type
      AND entity_id = p_entity_id
      AND field_name = p_field_name
      AND status IN ('proposed', 'approved')
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        -- Update existing rather than create duplicate
        UPDATE trapper.tippy_proposed_corrections
        SET proposed_value = p_proposed_value,
            evidence_sources = p_evidence_sources,
            reasoning = COALESCE(p_reasoning, reasoning),
            confidence = p_confidence,
            discovery_context = p_discovery_context,
            conversation_id = COALESCE(p_conversation_id, conversation_id),
            updated_at = NOW()
        WHERE correction_id = v_existing_id;

        RETURN v_existing_id;
    END IF;

    -- Create new correction
    INSERT INTO trapper.tippy_proposed_corrections (
        entity_type, entity_id, field_name,
        current_value, proposed_value,
        discovery_context, evidence_sources, reasoning,
        confidence, conversation_id
    ) VALUES (
        p_entity_type, p_entity_id, p_field_name,
        p_current_value, p_proposed_value,
        p_discovery_context, p_evidence_sources, p_reasoning,
        p_confidence, p_conversation_id
    )
    RETURNING correction_id INTO v_correction_id;

    RETURN v_correction_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.tippy_propose_correction IS
'Creates or updates a proposed data correction from Tippy. Returns correction_id.';

-- -----------------------------------------------------
-- PART 3: Create function to apply an approved correction
-- -----------------------------------------------------

\echo ''
\echo '3. Creating apply_correction function...'

CREATE OR REPLACE FUNCTION trapper.tippy_apply_correction(
    p_correction_id UUID,
    p_applied_by UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_correction RECORD;
    v_edit_id UUID;
    v_sql TEXT;
    v_table_name TEXT;
BEGIN
    -- Get the correction
    SELECT * INTO v_correction
    FROM trapper.tippy_proposed_corrections
    WHERE correction_id = p_correction_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Correction not found');
    END IF;

    IF v_correction.status NOT IN ('approved', 'proposed') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Correction not in approvable status');
    END IF;

    -- Determine target table
    v_table_name := CASE v_correction.entity_type
        WHEN 'person' THEN 'sot_people'
        WHEN 'cat' THEN 'sot_cats'
        WHEN 'place' THEN 'places'
        WHEN 'request' THEN 'sot_requests'
        WHEN 'appointment' THEN 'sot_appointments'
    END;

    -- Log to entity_edits first
    INSERT INTO trapper.entity_edits (
        entity_type, entity_id, edit_type,
        field_name, old_value, new_value,
        source, edit_reason, edited_by
    ) VALUES (
        v_correction.entity_type,
        v_correction.entity_id,
        'field_update',
        v_correction.field_name,
        v_correction.current_value,
        v_correction.proposed_value,
        'tippy_correction',
        v_correction.reasoning,
        p_applied_by
    )
    RETURNING edit_id INTO v_edit_id;

    -- Apply the change (only for simple field updates)
    -- Complex updates should be handled manually
    BEGIN
        EXECUTE format(
            'UPDATE trapper.%I SET %I = $1 WHERE %I = $2',
            v_table_name,
            v_correction.field_name,
            v_correction.entity_type || '_id'
        ) USING v_correction.proposed_value #>> '{}', v_correction.entity_id;
    EXCEPTION WHEN OTHERS THEN
        -- Mark as needing manual application
        UPDATE trapper.tippy_proposed_corrections
        SET review_notes = COALESCE(review_notes, '') || E'\nAuto-apply failed: ' || SQLERRM,
            updated_at = NOW()
        WHERE correction_id = p_correction_id;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'Auto-apply failed: ' || SQLERRM,
            'manual_required', true
        );
    END;

    -- Mark as applied
    UPDATE trapper.tippy_proposed_corrections
    SET status = 'applied',
        applied_at = NOW(),
        applied_by = p_applied_by,
        edit_id = v_edit_id,
        updated_at = NOW()
    WHERE correction_id = p_correction_id;

    RETURN jsonb_build_object(
        'success', true,
        'edit_id', v_edit_id,
        'correction_id', p_correction_id
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.tippy_apply_correction IS
'Applies an approved correction to the database and logs to entity_edits.';

-- -----------------------------------------------------
-- PART 4: Create view for pending corrections
-- -----------------------------------------------------

\echo ''
\echo '4. Creating pending corrections view...'

CREATE OR REPLACE VIEW trapper.v_tippy_pending_corrections AS
SELECT
    pc.correction_id,
    pc.entity_type,
    pc.entity_id,
    pc.field_name,
    pc.current_value,
    pc.proposed_value,
    pc.confidence,
    pc.discovery_context,
    pc.reasoning,
    pc.evidence_sources,
    pc.status,
    pc.created_at,
    pc.conversation_id,
    -- Entity display info
    CASE pc.entity_type
        WHEN 'person' THEN (SELECT display_name FROM trapper.sot_people WHERE person_id = pc.entity_id)
        WHEN 'cat' THEN (SELECT display_name FROM trapper.sot_cats WHERE cat_id = pc.entity_id)
        WHEN 'place' THEN (SELECT formatted_address FROM trapper.places WHERE place_id = pc.entity_id)
        WHEN 'request' THEN (SELECT 'Request #' || source_record_id FROM trapper.sot_requests WHERE request_id = pc.entity_id)
    END as entity_display_name,
    -- Reviewer info
    pc.reviewed_by,
    pc.reviewed_at,
    pc.review_notes,
    s.display_name as reviewer_name
FROM trapper.tippy_proposed_corrections pc
LEFT JOIN trapper.staff s ON s.staff_id = pc.reviewed_by
WHERE pc.status IN ('proposed', 'approved')
ORDER BY
    CASE pc.confidence
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        ELSE 3
    END,
    pc.created_at DESC;

COMMENT ON VIEW trapper.v_tippy_pending_corrections IS
'Pending data corrections proposed by Tippy, awaiting staff review.';

-- -----------------------------------------------------
-- PART 5: Create stats view
-- -----------------------------------------------------

\echo ''
\echo '5. Creating corrections stats view...'

CREATE OR REPLACE VIEW trapper.v_tippy_correction_stats AS
SELECT
    status,
    confidence,
    COUNT(*) as count,
    MIN(created_at) as oldest,
    MAX(created_at) as newest
FROM trapper.tippy_proposed_corrections
GROUP BY status, confidence
ORDER BY status, confidence;

COMMENT ON VIEW trapper.v_tippy_correction_stats IS
'Statistics on Tippy proposed corrections by status and confidence.';

-- -----------------------------------------------------
-- PART 6: Verification
-- -----------------------------------------------------

\echo ''
\echo '6. Verification...'

SELECT
    'tippy_proposed_corrections table' as object,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'tippy_proposed_corrections'
    ) THEN 'EXISTS' ELSE 'MISSING' END as status;

\echo ''
\echo '=== MIG_518 Complete ==='
\echo ''

SELECT trapper.record_migration(518, 'MIG_518__tippy_data_corrections');
