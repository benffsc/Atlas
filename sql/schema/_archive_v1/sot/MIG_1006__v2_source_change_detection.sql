-- MIG_1006: V2 Architecture - Source Change Detection System
-- Phase 1, Part 7: Track changes in external source systems
--
-- Problem: External systems (ClinicHQ, ShelterLuv, VolunteerHub) change over time:
--   - Account names get updated
--   - Cat ownership changes between people
--   - Volunteers join/leave groups (trappers added/removed)
--   - Contact info gets corrected
--
-- Solution: Track what we saw in each sync and detect changes on next sync:
--   1. Store sync state (what we saw, when)
--   2. Compare new sync against previous state
--   3. Generate change events
--   4. Process changes appropriately
--
-- Key Tables:
--   - source.sync_runs: Each sync operation
--   - source.sync_record_state: Current state of each source record (hash-based)
--   - source.change_events: Detected changes
--   - source.entity_source_links: Maps source records to Atlas entities

-- ============================================================================
-- SYNC RUNS - Track each sync operation
-- ============================================================================
CREATE TABLE IF NOT EXISTS source.sync_runs (
    sync_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What was synced
    source_system TEXT NOT NULL,  -- 'clinichq', 'shelterluv', 'volunteerhub'
    entity_type TEXT NOT NULL,    -- 'appointment', 'animal', 'person', 'group_membership'

    -- Sync metadata
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'partial')),

    -- Stats
    records_fetched INTEGER DEFAULT 0,
    records_new INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_deleted INTEGER DEFAULT 0,
    records_unchanged INTEGER DEFAULT 0,

    -- Error tracking
    error_message TEXT,
    error_details JSONB,

    -- Notes
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_source ON source.sync_runs(source_system, entity_type);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON source.sync_runs(status, started_at);

COMMENT ON TABLE source.sync_runs IS 'Layer 1 SOURCE: Track each sync operation from external systems';

