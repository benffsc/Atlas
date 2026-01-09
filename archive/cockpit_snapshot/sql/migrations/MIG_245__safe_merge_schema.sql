-- MIG_245__safe_merge_schema.sql
-- MEGA_002: Safe Merge primitives for identity consolidation
--
-- Core principle: NO DATA LOST
-- - All merges are explicit, auditable, reversible
-- - Original source rows are preserved
-- - Aliases store all name/phone/email/address variants
-- - Merge ledger enables unmerge capability
--
-- SAFE: Additive only, no destructive operations

-- ============================================================
-- PART 1: Person Aliases (name variants, phones, emails)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.person_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The canonical person this alias belongs to
    person_id UUID NOT NULL REFERENCES trapper.people(id) ON DELETE CASCADE,

    -- Alias type
    alias_type TEXT NOT NULL CHECK (alias_type IN (
        'name',           -- Name variant (maiden name, nickname, typo correction)
        'phone',          -- Phone number variant
        'email',          -- Email variant
        'external_id'     -- External system ID (clinichq_client_id, airtable_record_id)
    )),

    -- The alias value (normalized for matching)
    alias_value TEXT NOT NULL,

    -- Raw/original value before normalization
    alias_raw TEXT,

    -- Source tracking
    source_system TEXT NOT NULL CHECK (source_system IN (
        'clinichq', 'airtable', 'cockpit_ui', 'import', 'manual', 'migration'
    )),
    source_record_id TEXT,
    source_row_hash TEXT,

    -- Confidence and status
    confidence_score SMALLINT DEFAULT 100 CHECK (confidence_score >= 0 AND confidence_score <= 100),
    is_primary BOOLEAN DEFAULT FALSE,  -- Is this the "preferred" value for this type?
    is_verified BOOLEAN DEFAULT FALSE,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system',
    notes TEXT
);

COMMENT ON TABLE trapper.person_aliases IS
'Stores all name/phone/email variants for a person. Enables matching without losing original values.';

CREATE INDEX IF NOT EXISTS idx_person_aliases_person
ON trapper.person_aliases(person_id);

CREATE INDEX IF NOT EXISTS idx_person_aliases_value
ON trapper.person_aliases(alias_type, alias_value);

CREATE INDEX IF NOT EXISTS idx_person_aliases_source
ON trapper.person_aliases(source_system, source_record_id);

-- ============================================================
-- PART 2: Place Aliases (name variants)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.place_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The canonical place this alias belongs to
    place_id UUID NOT NULL REFERENCES trapper.places(id) ON DELETE CASCADE,

    -- Alias type
    alias_type TEXT NOT NULL CHECK (alias_type IN (
        'name',           -- Place name variant
        'display_name',   -- Display name variant
        'company_name',   -- Company/business name used at this place
        'external_id'     -- External system ID
    )),

    -- The alias value
    alias_value TEXT NOT NULL,
    alias_raw TEXT,

    -- Source tracking
    source_system TEXT NOT NULL CHECK (source_system IN (
        'clinichq', 'airtable', 'cockpit_ui', 'import', 'manual', 'migration'
    )),
    source_record_id TEXT,
    source_row_hash TEXT,

    -- Confidence and status
    confidence_score SMALLINT DEFAULT 100 CHECK (confidence_score >= 0 AND confidence_score <= 100),
    is_primary BOOLEAN DEFAULT FALSE,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system',
    notes TEXT
);

COMMENT ON TABLE trapper.place_aliases IS
'Stores all name variants for a place. Supports "company address used under other names" case.';

CREATE INDEX IF NOT EXISTS idx_place_aliases_place
ON trapper.place_aliases(place_id);

CREATE INDEX IF NOT EXISTS idx_place_aliases_value
ON trapper.place_aliases(alias_type, alias_value);

