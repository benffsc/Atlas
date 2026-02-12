-- MIG_1007: V2 Architecture - Unified Detection Integration
-- Phase 1, Part 8: Connect existing detection systems to V2 change detection
--
-- This migration:
-- 1. Creates triggers to generate change events from pattern alerts
-- 2. Seeds source.entity_source_links from existing data
-- 3. Creates unified monitoring views across all detection systems
-- 4. Wires up pattern auto-fix functions
-- 5. Creates a unified review queue
--
-- Existing Systems Being Unified:
-- - atlas.pattern_definitions + audit.pattern_alerts (pattern detection)
-- - trapper.data_engine_soft_blacklist (soft blacklist)
-- - trapper.entity_edits (audit trail)
-- - trapper.journal_entries (narrative audit)
-- - trapper.data_engine_match_decisions (identity resolution audit)
-- - source.change_events (change detection)

-- ============================================================================
-- 1. PATTERN ALERT → CHANGE EVENT TRIGGER
-- When a pattern alert is created, also create a change event
-- ============================================================================

CREATE OR REPLACE FUNCTION atlas.pattern_alert_to_change_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Only for patterns that affect source data
    IF NEW.entity_type IS NOT NULL AND NEW.entity_id IS NOT NULL THEN
        INSERT INTO source.change_events (
            source_system,
            entity_type,
            source_record_id,
            change_type,
            changed_fields,
            new_values,
            linked_entity_type,
            linked_entity_id,
            requires_review,
            processing_notes
        ) VALUES (
            COALESCE(NEW.source_system, 'pattern_detection'),
            'pattern_alert',
            NEW.pattern_id,
            'created',
            ARRAY['pattern_detected'],
            jsonb_build_object(
                'pattern_id', NEW.pattern_id,
                'entity_type', NEW.entity_type,
                'entity_id', NEW.entity_id,
                'details', NEW.details,
                'action_taken', NEW.action_taken
            ),
            NEW.entity_type,
            NEW.entity_id,
            -- Only require review for non-auto-fix patterns
            (SELECT pd.action NOT IN ('AUTO_FIX') FROM atlas.pattern_definitions pd WHERE pd.pattern_id = NEW.pattern_id),
            'Generated from pattern alert: ' || NEW.pattern_id
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pattern_alert_to_change ON audit.pattern_alerts;
CREATE TRIGGER trg_pattern_alert_to_change
    AFTER INSERT ON audit.pattern_alerts
    FOR EACH ROW EXECUTE FUNCTION atlas.pattern_alert_to_change_event();

COMMENT ON FUNCTION atlas.pattern_alert_to_change_event IS 'Bridges pattern detection to unified change event stream';

-- ============================================================================
-- 2. SEED SOURCE ENTITY LINKS FROM EXISTING DATA
-- ============================================================================

-- Seed from person_identifiers (people with source record links)
INSERT INTO source.entity_source_links (entity_type, entity_id, source_system, source_entity_type, source_record_id, link_type, linked_by)
SELECT DISTINCT
    'person',
    pi.person_id,
    pi.source_system,
    pi.source_table,
    pi.source_row_id::TEXT,
    'primary',
    'migration_seed'
FROM trapper.person_identifiers pi
WHERE pi.source_system IS NOT NULL
  AND pi.source_row_id IS NOT NULL
  AND pi.person_id IN (SELECT person_id FROM sot.people)
ON CONFLICT (source_system, source_entity_type, source_record_id, entity_type) DO NOTHING;

-- Seed from cat_identifiers
INSERT INTO source.entity_source_links (entity_type, entity_id, source_system, source_entity_type, source_record_id, link_type, linked_by)
SELECT DISTINCT
    'cat',
    ci.cat_id,
    ci.source_system,
    ci.id_type,
    ci.id_value,
    'primary',
    'migration_seed'
FROM trapper.cat_identifiers ci
WHERE ci.source_system IS NOT NULL
  AND ci.cat_id IN (SELECT cat_id FROM sot.cats)
ON CONFLICT (source_system, source_entity_type, source_record_id, entity_type) DO NOTHING;

-- Seed from appointments (ClinicHQ records)
INSERT INTO source.entity_source_links (entity_type, entity_id, source_system, source_entity_type, source_record_id, link_type, linked_by)
SELECT DISTINCT
    'cat',
    a.cat_id,
    'clinichq',
    'appointment_info',
    a.source_record_id,
    'primary',
    'migration_seed'
FROM trapper.sot_appointments a
WHERE a.source_record_id IS NOT NULL
  AND a.cat_id IS NOT NULL
  AND a.cat_id IN (SELECT cat_id FROM sot.cats)
ON CONFLICT (source_system, source_entity_type, source_record_id, entity_type) DO NOTHING;

-- ============================================================================
-- 3. UNIFIED MONITORING VIEWS
-- ============================================================================

-- Unified activity stream (all detection events)
CREATE OR REPLACE VIEW atlas.v_unified_activity_stream AS

-- Pattern alerts
SELECT
    pa.id::TEXT as event_id,
    'pattern_alert' as event_source,
    pd.category as event_category,
    pd.name as event_type,
    pd.severity,
    pa.entity_type,
    pa.entity_id,
    pa.source_system,
    CASE WHEN pa.resolved_at IS NULL THEN 'open' ELSE 'resolved' END as status,
    pa.details as event_data,
    pa.created_at as detected_at,
    pa.resolved_at as processed_at,
    pa.resolved_by as processed_by
FROM audit.pattern_alerts pa
JOIN atlas.pattern_definitions pd ON pd.pattern_id = pa.pattern_id

UNION ALL

-- Source change events
SELECT
    ce.event_id::TEXT,
    'source_change' as event_source,
    ce.entity_type as event_category,
    ce.change_type as event_type,
    CASE
        WHEN ce.requires_review THEN 'medium'
        ELSE 'low'
    END as severity,
    ce.linked_entity_type as entity_type,
    ce.linked_entity_id as entity_id,
    ce.source_system,
    CASE
        WHEN ce.processed_at IS NULL AND ce.requires_review THEN 'pending_review'
        WHEN ce.processed_at IS NULL THEN 'pending'
        ELSE 'processed'
    END as status,
    jsonb_build_object(
        'changed_fields', ce.changed_fields,
        'old_values', ce.old_values,
        'new_values', ce.new_values
    ) as event_data,
    ce.detected_at,
    ce.processed_at,
    ce.processed_by
FROM source.change_events ce

UNION ALL

-- Data engine match decisions (identity resolution events)
SELECT
    md.decision_id::TEXT as event_id,
    'identity_resolution' as event_source,
    'identity' as event_category,
    md.decision_type as event_type,
    CASE md.decision_type
        WHEN 'review_pending' THEN 'medium'
        WHEN 'rejected' THEN 'low'
        ELSE 'low'
    END as severity,
    'person' as entity_type,
    md.resulting_person_id as entity_id,
    md.source_system,
    CASE
        WHEN md.decision_type = 'review_pending' AND md.reviewed_at IS NULL THEN 'pending_review'
        WHEN md.reviewed_at IS NOT NULL THEN 'reviewed'
        ELSE 'auto_processed'
    END as status,
    jsonb_build_object(
        'input', jsonb_build_object(
            'email', md.incoming_email,
            'phone', md.incoming_phone,
            'name', md.incoming_name,
            'address', md.incoming_address
        ),
        'score', md.score_breakdown,
        'candidates', md.all_candidates
    ) as event_data,
    md.processed_at as detected_at,
    md.reviewed_at as processed_at,
    md.reviewed_by as processed_by
FROM trapper.data_engine_match_decisions md

ORDER BY detected_at DESC;

COMMENT ON VIEW atlas.v_unified_activity_stream IS 'Unified stream of all detection events across pattern alerts, source changes, and identity resolution';

-- Unified review queue (wrapped for ORDER BY with CASE)
CREATE OR REPLACE VIEW atlas.v_unified_review_queue AS
SELECT * FROM (
    -- Pattern alerts needing review
    SELECT
        'pattern_alert' as queue_type,
        pa.id::TEXT as item_id,
        pd.pattern_id,
        pd.name as item_name,
        pd.category,
        pd.severity,
        CASE pd.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END as severity_order,
        pd.action as suggested_action,
        pa.entity_type,
        pa.entity_id,
        CASE pa.entity_type
            WHEN 'person' THEN (SELECT display_name FROM sot.people WHERE person_id = pa.entity_id)
            WHEN 'cat' THEN (SELECT name FROM sot.cats WHERE cat_id = pa.entity_id)
            WHEN 'place' THEN (SELECT display_name FROM sot.places WHERE place_id = pa.entity_id)
        END as entity_name,
        pa.source_system,
        pa.details as context,
        pa.created_at as queued_at,
        NULL::TEXT as assigned_to
    FROM audit.pattern_alerts pa
    JOIN atlas.pattern_definitions pd ON pd.pattern_id = pa.pattern_id
    WHERE pa.resolved_at IS NULL
      AND pd.action IN ('QUARANTINE', 'ALERT', 'BLOCK')

    UNION ALL

    -- Source changes needing review
    SELECT
        'source_change' as queue_type,
        ce.event_id::TEXT as item_id,
        ce.source_system || ':' || ce.entity_type as pattern_id,
        ce.change_type || ' in ' || ce.source_system as item_name,
        ce.entity_type as category,
        CASE WHEN ce.change_type = 'deleted' THEN 'high' ELSE 'medium' END as severity,
        CASE WHEN ce.change_type = 'deleted' THEN 2 ELSE 3 END as severity_order,
        'REVIEW' as suggested_action,
        ce.linked_entity_type as entity_type,
        ce.linked_entity_id as entity_id,
        CASE ce.linked_entity_type
            WHEN 'person' THEN (SELECT display_name FROM sot.people WHERE person_id = ce.linked_entity_id)
            WHEN 'cat' THEN (SELECT name FROM sot.cats WHERE cat_id = ce.linked_entity_id)
            WHEN 'place' THEN (SELECT display_name FROM sot.places WHERE place_id = ce.linked_entity_id)
        END as entity_name,
        ce.source_system,
        ce.new_values as context,
        ce.detected_at as queued_at,
        NULL::TEXT as assigned_to
    FROM source.change_events ce
    WHERE ce.requires_review = TRUE
      AND ce.reviewed_at IS NULL

    UNION ALL

    -- Identity resolution pending reviews
    SELECT
        'identity_review' as queue_type,
        md.decision_id::TEXT as item_id,
        'IDENT_MATCH' as pattern_id,
        'Identity match review' as item_name,
        'identity' as category,
        'medium' as severity,
        3 as severity_order,
        md.decision_type as suggested_action,
        'person' as entity_type,
        md.resulting_person_id as entity_id,
        (SELECT display_name FROM sot.people WHERE person_id = md.resulting_person_id) as entity_name,
        md.source_system,
        jsonb_build_object(
            'email', md.incoming_email,
            'phone', md.incoming_phone,
            'name', md.incoming_name,
            'address', md.incoming_address
        ) as context,
        md.processed_at as queued_at,
        NULL::TEXT as assigned_to
    FROM trapper.data_engine_match_decisions md
    WHERE md.decision_type = 'review_pending'
      AND md.reviewed_at IS NULL

    UNION ALL

    -- Quarantined records
    SELECT
        'quarantine' as queue_type,
        fr.id::TEXT as item_id,
        COALESCE(fr.pattern_id, 'UNKNOWN') as pattern_id,
        fr.classification as item_name,
        COALESCE(pd.category, 'unknown') as category,
        COALESCE(pd.severity, 'medium') as severity,
        CASE COALESCE(pd.severity, 'medium') WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END as severity_order,
        'REVIEW' as suggested_action,
        fr.source_table as entity_type,
        fr.source_record_id as entity_id,
        fr.failure_reason as entity_name,
        fr.source_system,
        fr.original_payload as context,
        fr.quarantined_at as queued_at,
        NULL::TEXT as assigned_to
    FROM quarantine.failed_records fr
    LEFT JOIN atlas.pattern_definitions pd ON pd.pattern_id = fr.pattern_id
    WHERE fr.reviewed_at IS NULL
) q
ORDER BY severity_order, queued_at;

COMMENT ON VIEW atlas.v_unified_review_queue IS 'Unified review queue across all detection systems';

-- Detection system health dashboard
CREATE OR REPLACE VIEW atlas.v_detection_health AS
SELECT
    'pattern_alerts' as system,
    COUNT(*) FILTER (WHERE pa.resolved_at IS NULL) as pending_count,
    COUNT(*) FILTER (WHERE pa.resolved_at IS NULL AND pd.severity = 'critical') as critical_pending,
    COUNT(*) FILTER (WHERE pa.created_at > NOW() - INTERVAL '24 hours') as last_24h,
    MAX(pa.created_at) as last_detection
FROM audit.pattern_alerts pa
JOIN atlas.pattern_definitions pd ON pd.pattern_id = pa.pattern_id

UNION ALL

SELECT
    'source_changes',
    COUNT(*) FILTER (WHERE processed_at IS NULL AND requires_review),
    0,
    COUNT(*) FILTER (WHERE detected_at > NOW() - INTERVAL '24 hours'),
    MAX(detected_at)
FROM source.change_events

UNION ALL

SELECT
    'identity_reviews',
    COUNT(*) FILTER (WHERE decision_type = 'review_pending' AND reviewed_at IS NULL),
    0,
    COUNT(*) FILTER (WHERE processed_at > NOW() - INTERVAL '24 hours'),
    MAX(processed_at)
FROM trapper.data_engine_match_decisions

UNION ALL

SELECT
    'quarantine',
    COUNT(*) FILTER (WHERE reviewed_at IS NULL),
    COUNT(*) FILTER (WHERE reviewed_at IS NULL AND pattern_id IN (SELECT pattern_id FROM atlas.pattern_definitions WHERE severity = 'critical')),
    COUNT(*) FILTER (WHERE quarantined_at > NOW() - INTERVAL '24 hours'),
    MAX(quarantined_at)
FROM quarantine.failed_records

UNION ALL

SELECT
    'sync_runs',
    COUNT(*) FILTER (WHERE status = 'running'),
    COUNT(*) FILTER (WHERE status = 'failed'),
    COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '24 hours'),
    MAX(completed_at)