-- ============================================================================
-- SYNC RECORD STATE - Current state of each source record
-- ============================================================================
CREATE TABLE IF NOT EXISTS source.sync_record_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source identification
    source_system TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    source_record_id TEXT NOT NULL,  -- ID in the source system

    -- Content hash for change detection
    content_hash TEXT NOT NULL,  -- Hash of key fields

    -- Last known values (denormalized for quick access)
    last_known_values JSONB NOT NULL,  -- Key fields from last sync

    -- Linked Atlas entity (if matched)
    linked_entity_type TEXT,  -- 'person', 'cat', 'place'
    linked_entity_id UUID,

    -- Timestamps
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_changed_at TIMESTAMPTZ,  -- When content_hash last changed
    last_sync_id UUID REFERENCES source.sync_runs(sync_id),

    -- Status
    is_active BOOLEAN DEFAULT TRUE,  -- FALSE if disappeared from source
    deleted_at TIMESTAMPTZ,

    UNIQUE (source_system, entity_type, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_state_source ON source.sync_record_state(source_system, entity_type);
CREATE INDEX IF NOT EXISTS idx_sync_state_linked ON source.sync_record_state(linked_entity_type, linked_entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_state_changed ON source.sync_record_state(last_changed_at) WHERE last_changed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sync_state_active ON source.sync_record_state(is_active, source_system);

COMMENT ON TABLE source.sync_record_state IS 'Layer 1 SOURCE: Current state of each record in external systems for change detection';

-- ============================================================================
-- CHANGE EVENTS - Log of detected changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS source.change_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source identification
    source_system TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    source_record_id TEXT NOT NULL,

    -- Change type
    change_type TEXT NOT NULL CHECK (change_type IN (
        'created',     -- New record appeared
        'updated',     -- Record fields changed
        'deleted',     -- Record disappeared from source
        'reappeared'   -- Previously deleted record came back
    )),

    -- What changed
    changed_fields TEXT[],  -- List of field names that changed
    old_values JSONB,       -- Previous values
    new_values JSONB,       -- New values

    -- Linked Atlas entity
    linked_entity_type TEXT,
    linked_entity_id UUID,

    -- Processing
    sync_id UUID REFERENCES source.sync_runs(sync_id),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    processed_by TEXT,  -- 'auto', 'manual', function name
    processing_result TEXT,  -- 'applied', 'skipped', 'error', 'queued_for_review'
    processing_notes TEXT,

    -- For review queue
    requires_review BOOLEAN DEFAULT FALSE,
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    review_decision TEXT
);

CREATE INDEX IF NOT EXISTS idx_change_events_source ON source.change_events(source_system, entity_type, detected_at);
CREATE INDEX IF NOT EXISTS idx_change_events_unprocessed ON source.change_events(detected_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_change_events_review ON source.change_events(requires_review, detected_at) WHERE requires_review = TRUE;
CREATE INDEX IF NOT EXISTS idx_change_events_entity ON source.change_events(linked_entity_type, linked_entity_id);
CREATE INDEX IF NOT EXISTS idx_change_events_sync ON source.change_events(sync_id);

COMMENT ON TABLE source.change_events IS 'Layer 1 SOURCE: Log of detected changes in external systems';

-- ============================================================================
-- ENTITY SOURCE LINKS - Maps source records to Atlas entities
-- ============================================================================
CREATE TABLE IF NOT EXISTS source.entity_source_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Atlas entity
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'cat', 'place', 'request')),
    entity_id UUID NOT NULL,

    -- Source record
    source_system TEXT NOT NULL,
    source_entity_type TEXT NOT NULL,  -- Type in source system (may differ from Atlas)
    source_record_id TEXT NOT NULL,

    -- Link metadata
    link_type TEXT DEFAULT 'primary' CHECK (link_type IN ('primary', 'alias', 'historical')),
    confidence NUMERIC(3,2) DEFAULT 1.0,

    -- Timestamps
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    linked_by TEXT,  -- 'auto_match', 'manual', 'migration'
    unlinked_at TIMESTAMPTZ,

    UNIQUE (source_system, source_entity_type, source_record_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_entity_source_links_entity ON source.entity_source_links(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_source_links_source ON source.entity_source_links(source_system, source_record_id);

COMMENT ON TABLE source.entity_source_links IS 'Layer 1 SOURCE: Maps external system records to Atlas entities';

-- ============================================================================
-- VOLUNTEERHUB GROUP MEMBERSHIP TRACKING
-- ============================================================================
CREATE TABLE IF NOT EXISTS source.volunteerhub_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- VolunteerHub identifiers
    volunteerhub_user_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    group_name TEXT NOT NULL,

    -- Linked Atlas person
    person_id UUID REFERENCES sot.people(person_id),

    -- Status
    is_member BOOLEAN DEFAULT TRUE,

    -- History
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at TIMESTAMPTZ,  -- When they left the group

    -- Sync tracking
    last_sync_id UUID REFERENCES source.sync_runs(sync_id),

    UNIQUE (volunteerhub_user_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_vhub_memberships_user ON source.volunteerhub_memberships(volunteerhub_user_id);
CREATE INDEX IF NOT EXISTS idx_vhub_memberships_group ON source.volunteerhub_memberships(group_name);
CREATE INDEX IF NOT EXISTS idx_vhub_memberships_person ON source.volunteerhub_memberships(person_id);
CREATE INDEX IF NOT EXISTS idx_vhub_memberships_active ON source.volunteerhub_memberships(is_member, group_name) WHERE is_member = TRUE;

COMMENT ON TABLE source.volunteerhub_memberships IS 'Layer 1 SOURCE: Track VolunteerHub group memberships over time';

-- ============================================================================
-- CLINICHQ OWNER HISTORY - Track owner info changes per animal
-- ============================================================================
CREATE TABLE IF NOT EXISTS source.clinichq_owner_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ClinicHQ identifiers
    clinichq_animal_id TEXT NOT NULL,
    appointment_number TEXT,

    -- Owner info at this point in time
    owner_first_name TEXT,
    owner_last_name TEXT,
    owner_email TEXT,
    owner_phone TEXT,
    owner_address TEXT,

    -- Normalized for comparison
    owner_hash TEXT NOT NULL,  -- Hash of normalized owner info

    -- Linked entities
    cat_id UUID REFERENCES sot.cats(cat_id),
    person_id UUID REFERENCES sot.people(person_id),

    -- Timestamps
    seen_at DATE NOT NULL,  -- Appointment date
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Sync tracking
    sync_id UUID REFERENCES source.sync_runs(sync_id)
);

CREATE INDEX IF NOT EXISTS idx_chq_owner_history_animal ON source.clinichq_owner_history(clinichq_animal_id, seen_at);
CREATE INDEX IF NOT EXISTS idx_chq_owner_history_cat ON source.clinichq_owner_history(cat_id);
CREATE INDEX IF NOT EXISTS idx_chq_owner_history_person ON source.clinichq_owner_history(person_id);

COMMENT ON TABLE source.clinichq_owner_history IS 'Layer 1 SOURCE: Track ClinicHQ owner info changes per animal over time';

-- ============================================================================
-- SHELTERLUV OUTCOME HISTORY - Track animal outcome changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS source.shelterluv_outcome_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ShelterLuv identifiers
    shelterluv_animal_id TEXT NOT NULL,
    shelterluv_person_id TEXT,

    -- Outcome info
    outcome_type TEXT,  -- 'adoption', 'foster', 'transfer', 'return', 'death'
    outcome_subtype TEXT,
    outcome_date DATE,

    -- Person info at outcome time
    person_name TEXT,
    person_email TEXT,
    person_phone TEXT,
    person_address TEXT,

    -- Linked entities
    cat_id UUID REFERENCES sot.cats(cat_id),
    person_id UUID REFERENCES sot.people(person_id),

    -- Timestamps
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Sync tracking
    sync_id UUID REFERENCES source.sync_runs(sync_id)
);

CREATE INDEX IF NOT EXISTS idx_sl_outcome_animal ON source.shelterluv_outcome_history(shelterluv_animal_id, outcome_date);
CREATE INDEX IF NOT EXISTS idx_sl_outcome_cat ON source.shelterluv_outcome_history(cat_id);
CREATE INDEX IF NOT EXISTS idx_sl_outcome_type ON source.shelterluv_outcome_history(outcome_type);

COMMENT ON TABLE source.shelterluv_outcome_history IS 'Layer 1 SOURCE: Track ShelterLuv animal outcomes over time';

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Generate content hash for change detection
CREATE OR REPLACE FUNCTION source.generate_record_hash(p_values JSONB)
RETURNS TEXT AS $$
BEGIN
    -- Sort keys and hash for consistent comparison
    RETURN md5(p_values::TEXT);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Start a sync run
CREATE OR REPLACE FUNCTION source.start_sync_run(
    p_source_system TEXT,
    p_entity_type TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_sync_id UUID;
BEGIN
    INSERT INTO source.sync_runs (source_system, entity_type, notes)
    VALUES (p_source_system, p_entity_type, p_notes)
    RETURNING sync_id INTO v_sync_id;

    RETURN v_sync_id;
END;
$$ LANGUAGE plpgsql;

-- Complete a sync run
CREATE OR REPLACE FUNCTION source.complete_sync_run(
    p_sync_id UUID,
    p_status TEXT DEFAULT 'completed',
    p_error_message TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    UPDATE source.sync_runs
    SET
        completed_at = NOW(),
        status = p_status,
        error_message = p_error_message,
        -- Count stats from change events
        records_new = (SELECT COUNT(*) FROM source.change_events WHERE sync_id = p_sync_id AND change_type = 'created'),
        records_updated = (SELECT COUNT(*) FROM source.change_events WHERE sync_id = p_sync_id AND change_type = 'updated'),
        records_deleted = (SELECT COUNT(*) FROM source.change_events WHERE sync_id = p_sync_id AND change_type = 'deleted')
    WHERE sync_id = p_sync_id;
END;
$$ LANGUAGE plpgsql;

-- Process a source record and detect changes
CREATE OR REPLACE FUNCTION source.process_source_record(
    p_sync_id UUID,
    p_source_system TEXT,
    p_entity_type TEXT,
    p_source_record_id TEXT,
    p_values JSONB,
    p_linked_entity_type TEXT DEFAULT NULL,
    p_linked_entity_id UUID DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
    v_content_hash TEXT;
    v_existing RECORD;
    v_change_type TEXT;
    v_changed_fields TEXT[];
    v_old_values JSONB;
BEGIN
    -- Generate hash of current values
    v_content_hash := source.generate_record_hash(p_values);

    -- Check if we've seen this record before
    SELECT * INTO v_existing
    FROM source.sync_record_state
    WHERE source_system = p_source_system
      AND entity_type = p_entity_type
      AND source_record_id = p_source_record_id;

    IF NOT FOUND THEN
        -- New record
        v_change_type := 'created';

        INSERT INTO source.sync_record_state (
            source_system, entity_type, source_record_id,
            content_hash, last_known_values,
            linked_entity_type, linked_entity_id,
            last_sync_id
        ) VALUES (
            p_source_system, p_entity_type, p_source_record_id,
            v_content_hash, p_values,
            p_linked_entity_type, p_linked_entity_id,
            p_sync_id
        );

    ELSIF v_existing.content_hash != v_content_hash THEN
        -- Record changed
        v_change_type := 'updated';
        v_old_values := v_existing.last_known_values;

        -- Detect which fields changed
        SELECT array_agg(key) INTO v_changed_fields
        FROM (
            SELECT key FROM jsonb_each(p_values)
            EXCEPT
            SELECT key FROM jsonb_each(v_old_values)
            WHERE (p_values->key)::TEXT = (v_old_values->key)::TEXT
        ) changed;

        -- Update state
        UPDATE source.sync_record_state
        SET
            content_hash = v_content_hash,
            last_known_values = p_values,
            last_seen_at = NOW(),
            last_changed_at = NOW(),
            last_sync_id = p_sync_id,
            linked_entity_type = COALESCE(p_linked_entity_type, linked_entity_type),
            linked_entity_id = COALESCE(p_linked_entity_id, linked_entity_id),
            is_active = TRUE,
            deleted_at = NULL
        WHERE id = v_existing.id;

    ELSIF NOT v_existing.is_active THEN
        -- Record reappeared
        v_change_type := 'reappeared';
        v_old_values := v_existing.last_known_values;

        UPDATE source.sync_record_state
        SET
            last_seen_at = NOW(),
            last_sync_id = p_sync_id,
            is_active = TRUE,
            deleted_at = NULL
        WHERE id = v_existing.id;

    ELSE
        -- No change
        UPDATE source.sync_record_state
        SET
            last_seen_at = NOW(),
            last_sync_id = p_sync_id
        WHERE id = v_existing.id;

        RETURN 'unchanged';
    END IF;

    -- Log change event
    IF v_change_type IS NOT NULL THEN
        INSERT INTO source.change_events (
            source_system, entity_type, source_record_id,
            change_type, changed_fields, old_values, new_values,
            linked_entity_type, linked_entity_id,
            sync_id
        ) VALUES (
            p_source_system, p_entity_type, p_source_record_id,
            v_change_type, v_changed_fields, v_old_values, p_values,
            COALESCE(p_linked_entity_type, v_existing.linked_entity_type),
            COALESCE(p_linked_entity_id, v_existing.linked_entity_id),
            p_sync_id
        );
    END IF;

    RETURN v_change_type;
END;
$$ LANGUAGE plpgsql;

-- Mark records not seen in sync as deleted
CREATE OR REPLACE FUNCTION source.mark_missing_as_deleted(
    p_sync_id UUID,
    p_source_system TEXT,
    p_entity_type TEXT
)
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER := 0;
    v_record RECORD;
BEGIN
    -- Find records that weren't updated in this sync
    FOR v_record IN
        SELECT id, source_record_id, last_known_values, linked_entity_type, linked_entity_id
        FROM source.sync_record_state
        WHERE source_system = p_source_system
          AND entity_type = p_entity_type
          AND is_active = TRUE
          AND (last_sync_id IS NULL OR last_sync_id != p_sync_id)
    LOOP
        -- Mark as deleted
        UPDATE source.sync_record_state
        SET
            is_active = FALSE,
            deleted_at = NOW(),
            last_sync_id = p_sync_id
        WHERE id = v_record.id;

        -- Log deletion event
        INSERT INTO source.change_events (
            source_system, entity_type, source_record_id,
            change_type, old_values,
            linked_entity_type, linked_entity_id,
            sync_id
        ) VALUES (
            p_source_system, p_entity_type, v_record.source_record_id,
            'deleted', v_record.last_known_values,
            v_record.linked_entity_type, v_record.linked_entity_id,
            p_sync_id
        );

        v_deleted_count := v_deleted_count + 1;
    END LOOP;

    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VOLUNTEERHUB-SPECIFIC FUNCTIONS
-- ============================================================================

-- Process VolunteerHub group membership sync
CREATE OR REPLACE FUNCTION source.sync_volunteerhub_membership(
    p_sync_id UUID,
    p_volunteerhub_user_id TEXT,
    p_group_id TEXT,
    p_group_name TEXT,
    p_person_id UUID DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
    v_existing RECORD;
    v_result TEXT;
BEGIN
    SELECT * INTO v_existing
    FROM source.volunteerhub_memberships
    WHERE volunteerhub_user_id = p_volunteerhub_user_id
      AND group_id = p_group_id;

    IF NOT FOUND THEN
        -- New membership
        INSERT INTO source.volunteerhub_memberships (
            volunteerhub_user_id, group_id, group_name,
            person_id, last_sync_id
        ) VALUES (
            p_volunteerhub_user_id, p_group_id, p_group_name,
            p_person_id, p_sync_id
        );

        -- Log as change event
        INSERT INTO source.change_events (
            source_system, entity_type, source_record_id,
            change_type, new_values,
            linked_entity_type, linked_entity_id,
            sync_id
        ) VALUES (
            'volunteerhub', 'group_membership', p_volunteerhub_user_id || ':' || p_group_id,
            'created', jsonb_build_object('group_name', p_group_name, 'user_id', p_volunteerhub_user_id),
            'person', p_person_id,
            p_sync_id
        );

        v_result := 'added';

    ELSIF NOT v_existing.is_member THEN
        -- Rejoined group
        UPDATE source.volunteerhub_memberships
        SET
            is_member = TRUE,
            last_seen_at = NOW(),
            removed_at = NULL,
            last_sync_id = p_sync_id,
            person_id = COALESCE(p_person_id, person_id)
        WHERE id = v_existing.id;

        INSERT INTO source.change_events (
            source_system, entity_type, source_record_id,
            change_type, new_values,
            linked_entity_type, linked_entity_id,
            sync_id
        ) VALUES (
            'volunteerhub', 'group_membership', p_volunteerhub_user_id || ':' || p_group_id,
            'reappeared', jsonb_build_object('group_name', p_group_name),
            'person', COALESCE(p_person_id, v_existing.person_id),
            p_sync_id
        );

        v_result := 'rejoined';

    ELSE
        -- Still a member, just update last_seen
        UPDATE source.volunteerhub_memberships
        SET
            last_seen_at = NOW(),
            last_sync_id = p_sync_id,
            person_id = COALESCE(p_person_id, person_id)
        WHERE id = v_existing.id;

        v_result := 'unchanged';
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Mark memberships not seen in sync as removed
CREATE OR REPLACE FUNCTION source.mark_removed_memberships(
    p_sync_id UUID,
    p_group_id TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_removed_count INTEGER := 0;
    v_record RECORD;
BEGIN
    FOR v_record IN
        SELECT id, volunteerhub_user_id, group_id, group_name, person_id
        FROM source.volunteerhub_memberships
        WHERE is_member = TRUE
          AND (last_sync_id IS NULL OR last_sync_id != p_sync_id)
          AND (p_group_id IS NULL OR group_id = p_group_id)
    LOOP
        UPDATE source.volunteerhub_memberships
        SET
            is_member = FALSE,
            removed_at = NOW(),
            last_sync_id = p_sync_id
        WHERE id = v_record.id;

        INSERT INTO source.change_events (
            source_system, entity_type, source_record_id,
            change_type, old_values,
            linked_entity_type, linked_entity_id,
            sync_id
        ) VALUES (
            'volunteerhub', 'group_membership', v_record.volunteerhub_user_id || ':' || v_record.group_id,
            'deleted', jsonb_build_object('group_name', v_record.group_name),
            'person', v_record.person_id,
            p_sync_id
        );

        v_removed_count := v_removed_count + 1;
    END LOOP;

    RETURN v_removed_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CLINICHQ OWNER CHANGE DETECTION
-- ============================================================================

-- Track owner info for a ClinicHQ animal
CREATE OR REPLACE FUNCTION source.track_clinichq_owner(
    p_sync_id UUID,
    p_clinichq_animal_id TEXT,
    p_appointment_number TEXT,
    p_appointment_date DATE,
    p_owner_first_name TEXT,
    p_owner_last_name TEXT,
    p_owner_email TEXT,
    p_owner_phone TEXT,
    p_owner_address TEXT,
    p_cat_id UUID DEFAULT NULL,
    p_person_id UUID DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
    v_owner_hash TEXT;
    v_last_owner RECORD;
    v_result TEXT := 'new';
BEGIN
    -- Generate hash of owner info
    v_owner_hash := md5(COALESCE(LOWER(TRIM(p_owner_first_name)), '') || '|' ||
                        COALESCE(LOWER(TRIM(p_owner_last_name)), '') || '|' ||
                        COALESCE(LOWER(TRIM(p_owner_email)), '') || '|' ||
                        COALESCE(REGEXP_REPLACE(p_owner_phone, '[^0-9]', '', 'g'), ''));

    -- Get last known owner for this animal
    SELECT * INTO v_last_owner
    FROM source.clinichq_owner_history
    WHERE clinichq_animal_id = p_clinichq_animal_id
    ORDER BY seen_at DESC, recorded_at DESC
    LIMIT 1;

    -- Check if owner changed
    IF FOUND AND v_last_owner.owner_hash = v_owner_hash THEN
        v_result := 'unchanged';
    ELSIF FOUND THEN
        v_result := 'changed';

        -- Log owner change event
        INSERT INTO source.change_events (
            source_system, entity_type, source_record_id,
            change_type,
            old_values,
            new_values,
            linked_entity_type, linked_entity_id,
            sync_id,
            requires_review
        ) VALUES (
            'clinichq', 'owner_change', p_clinichq_animal_id,
            'updated',
            jsonb_build_object(
                'first_name', v_last_owner.owner_first_name,
                'last_name', v_last_owner.owner_last_name,
                'email', v_last_owner.owner_email,
                'phone', v_last_owner.owner_phone,
                'address', v_last_owner.owner_address,
                'person_id', v_last_owner.person_id
            ),
            jsonb_build_object(
                'first_name', p_owner_first_name,
                'last_name', p_owner_last_name,
                'email', p_owner_email,
                'phone', p_owner_phone,
                'address', p_owner_address,
                'person_id', p_person_id
            ),
            'cat', COALESCE(p_cat_id, v_last_owner.cat_id),
            p_sync_id,
            TRUE  -- Owner changes should be reviewed
        );
    END IF;

    -- Record this owner observation
    INSERT INTO source.clinichq_owner_history (
        clinichq_animal_id, appointment_number,
        owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
        owner_hash,
        cat_id, person_id,
        seen_at, sync_id
    ) VALUES (
        p_clinichq_animal_id, p_appointment_number,
        p_owner_first_name, p_owner_last_name, p_owner_email, p_owner_phone, p_owner_address,
        v_owner_hash,
        p_cat_id, p_person_id,
        p_appointment_date, p_sync_id
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS FOR MONITORING
-- ============================================================================

-- Recent change events
CREATE OR REPLACE VIEW source.v_recent_changes AS
SELECT
    ce.event_id,
    ce.source_system,
    ce.entity_type,
    ce.source_record_id,
    ce.change_type,
    ce.changed_fields,
    ce.detected_at,
    ce.processed_at,
    ce.processing_result,
    ce.requires_review,
    ce.linked_entity_type,
    ce.linked_entity_id,
    sr.started_at as sync_started_at
FROM source.change_events ce
LEFT JOIN source.sync_runs sr ON sr.sync_id = ce.sync_id
ORDER BY ce.detected_at DESC;

COMMENT ON VIEW source.v_recent_changes IS 'Recent changes detected from source systems';

-- Pending reviews
CREATE OR REPLACE VIEW source.v_pending_reviews AS
SELECT
    ce.*,
    CASE ce.linked_entity_type
        WHEN 'person' THEN (SELECT display_name FROM sot.people WHERE person_id = ce.linked_entity_id)
        WHEN 'cat' THEN (SELECT name FROM sot.cats WHERE cat_id = ce.linked_entity_id)
        WHEN 'place' THEN (SELECT display_name FROM sot.places WHERE place_id = ce.linked_entity_id)
    END as entity_name
FROM source.change_events ce
WHERE ce.requires_review = TRUE
  AND ce.reviewed_at IS NULL
ORDER BY ce.detected_at;

COMMENT ON VIEW source.v_pending_reviews IS 'Changes requiring manual review';

-- VolunteerHub trapper changes
CREATE OR REPLACE VIEW source.v_trapper_changes AS
SELECT
    ce.event_id,
    ce.change_type,
    ce.new_values->>'group_name' as group_name,
    ce.linked_entity_id as person_id,
    p.display_name as person_name,
    ce.detected_at,
    ce.processed_at
FROM source.change_events ce
LEFT JOIN sot.people p ON p.person_id = ce.linked_entity_id
WHERE ce.source_system = 'volunteerhub'
  AND ce.entity_type = 'group_membership'
  AND (ce.new_values->>'group_name' ILIKE '%trapper%'
       OR ce.old_values->>'group_name' ILIKE '%trapper%')
ORDER BY ce.detected_at DESC;

COMMENT ON VIEW source.v_trapper_changes IS 'Trapper group membership changes from VolunteerHub';

-- Cat owner changes
CREATE OR REPLACE VIEW source.v_cat_owner_changes AS
SELECT
    ce.event_id,
    ce.source_record_id as clinichq_animal_id,
    c.name as cat_name,
    c.microchip,
    CONCAT_WS(' ', (ce.old_values->>'first_name')::TEXT, (ce.old_values->>'last_name')::TEXT) as old_owner,
    CONCAT_WS(' ', (ce.new_values->>'first_name')::TEXT, (ce.new_values->>'last_name')::TEXT) as new_owner,
    ce.old_values->>'email' as old_email,
    ce.new_values->>'email' as new_email,
    ce.detected_at,
    ce.reviewed_at,
    ce.review_decision
FROM source.change_events ce
LEFT JOIN sot.cats c ON c.cat_id = ce.linked_entity_id
WHERE ce.source_system = 'clinichq'
  AND ce.entity_type = 'owner_change'
ORDER BY ce.detected_at DESC;

COMMENT ON VIEW source.v_cat_owner_changes IS 'Cat owner changes detected from ClinicHQ';

-- Sync run summary
CREATE OR REPLACE VIEW source.v_sync_summary AS
SELECT
    sr.sync_id,
    sr.source_system,
    sr.entity_type,
    sr.started_at,
    sr.completed_at,
    sr.status,
    sr.records_fetched,
    sr.records_new,
    sr.records_updated,
    sr.records_deleted,
    sr.records_unchanged,
    EXTRACT(EPOCH FROM (sr.completed_at - sr.started_at))::INTEGER as duration_seconds
FROM source.sync_runs sr
ORDER BY sr.started_at DESC;

COMMENT ON VIEW source.v_sync_summary IS 'Summary of sync runs with stats';

-- ============================================================================
-- VERIFY
-- ============================================================================
DO $$
DECLARE
    v_tables TEXT[] := ARRAY[
        'source.sync_runs',
        'source.sync_record_state',
        'source.change_events',
        'source.entity_source_links',
        'source.volunteerhub_memberships',
        'source.clinichq_owner_history',
        'source.shelterluv_outcome_history'
    ];
    v_table TEXT;
    v_missing TEXT[];
BEGIN
    FOREACH v_table IN ARRAY v_tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema || '.' || table_name = v_table
        ) THEN
            v_missing := array_append(v_missing, v_table);
        END IF;
    END LOOP;

    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION 'Failed to create source change detection tables: %', array_to_string(v_missing, ', ');
    END IF;

    RAISE NOTICE 'V2 source change detection system created successfully';
    RAISE NOTICE 'Tables: %', array_to_string(v_tables, ', ');
END $$;