-- ============================================================
-- PART 3: Entity Links (source rows -> canonical entities)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.entity_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source row identification
    source_system TEXT NOT NULL CHECK (source_system IN (
        'clinichq_hist_owners', 'clinichq_hist_cats', 'clinichq_upcoming',
        'airtable_requests', 'airtable_contacts', 'cockpit'
    )),
    source_table TEXT NOT NULL,
    source_record_id TEXT NOT NULL,
    source_row_hash TEXT,

    -- Canonical entity reference
    canonical_entity_type TEXT NOT NULL CHECK (canonical_entity_type IN (
        'person', 'place', 'address', 'request'
    )),
    canonical_entity_id UUID NOT NULL,

    -- Link confidence and method
    link_confidence SMALLINT DEFAULT 100 CHECK (link_confidence >= 0 AND link_confidence <= 100),
    link_method TEXT NOT NULL CHECK (link_method IN (
        'exact_match',      -- Exact field match
        'fuzzy_match',      -- Fuzzy/phonetic match
        'manual_link',      -- Human-verified link
        'auto_inferred',    -- System inferred (e.g., same phone + address)
        'migration'         -- Created during migration
    )),

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    superseded_by UUID REFERENCES trapper.entity_links(id),

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system',
    notes TEXT
);

COMMENT ON TABLE trapper.entity_links IS
'Links source system rows to canonical entities. Enables tracing from canonical back to all sources.';

CREATE INDEX IF NOT EXISTS idx_entity_links_source
ON trapper.entity_links(source_system, source_record_id);

CREATE INDEX IF NOT EXISTS idx_entity_links_canonical
ON trapper.entity_links(canonical_entity_type, canonical_entity_id);

CREATE INDEX IF NOT EXISTS idx_entity_links_active
ON trapper.entity_links(is_active) WHERE is_active = TRUE;

-- ============================================================
-- PART 4: Merge Operations (who/when/why)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.merge_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What was merged
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'place', 'address')),

    -- The surviving canonical entity (target)
    target_entity_id UUID NOT NULL,

    -- The merged-away entity (source) - kept for audit but marked as merged
    source_entity_id UUID NOT NULL,

    -- Merge metadata
    merge_reason TEXT NOT NULL,
    merge_method TEXT NOT NULL CHECK (merge_method IN (
        'auto_exact',      -- Automatic exact match
        'auto_fuzzy',      -- Automatic fuzzy match
        'manual_confirm',  -- Human confirmed suggested merge
        'manual_force',    -- Human forced merge despite low confidence
        'import'           -- Created during import
    )),

    -- Status
    status TEXT NOT NULL DEFAULT 'executed' CHECK (status IN (
        'pending',    -- Preview only, not yet executed
        'executed',   -- Merge completed
        'reverted'    -- Merge was undone
    )),

    -- Dry-run results (for preview)
    preview_data JSONB,

    -- Audit
    executed_at TIMESTAMPTZ,
    executed_by TEXT,
    reverted_at TIMESTAMPTZ,
    reverted_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system',
    notes TEXT
);

COMMENT ON TABLE trapper.merge_operations IS
'Records all merge operations. Every merge is auditable and can be reverted.';

CREATE INDEX IF NOT EXISTS idx_merge_operations_target
ON trapper.merge_operations(entity_type, target_entity_id);

CREATE INDEX IF NOT EXISTS idx_merge_operations_source
ON trapper.merge_operations(entity_type, source_entity_id);

CREATE INDEX IF NOT EXISTS idx_merge_operations_status
ON trapper.merge_operations(status);

-- ============================================================
-- PART 5: Merge Effects (field-level changes for rollback)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.merge_effects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Reference to the merge operation
    merge_operation_id UUID NOT NULL REFERENCES trapper.merge_operations(id) ON DELETE CASCADE,

    -- What was affected
    affected_table TEXT NOT NULL,
    affected_column TEXT NOT NULL,
    affected_row_id UUID NOT NULL,

    -- Before/after values for rollback
    value_before TEXT,
    value_after TEXT,

    -- Why this value was chosen
    decision_reason TEXT,  -- e.g., "kept value from source A because higher confidence"

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE trapper.merge_effects IS
'Records field-level changes from merges. Enables precise unmerge by reversing each change.';