FROM source.sync_runs;

COMMENT ON VIEW atlas.v_detection_health IS 'Health dashboard for all detection systems';

-- ============================================================================
-- 4. WIRE UP PATTERN AUTO-FIX FUNCTIONS
-- ============================================================================

-- Update pattern definitions with auto-fix function references
UPDATE atlas.pattern_definitions SET auto_fix_function = 'atlas.autofix_org_email_as_person' WHERE pattern_id = 'IDENT_001';
UPDATE atlas.pattern_definitions SET auto_fix_function = 'atlas.autofix_address_as_person' WHERE pattern_id = 'IDENT_002';
UPDATE atlas.pattern_definitions SET auto_fix_function = 'atlas.autofix_garbage_name' WHERE pattern_id = 'IDENT_005';
UPDATE atlas.pattern_definitions SET auto_fix_function = 'atlas.autofix_fabricated_petlink_email' WHERE pattern_id = 'IDENT_008';
UPDATE atlas.pattern_definitions SET auto_fix_function = 'atlas.autofix_medical_hold_name' WHERE pattern_id = 'IDENT_009';

-- Create placeholder auto-fix functions (to be implemented)
CREATE OR REPLACE FUNCTION atlas.autofix_org_email_as_person(p_entity_id UUID, p_details JSONB)
RETURNS TEXT AS $$
BEGIN
    -- Route to clinic_owner_accounts instead of sot.people
    -- Add to soft blacklist
    INSERT INTO trapper.data_engine_soft_blacklist (identifier_type, identifier_norm, reason, auto_detected)
    SELECT 'email', LOWER(TRIM(p_details->>'email')), 'Org email detected by IDENT_001', TRUE
    WHERE p_details->>'email' IS NOT NULL
    ON CONFLICT DO NOTHING;

    RETURN 'soft_blacklisted';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION atlas.autofix_address_as_person(p_entity_id UUID, p_details JSONB)
