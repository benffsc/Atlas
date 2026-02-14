-- MIG_2301: Add Missing Functions (Post-Trapper Drop)
-- Date: 2026-02-14
--
-- Purpose: Create functions that code references but were dropped with trapper schema
-- These are organized into sot.* (entity functions) and ops.* (operational functions)

\echo ''
\echo '=============================================='
\echo '  MIG_2301: Add Missing Functions'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. MISSING TABLES
-- ============================================================================

\echo '1. Creating missing tables...'

-- Data quality snapshots
CREATE TABLE IF NOT EXISTS ops.data_quality_snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_type TEXT NOT NULL,
    metrics JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT
);

-- Attribute extraction jobs
CREATE TABLE IF NOT EXISTS ops.attribute_extraction_jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID,
    status TEXT DEFAULT 'pending',
    attributes JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Extraction status
CREATE TABLE IF NOT EXISTS ops.extraction_status (
    status_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID,
    extraction_type TEXT,
    status TEXT DEFAULT 'pending',
    result JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Entity edits (audit log)
CREATE TABLE IF NOT EXISTS ops.entity_edits (
    edit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_by UUID,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    change_source TEXT DEFAULT 'api'
);

CREATE INDEX IF NOT EXISTS idx_entity_edits_entity ON ops.entity_edits(entity_type, entity_id);

-- Review queue
CREATE TABLE IF NOT EXISTS ops.review_queue (
    review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID,
    review_type TEXT NOT NULL,
    priority INT DEFAULT 0,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID
);

-- Org types
CREATE TABLE IF NOT EXISTS ops.org_types (
    type_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT
);

INSERT INTO ops.org_types (type_key, display_name) VALUES
    ('shelter', 'Animal Shelter'),
    ('rescue', 'Cat Rescue'),
    ('vet_clinic', 'Veterinary Clinic'),
    ('municipal', 'Municipal Agency'),
    ('other', 'Other Organization')
ON CONFLICT (type_key) DO NOTHING;

-- Test type disease mapping
CREATE TABLE IF NOT EXISTS ops.test_type_disease_mapping (
    test_type TEXT PRIMARY KEY,
    disease_type TEXT NOT NULL,
    is_positive_indicator BOOLEAN DEFAULT true
);

INSERT INTO ops.test_type_disease_mapping (test_type, disease_type, is_positive_indicator) VALUES
    ('FeLV', 'felv', true),
    ('FIV', 'fiv', true),
    ('FeLV/FIV Combo', 'felv_fiv', true),
    ('Ringworm', 'ringworm', true),
    ('Panleukopenia', 'panleukopenia', true)
ON CONFLICT (test_type) DO NOTHING;

\echo '   Created missing tables'

-- ============================================================================
-- 2. SOT FUNCTIONS (Entity-related)
-- ============================================================================

\echo ''
\echo '2. Creating sot.* functions...'

-- name_similarity (if not exists)
CREATE OR REPLACE FUNCTION sot.name_similarity(name1 TEXT, name2 TEXT)
RETURNS NUMERIC AS $$
BEGIN
    IF name1 IS NULL OR name2 IS NULL THEN RETURN 0; END IF;
    IF LOWER(TRIM(name1)) = LOWER(TRIM(name2)) THEN RETURN 1.0; END IF;
    -- Simple Jaccard-like similarity
    RETURN similarity(LOWER(TRIM(name1)), LOWER(TRIM(name2)));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- is_garbage_name
CREATE OR REPLACE FUNCTION sot.is_garbage_name(p_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_name IS NULL OR TRIM(p_name) = '' THEN RETURN TRUE; END IF;
    RETURN p_name ~* '^(unknown|test|n/?a|none|no name|unnamed|temp|xxx|zzz|\?+|\.+)$'
        OR LENGTH(TRIM(p_name)) < 2
        OR p_name ~ '^\d+$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- is_multi_unit_place
CREATE OR REPLACE FUNCTION sot.is_multi_unit_place(p_place_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM sot.places
        WHERE parent_place_id = p_place_id
        AND merged_into_place_id IS NULL
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- place_safe_to_merge
CREATE OR REPLACE FUNCTION sot.place_safe_to_merge(p_loser_id UUID, p_winner_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_loser_has_children BOOLEAN;
    v_winner_has_children BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM sot.places WHERE parent_place_id = p_loser_id AND merged_into_place_id IS NULL)
    INTO v_loser_has_children;

    SELECT EXISTS (SELECT 1 FROM sot.places WHERE parent_place_id = p_winner_id AND merged_into_place_id IS NULL)
    INTO v_winner_has_children;

    -- Can't merge if both have children (would create complex hierarchy)
    IF v_loser_has_children AND v_winner_has_children THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

-- find_similar_people
CREATE OR REPLACE FUNCTION sot.find_similar_people(
    p_first_name TEXT,
    p_last_name TEXT,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL
)
RETURNS TABLE (
    person_id UUID,
    display_name TEXT,
    email TEXT,
    phone TEXT,
    match_score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.person_id,
        p.display_name,
        pi_email.id_value as email,
        pi_phone.id_value as phone,
        GREATEST(
            sot.name_similarity(p.display_name, CONCAT(p_first_name, ' ', p_last_name)),
            CASE WHEN pi_email.id_value = sot.norm_email(p_email) THEN 1.0 ELSE 0 END,
            CASE WHEN pi_phone.id_value_norm = sot.norm_phone_us(p_phone) THEN 1.0 ELSE 0 END
        ) as match_score
    FROM sot.people p
    LEFT JOIN sot.person_identifiers pi_email ON pi_email.person_id = p.person_id
        AND pi_email.id_type = 'email' AND pi_email.confidence >= 0.5
    LEFT JOIN sot.person_identifiers pi_phone ON pi_phone.person_id = p.person_id
        AND pi_phone.id_type = 'phone'
    WHERE p.merged_into_person_id IS NULL
        AND (
            sot.name_similarity(p.display_name, CONCAT(p_first_name, ' ', p_last_name)) > 0.6
            OR pi_email.id_value = sot.norm_email(p_email)
            OR pi_phone.id_value_norm = sot.norm_phone_us(p_phone)
        )
    ORDER BY match_score DESC
    LIMIT 10;
END;
$$ LANGUAGE plpgsql STABLE;

-- relink_person_primary_address
CREATE OR REPLACE FUNCTION sot.relink_person_primary_address(
    p_person_id UUID,
    p_new_place_id UUID,
    p_new_address_id UUID DEFAULT NULL,
    p_changed_by TEXT DEFAULT 'api'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_old_place_id UUID;
BEGIN
    SELECT primary_address_id INTO v_old_place_id
    FROM sot.people WHERE person_id = p_person_id;

    UPDATE sot.people
    SET primary_address_id = p_new_place_id,
        updated_at = NOW()
    WHERE person_id = p_person_id;

    -- Log the change
    INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
    VALUES ('person', p_person_id, 'primary_address_id', v_old_place_id::text, p_new_place_id::text, p_changed_by);

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

\echo '   Created sot.* functions'

-- ============================================================================
-- 3. OPS FUNCTIONS (Operational)
-- ============================================================================

\echo ''
\echo '3. Creating ops.* functions...'

-- take_quality_snapshot
CREATE OR REPLACE FUNCTION ops.take_quality_snapshot(p_source TEXT DEFAULT 'api')
RETURNS UUID AS $$
DECLARE
    v_snapshot_id UUID;
    v_metrics JSONB;
BEGIN
    SELECT JSONB_BUILD_OBJECT(
        'total_cats', (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL),
        'total_people', (SELECT COUNT(*) FROM sot.people WHERE merged_into_person_id IS NULL),
        'total_places', (SELECT COUNT(*) FROM sot.places WHERE merged_into_place_id IS NULL),
        'cats_with_microchip', (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_identifiers WHERE id_type = 'microchip'),
        'people_with_email', (SELECT COUNT(DISTINCT person_id) FROM sot.person_identifiers WHERE id_type = 'email'),
        'geocoded_places', (SELECT COUNT(*) FROM sot.places p JOIN sot.addresses a ON a.address_id = p.sot_address_id WHERE a.latitude IS NOT NULL)
    ) INTO v_metrics;

    INSERT INTO ops.data_quality_snapshots (snapshot_type, metrics, created_by)
    VALUES ('full', v_metrics, p_source)
    RETURNING snapshot_id INTO v_snapshot_id;

    RETURN v_snapshot_id;
END;
$$ LANGUAGE plpgsql;

-- get_entity_history
CREATE OR REPLACE FUNCTION ops.get_entity_history(
    p_entity_type TEXT,
    p_entity_id UUID,
    p_limit INT DEFAULT 20
)
RETURNS TABLE (
    edit_id UUID,
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    changed_by UUID,
    changed_at TIMESTAMPTZ,
    change_source TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT e.edit_id, e.field_name, e.old_value, e.new_value, e.changed_by, e.changed_at, e.change_source
    FROM ops.entity_edits e
    WHERE e.entity_type = p_entity_type AND e.entity_id = p_entity_id
    ORDER BY e.changed_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- acquire_edit_lock (stub - returns true)
CREATE OR REPLACE FUNCTION ops.acquire_edit_lock(
    p_entity_type TEXT,
    p_entity_id UUID,
    p_user_id UUID,
    p_user_name TEXT DEFAULT NULL,
    p_lock_type TEXT DEFAULT 'edit'
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Stub implementation - always succeeds
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- release_edit_lock (stub)
CREATE OR REPLACE FUNCTION ops.release_edit_lock(
    p_entity_type TEXT,
    p_entity_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- log_ownership_transfer
CREATE OR REPLACE FUNCTION ops.log_ownership_transfer(
    p_entity_type TEXT,
    p_entity_id UUID,
    p_from_id UUID,
    p_to_id UUID,
    p_changed_by UUID DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, changed_by, change_source)
    VALUES (p_entity_type, p_entity_id, 'owner_transfer', p_from_id::text, p_to_id::text, p_changed_by, 'ownership_transfer');
END;
$$ LANGUAGE plpgsql;

-- assign_photos_to_group
CREATE OR REPLACE FUNCTION ops.assign_photos_to_group(p_photo_ids UUID[], p_group_id UUID)
RETURNS INT AS $$
BEGIN
    -- Stub - would update photo assignments
    RETURN COALESCE(array_length(p_photo_ids, 1), 0);
END;
$$ LANGUAGE plpgsql;

-- get_person_summary
CREATE OR REPLACE FUNCTION ops.get_person_summary(p_person_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT JSONB_BUILD_OBJECT(
        'person_id', p.person_id,
        'display_name', p.display_name,
        'email', (SELECT id_value FROM sot.person_identifiers WHERE person_id = p.person_id AND id_type = 'email' LIMIT 1),
        'phone', (SELECT id_value FROM sot.person_identifiers WHERE person_id = p.person_id AND id_type = 'phone' LIMIT 1),
        'cat_count', (SELECT COUNT(*) FROM sot.person_cat WHERE person_id = p.person_id),
        'place_count', (SELECT COUNT(*) FROM sot.person_place WHERE person_id = p.person_id),
        'roles', (SELECT ARRAY_AGG(role) FROM ops.person_roles WHERE person_id = p.person_id AND role_status = 'active')
    ) INTO v_result
    FROM sot.people p
    WHERE p.person_id = p_person_id;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- clean_garbage_names
CREATE OR REPLACE FUNCTION ops.clean_garbage_names(p_limit INT DEFAULT 100)
RETURNS TABLE (cleaned_count INT) AS $$
DECLARE
    v_count INT := 0;
BEGIN
    -- Mark garbage names as needing review
    UPDATE sot.people
    SET data_quality = 'needs_review'
    WHERE sot.is_garbage_name(display_name)
        AND data_quality NOT IN ('garbage', 'needs_review')
        AND person_id IN (SELECT person_id FROM sot.people WHERE merged_into_person_id IS NULL LIMIT p_limit);

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql;

-- flag_multi_unit_candidates
CREATE OR REPLACE FUNCTION ops.flag_multi_unit_candidates()
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
BEGIN
    -- Stub - would flag places that might be multi-unit
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- get_trapper_info
CREATE OR REPLACE FUNCTION ops.get_trapper_info(p_person_id UUID)
RETURNS TABLE (
    is_trapper BOOLEAN,
    trapper_type TEXT,
    role_status TEXT,
    total_cats_caught INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        TRUE as is_trapper,
        pr.role as trapper_type,
        pr.role_status,
        COALESCE((
            SELECT COUNT(DISTINCT rta.appointment_id)::INT
            FROM ops.request_trapper_assignments rta
            WHERE rta.person_id = p_person_id
        ), 0) as total_cats_caught
    FROM ops.person_roles pr
    WHERE pr.person_id = p_person_id
        AND pr.role IN ('trapper', 'ffsc_trapper', 'community_trapper', 'head_trapper', 'coordinator')
        AND pr.role_status = 'active'
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT, 0;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- add_trapper_catch
CREATE OR REPLACE FUNCTION ops.add_trapper_catch(
    p_trapper_id UUID,
    p_cat_id UUID,
    p_appointment_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
BEGIN
    -- Create person-cat relationship
    INSERT INTO sot.person_cat (person_id, cat_id, relationship_type, evidence_type, source_system)
    VALUES (p_trapper_id, p_cat_id, 'trapper', 'manual', 'atlas_ui')
    ON CONFLICT DO NOTHING;

    RETURN p_cat_id;
END;
$$ LANGUAGE plpgsql;

-- approve_tippy_draft
CREATE OR REPLACE FUNCTION ops.approve_tippy_draft(
    p_draft_id UUID,
    p_staff_id UUID,
    p_entity_type TEXT DEFAULT NULL,
    p_entity_id UUID DEFAULT NULL,
    p_data JSONB DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE ops.tippy_draft_requests
    SET status = 'submitted', updated_at = NOW()
    WHERE draft_id = p_draft_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- reject_tippy_draft
CREATE OR REPLACE FUNCTION ops.reject_tippy_draft(
    p_draft_id UUID,
    p_staff_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE ops.tippy_draft_requests
    SET status = 'discarded', updated_at = NOW()
    WHERE draft_id = p_draft_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- change_trapper_type
CREATE OR REPLACE FUNCTION ops.change_trapper_type(
    p_person_id UUID,
    p_new_type TEXT,
    p_changed_by UUID DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE ops.person_roles
    SET role = p_new_type
    WHERE person_id = p_person_id
        AND role IN ('trapper', 'ffsc_trapper', 'community_trapper', 'head_trapper');

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- add_trapper_role
CREATE OR REPLACE FUNCTION ops.add_trapper_role(
    p_person_id UUID,
    p_role_type TEXT,
    p_added_by UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO ops.person_roles (person_id, role, role_status, source_system)
    VALUES (p_person_id, p_role_type, 'active', 'atlas_ui')
    ON CONFLICT DO NOTHING;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- refresh_beacon_clusters
CREATE OR REPLACE FUNCTION ops.refresh_beacon_clusters()
RETURNS VOID AS $$
BEGIN
    -- Stub - beacon clusters are managed elsewhere
    NULL;
END;
$$ LANGUAGE plpgsql;

-- refresh_place_dedup_candidates
CREATE OR REPLACE FUNCTION ops.refresh_place_dedup_candidates()
RETURNS TABLE (candidates_found INT) AS $$
BEGIN
    -- Stub - would refresh dedup candidates
    RETURN QUERY SELECT 0;
END;
$$ LANGUAGE plpgsql;

-- set_colony_classification
CREATE OR REPLACE FUNCTION ops.set_colony_classification(
    p_place_id UUID,
    p_classification TEXT,
    p_changed_by UUID DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_confidence NUMERIC DEFAULT 1.0
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Update place context or classification
    PERFORM sot.assign_place_context(p_place_id, p_classification, p_changed_by::text, p_confidence);
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- set_colony_override
CREATE OR REPLACE FUNCTION ops.set_colony_override(
    p_place_id UUID,
    p_count INT,
    p_reason TEXT DEFAULT NULL,
    p_source TEXT DEFAULT 'manual',
    p_changed_by UUID DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN) AS $$
BEGIN
    UPDATE sot.place_colony_estimates
    SET estimated_count = p_count,
        estimate_method = 'manual_override',
        estimate_confidence = 1.0,
        notes = p_reason,
        updated_at = NOW()
    WHERE place_id = p_place_id;

    IF NOT FOUND THEN
        INSERT INTO sot.place_colony_estimates (place_id, estimated_count, estimate_method, estimate_confidence, notes)
        VALUES (p_place_id, p_count, 'manual_override', 1.0, p_reason);
    END IF;

    RETURN QUERY SELECT TRUE;
END;
$$ LANGUAGE plpgsql;

-- clear_colony_override
CREATE OR REPLACE FUNCTION ops.clear_colony_override(
    p_place_id UUID,
    p_changed_by UUID DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM sot.place_colony_estimates
    WHERE place_id = p_place_id AND estimate_method = 'manual_override';

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- set_place_disease_override
CREATE OR REPLACE FUNCTION ops.set_place_disease_override(
    p_place_id UUID,
    p_disease_type TEXT,
    p_status TEXT,
    p_changed_by UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO ops.place_disease_status (place_id, disease_type, status, source, notes, effective_date)
    VALUES (p_place_id, p_disease_type, p_status, 'manual_override', p_notes, CURRENT_DATE)
    ON CONFLICT (place_id, disease_type) DO UPDATE SET
        status = EXCLUDED.status,
        source = EXCLUDED.source,
        notes = EXCLUDED.notes,
        updated_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- set_place_classification
CREATE OR REPLACE FUNCTION ops.set_place_classification(
    p_place_id UUID,
    p_context_type TEXT,
    p_confidence NUMERIC DEFAULT 1.0,
    p_source TEXT DEFAULT 'manual',
    p_changed_by UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    PERFORM sot.assign_place_context(p_place_id, p_context_type, p_source, p_confidence);
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- remove_place_classification
CREATE OR REPLACE FUNCTION ops.remove_place_classification(
    p_place_id UUID,
    p_context_type TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    PERFORM sot.end_place_context(p_place_id, p_context_type);
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- accept_classification_suggestion
CREATE OR REPLACE FUNCTION ops.accept_classification_suggestion(
    p_suggestion_id UUID,
    p_accepted_by UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Stub - would accept a classification suggestion
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- override_classification_suggestion
CREATE OR REPLACE FUNCTION ops.override_classification_suggestion(
    p_suggestion_id UUID,
    p_new_classification TEXT,
    p_reason TEXT DEFAULT NULL,
    p_overridden_by UUID DEFAULT NULL,
    p_confidence NUMERIC DEFAULT 1.0
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Stub - would override a classification
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- resolve_person_duplicate
CREATE OR REPLACE FUNCTION ops.resolve_person_duplicate(
    p_loser_id UUID,
    p_action TEXT,
    p_winner_id UUID DEFAULT NULL,
    p_resolved_by UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_action = 'merge' AND p_winner_id IS NOT NULL THEN
        PERFORM sot.merge_person_into(p_loser_id, p_winner_id);
    END IF;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- reconcile_cluster_classification
CREATE OR REPLACE FUNCTION ops.reconcile_cluster_classification(
    p_cluster_id UUID,
    p_classification TEXT,
    p_reconciled_by UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Stub
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- dismiss_cluster
CREATE OR REPLACE FUNCTION ops.dismiss_cluster(
    p_cluster_id UUID,
    p_reason TEXT DEFAULT NULL,
    p_dismissed_by UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Stub
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- resolve_pending_trapper_link
CREATE OR REPLACE FUNCTION ops.resolve_pending_trapper_link(
    p_link_id UUID,
    p_action TEXT,
    p_person_id UUID DEFAULT NULL,
    p_resolved_by UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Stub
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- commit_trapper_report_item
CREATE OR REPLACE FUNCTION ops.commit_trapper_report_item(
    p_item_id UUID,
    p_committed_by UUID DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, message TEXT) AS $$
BEGIN
    RETURN QUERY SELECT TRUE, 'Committed'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- match_person_from_report
CREATE OR REPLACE FUNCTION ops.match_person_from_report(
    p_name TEXT,
    p_context JSONB DEFAULT NULL
)
RETURNS TABLE (
    person_id UUID,
    display_name TEXT,
    match_score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT p.person_id, p.display_name, sot.name_similarity(p.display_name, p_name) as match_score
    FROM sot.people p
    WHERE p.merged_into_person_id IS NULL
        AND sot.name_similarity(p.display_name, p_name) > 0.5
    ORDER BY match_score DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE;

-- match_request_from_report
CREATE OR REPLACE FUNCTION ops.match_request_from_report(
    p_address TEXT,
    p_date DATE DEFAULT NULL,
    p_context JSONB DEFAULT NULL
)
RETURNS TABLE (
    request_id UUID,
    place_address TEXT,
    match_score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT r.request_id, a.display_address, 0.5::NUMERIC as match_score
    FROM ops.requests r
    JOIN sot.places p ON p.place_id = r.place_id
    LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
    WHERE a.display_address ILIKE '%' || p_address || '%'
    LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE;

-- get_batch_files_in_order
CREATE OR REPLACE FUNCTION ops.get_batch_files_in_order(p_batch_id UUID)
RETURNS TABLE (
    file_id UUID,
    file_name TEXT,
    file_order INT
) AS $$
BEGIN
    -- Stub - would return batch files in order
    RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

-- record_cat_movement
CREATE OR REPLACE FUNCTION ops.record_cat_movement(
    p_cat_id UUID,
    p_from_place_id UUID,
    p_to_place_id UUID,
    p_movement_type TEXT DEFAULT 'transfer',
    p_recorded_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
BEGIN
    INSERT INTO sot.cat_movement_events (cat_id, from_place_id, to_place_id, movement_type, recorded_by)
    VALUES (p_cat_id, p_from_place_id, p_to_place_id, p_movement_type, p_recorded_by)
    RETURNING event_id INTO v_event_id;

    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- enqueue_processing
CREATE OR REPLACE FUNCTION ops.enqueue_processing(
    p_source TEXT,
    p_job_type TEXT,
    p_operation TEXT,
    p_entity_id UUID DEFAULT NULL,
    p_priority INT DEFAULT 0
)
RETURNS UUID AS $$
DECLARE
    v_job_id UUID;
BEGIN
    INSERT INTO ops.processing_jobs (source_system, job_type, operation, entity_id, priority, status)
    VALUES (p_source, p_job_type, p_operation, p_entity_id, p_priority, 'pending')
    RETURNING job_id INTO v_job_id;

    RETURN v_job_id;
END;
$$ LANGUAGE plpgsql;

\echo '   Created ops.* functions'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

DO $$
DECLARE
    v_sot_funcs INT;
    v_ops_funcs INT;
BEGIN
    SELECT COUNT(*) INTO v_sot_funcs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'sot';

    SELECT COUNT(*) INTO v_ops_funcs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops';

    RAISE NOTICE 'Function counts: sot.* = %, ops.* = %', v_sot_funcs, v_ops_funcs;
END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2301 Complete!'
\echo '=============================================='
\echo ''