CREATE INDEX IF NOT EXISTS idx_merge_effects_operation
ON trapper.merge_effects(merge_operation_id);

CREATE INDEX IF NOT EXISTS idx_merge_effects_affected
ON trapper.merge_effects(affected_table, affected_row_id);

-- ============================================================
-- PART 6: Typed Address Relations
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.person_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The person
    person_id UUID NOT NULL REFERENCES trapper.people(id) ON DELETE CASCADE,

    -- The address
    address_id UUID NOT NULL REFERENCES trapper.addresses(id) ON DELETE RESTRICT,

    -- Address type (MEGA_002 G1: cat location != client address)
    address_type TEXT NOT NULL CHECK (address_type IN (
        'home',             -- Person's home/mailing address
        'cat_location',     -- Where the cats are (may differ from home)
        'workplace',        -- Work address
        'adopter_address',  -- Address where person adopted to
        'temporary',        -- Temporary/vacation address
        'historical'        -- Previous address (moved)
    )),

    -- Time range this address was active
    start_at TIMESTAMPTZ DEFAULT NOW(),
    end_at TIMESTAMPTZ,  -- NULL means current

    -- Flags
    is_primary BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,

    -- Source tracking
    source_system TEXT CHECK (source_system IN (
        'clinichq', 'airtable', 'cockpit_ui', 'import', 'manual', 'migration'
    )),
    source_record_id TEXT,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system',
    notes TEXT,

    -- Prevent duplicate type+address for same person at same time
    CONSTRAINT unique_person_address_type UNIQUE (person_id, address_id, address_type, COALESCE(end_at, '9999-12-31'::timestamptz))
);

COMMENT ON TABLE trapper.person_addresses IS
'Typed address relations for people. Supports "cat location != client address" and address history.';

CREATE INDEX IF NOT EXISTS idx_person_addresses_person
ON trapper.person_addresses(person_id);

CREATE INDEX IF NOT EXISTS idx_person_addresses_address
ON trapper.person_addresses(address_id);

CREATE INDEX IF NOT EXISTS idx_person_addresses_type
ON trapper.person_addresses(address_type);

-- ============================================================
-- PART 7: Helper function to add alias (idempotent)
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.add_person_alias(
    p_person_id UUID,
    p_alias_type TEXT,
    p_alias_value TEXT,
    p_source_system TEXT DEFAULT 'cockpit_ui',
    p_source_record_id TEXT DEFAULT NULL,
    p_is_primary BOOLEAN DEFAULT FALSE
) RETURNS UUID AS $$
DECLARE
    v_normalized TEXT;
    v_alias_id UUID;