RETURNS TEXT AS $$
BEGIN
    -- Mark as organization or route to place
    UPDATE sot.people
    SET entity_type = 'unknown',
        data_quality = 'needs_review'
    WHERE person_id = p_entity_id;

    RETURN 'marked_for_review';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION atlas.autofix_garbage_name(p_entity_id UUID, p_details JSONB)
RETURNS TEXT AS $$
BEGIN
    -- Mark data quality as garbage
    UPDATE sot.people
    SET data_quality = 'garbage'
    WHERE person_id = p_entity_id;

    RETURN 'marked_garbage';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION atlas.autofix_fabricated_petlink_email(p_entity_id UUID, p_details JSONB)
RETURNS TEXT AS $$
BEGIN
    -- Lower confidence on PetLink identifiers
    UPDATE sot.person_identifiers
    SET confidence = 0.2
    WHERE person_id = p_entity_id
      AND source_system = 'petlink'
      AND id_type = 'email';

    RETURN 'confidence_lowered';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION atlas.autofix_medical_hold_name(p_entity_id UUID, p_details JSONB)
RETURNS TEXT AS $$
DECLARE
    v_clean_name TEXT;
BEGIN
    -- Remove medical suffix from name
    v_clean_name := REGEXP_REPLACE(
        (SELECT display_name FROM sot.people WHERE person_id = p_entity_id),
        '\s*\(?(dental|medical|surgery|dental hold|medical hold)\)?.*$',
        '',
        'i'
    );

    UPDATE sot.people
    SET display_name = TRIM(v_clean_name)
    WHERE person_id = p_entity_id
      AND display_name != TRIM(v_clean_name);

    RETURN 'name_cleaned';
END;
$$ LANGUAGE plpgsql;

-- Generic pattern processor that calls the appropriate auto-fix function
CREATE OR REPLACE FUNCTION atlas.process_pattern_alert(p_alert_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_alert RECORD;
    v_pattern RECORD;
    v_result TEXT;
BEGIN
    -- Get alert details
    SELECT * INTO v_alert FROM audit.pattern_alerts WHERE id = p_alert_id;
    IF NOT FOUND THEN
        RETURN 'alert_not_found';
    END IF;

    -- Get pattern details
    SELECT * INTO v_pattern FROM atlas.pattern_definitions WHERE pattern_id = v_alert.pattern_id;

    -- Check action type
    IF v_pattern.action = 'AUTO_FIX' AND v_pattern.auto_fix_function IS NOT NULL THEN
        -- Call the auto-fix function dynamically
        EXECUTE format(
            'SELECT %s($1, $2)',
            v_pattern.auto_fix_function
        ) INTO v_result USING v_alert.entity_id, v_alert.details;

        -- Mark alert as resolved
        UPDATE audit.pattern_alerts
        SET
            action_taken = v_result,
            resolved_at = NOW(),
            resolved_by = 'auto_fix',
            resolution = 'auto_fixed'
        WHERE id = p_alert_id;

        RETURN v_result;

    ELSIF v_pattern.action = 'BLOCK' THEN
        -- Don't auto-process BLOCK patterns
        RETURN 'blocked_requires_manual';

    ELSE
        -- QUARANTINE or ALERT - just mark as needing review
        RETURN 'queued_for_review';
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION atlas.process_pattern_alert IS 'Process a pattern alert - auto-fix or queue for review';

-- ============================================================================
-- 5. SEED SOFT BLACKLIST FROM KNOWN PATTERNS
-- ============================================================================

-- Add known org emails to soft blacklist
INSERT INTO trapper.data_engine_soft_blacklist (identifier_type, identifier_norm, reason, auto_detected)
SELECT 'email', LOWER(TRIM(email)), 'Seeded from known org patterns', FALSE
FROM (VALUES
    ('info@forgottenfelines.com'),
    ('office@forgottenfelines.com'),
    ('admin@forgottenfelines.com'),
    ('contact@forgottenfelines.com'),
    ('marinferals@yahoo.com'),
    ('info@marinferals.org')
) AS orgs(email)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 6. SYNC RUN HELPER FOR EXISTING DATA
-- ============================================================================

-- Function to initialize sync state from existing appointments
CREATE OR REPLACE FUNCTION source.seed_clinichq_sync_state()
RETURNS INTEGER AS $$
DECLARE
    v_sync_id UUID;
    v_count INTEGER := 0;
    v_record RECORD;
BEGIN
    -- Start a seed sync run
    v_sync_id := source.start_sync_run('clinichq', 'appointment', 'Initial seed from existing appointments');

    -- Process each appointment
    FOR v_record IN
        SELECT
            appointment_id,
            source_record_id,
            cat_id,
            person_id,
            appointment_date,
            owner_email,
            owner_phone,
            owner_first_name,
            owner_last_name,
            owner_address
        FROM ops.appointments
        WHERE source_system = 'clinichq'
          AND source_record_id IS NOT NULL
    LOOP
        -- Track the record
        PERFORM source.process_source_record(
            v_sync_id,
            'clinichq',
            'appointment',
            v_record.source_record_id,
            jsonb_build_object(
                'appointment_id', v_record.appointment_id,
                'cat_id', v_record.cat_id,
                'person_id', v_record.person_id,
                'date', v_record.appointment_date,
                'owner_email', v_record.owner_email,
                'owner_phone', v_record.owner_phone
            ),
            'cat',
            v_record.cat_id
        );

        -- Track owner history if cat exists
        IF v_record.cat_id IS NOT NULL THEN
            PERFORM source.track_clinichq_owner(
                v_sync_id,
                (SELECT clinichq_animal_id FROM sot.cats WHERE cat_id = v_record.cat_id),
                v_record.source_record_id,
                v_record.appointment_date,
                v_record.owner_first_name,
                v_record.owner_last_name,
                v_record.owner_email,
                v_record.owner_phone,
                v_record.owner_address,
                v_record.cat_id,
                v_record.person_id
            );
        END IF;

        v_count := v_count + 1;
    END LOOP;

    -- Complete the sync
    PERFORM source.complete_sync_run(v_sync_id);

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION source.seed_clinichq_sync_state IS 'Initialize sync state from existing ClinicHQ appointments';

-- ============================================================================
-- VERIFY
-- ============================================================================
DO $$
BEGIN
    -- Verify views exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'atlas' AND table_name = 'v_unified_activity_stream') THEN
        RAISE EXCEPTION 'v_unified_activity_stream view not created';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'atlas' AND table_name = 'v_unified_review_queue') THEN
        RAISE EXCEPTION 'v_unified_review_queue view not created';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'atlas' AND table_name = 'v_detection_health') THEN
        RAISE EXCEPTION 'v_detection_health view not created';
    END IF;

    RAISE NOTICE 'V2 unified detection integration created successfully';
    RAISE NOTICE 'Views: v_unified_activity_stream, v_unified_review_queue, v_detection_health';
    RAISE NOTICE 'Entity source links seeded: %', (SELECT COUNT(*) FROM source.entity_source_links);
    RAISE NOTICE 'Soft blacklist entries: %', (SELECT COUNT(*) FROM trapper.data_engine_soft_blacklist);
END $$;