BEGIN
    -- Normalize the value
    v_normalized := LOWER(TRIM(p_alias_value));

    -- Check if this alias already exists
    SELECT id INTO v_alias_id
    FROM trapper.person_aliases
    WHERE person_id = p_person_id
      AND alias_type = p_alias_type
      AND alias_value = v_normalized;

    IF v_alias_id IS NOT NULL THEN
        -- Already exists, return existing ID
        RETURN v_alias_id;
    END IF;

    -- Insert new alias
    INSERT INTO trapper.person_aliases (
        person_id, alias_type, alias_value, alias_raw,
        source_system, source_record_id, is_primary
    ) VALUES (
        p_person_id, p_alias_type, v_normalized, p_alias_value,
        p_source_system, p_source_record_id, p_is_primary
    )
    RETURNING id INTO v_alias_id;

    -- If marked as primary, unset other primary aliases of same type
    IF p_is_primary THEN
        UPDATE trapper.person_aliases
        SET is_primary = FALSE
        WHERE person_id = p_person_id
          AND alias_type = p_alias_type
          AND id != v_alias_id;
    END IF;

    RETURN v_alias_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 8: Helper function to link source record to canonical entity
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.link_source_to_canonical(
    p_source_system TEXT,
    p_source_table TEXT,
    p_source_record_id TEXT,
    p_canonical_entity_type TEXT,
    p_canonical_entity_id UUID,
    p_link_method TEXT DEFAULT 'migration',
    p_link_confidence SMALLINT DEFAULT 100
) RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
BEGIN
    -- Check if link already exists
    SELECT id INTO v_link_id
    FROM trapper.entity_links
    WHERE source_system = p_source_system
      AND source_record_id = p_source_record_id
      AND canonical_entity_type = p_canonical_entity_type
      AND canonical_entity_id = p_canonical_entity_id
      AND is_active = TRUE;

    IF v_link_id IS NOT NULL THEN
        RETURN v_link_id;
    END IF;

    -- Create new link
    INSERT INTO trapper.entity_links (
        source_system, source_table, source_record_id,
        canonical_entity_type, canonical_entity_id,
        link_method, link_confidence
    ) VALUES (
        p_source_system, p_source_table, p_source_record_id,
        p_canonical_entity_type, p_canonical_entity_id,
        p_link_method, p_link_confidence
    )
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 9: View for finding potential duplicates
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_person_duplicate_candidates AS
SELECT
    p1.id AS person_a_id,
    p1.display_name AS person_a_name,
    p1.phone AS person_a_phone,
    p1.email AS person_a_email,
    p2.id AS person_b_id,
    p2.display_name AS person_b_name,
    p2.phone AS person_b_phone,
    p2.email AS person_b_email,
    -- Match reasons
    CASE
        WHEN LOWER(p1.phone) = LOWER(p2.phone) AND p1.phone IS NOT NULL THEN 'exact_phone'
        WHEN LOWER(p1.email) = LOWER(p2.email) AND p1.email IS NOT NULL THEN 'exact_email'
        WHEN similarity(LOWER(COALESCE(p1.display_name, '')), LOWER(COALESCE(p2.display_name, ''))) > 0.8 THEN 'similar_name'
        ELSE 'other'
    END AS match_type,
    -- Confidence score
    CASE
        WHEN LOWER(p1.phone) = LOWER(p2.phone) AND p1.phone IS NOT NULL THEN 90
        WHEN LOWER(p1.email) = LOWER(p2.email) AND p1.email IS NOT NULL THEN 95
        WHEN similarity(LOWER(COALESCE(p1.display_name, '')), LOWER(COALESCE(p2.display_name, ''))) > 0.8 THEN 70
        ELSE 50
    END AS match_confidence
FROM trapper.people p1
JOIN trapper.people p2 ON p1.id < p2.id  -- Avoid duplicate pairs
WHERE
    -- Same phone (normalized)
    (LOWER(TRIM(p1.phone)) = LOWER(TRIM(p2.phone)) AND p1.phone IS NOT NULL AND p1.phone != '')
    OR
    -- Same email (case-insensitive)
    (LOWER(TRIM(p1.email)) = LOWER(TRIM(p2.email)) AND p1.email IS NOT NULL AND p1.email != '')
    OR
    -- Similar name (requires pg_trgm extension)
    (similarity(LOWER(COALESCE(p1.display_name, '')), LOWER(COALESCE(p2.display_name, ''))) > 0.8);

COMMENT ON VIEW trapper.v_person_duplicate_candidates IS
'Surfaces potential duplicate people based on matching phone, email, or similar names.';

-- ============================================================
-- Verification
-- ============================================================

\echo ''
\echo 'MIG_245 applied. Safe merge schema created.'
\echo ''

\echo 'Tables created:'
SELECT tablename FROM pg_tables WHERE schemaname = 'trapper' AND tablename IN (
    'person_aliases', 'place_aliases', 'entity_links',
    'merge_operations', 'merge_effects', 'person_addresses'
) ORDER BY tablename;

\echo ''
\echo 'Functions created:'
SELECT proname FROM pg_proc WHERE pronamespace = 'trapper'::regnamespace
AND proname IN ('add_person_alias', 'link_source_to_canonical');
