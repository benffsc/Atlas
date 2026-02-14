\echo '=== MIG_482: Source Confidence Scoring ==='
\echo 'Creates confidence scoring tables for identity matching by source'
\echo ''

-- ============================================================================
-- PURPOSE
-- Define confidence levels for identity matching based on data source.
-- Used by unified entity creation functions to weight matches.
-- ============================================================================

\echo 'Step 1: Creating source_identity_confidence table...'

CREATE TABLE IF NOT EXISTS trapper.source_identity_confidence (
    source_system TEXT PRIMARY KEY,

    -- Identity matching confidence (0.0 - 1.0)
    email_confidence NUMERIC(3,2) DEFAULT 0.90 CHECK (email_confidence BETWEEN 0 AND 1),
    phone_confidence NUMERIC(3,2) DEFAULT 0.85 CHECK (phone_confidence BETWEEN 0 AND 1),
    name_only_confidence NUMERIC(3,2) DEFAULT 0.40 CHECK (name_only_confidence BETWEEN 0 AND 1),
    source_id_confidence NUMERIC(3,2) DEFAULT 0.70 CHECK (source_id_confidence BETWEEN 0 AND 1),

    -- Data quality expectations
    data_quality_tier TEXT DEFAULT 'medium' CHECK (data_quality_tier IN ('high', 'medium', 'low')),

    -- Notes for humans
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.source_identity_confidence IS
'Confidence levels for identity matching by data source.
Higher confidence = more likely the email/phone is accurate.
Used by unified_find_or_create_* functions.';

COMMENT ON COLUMN trapper.source_identity_confidence.email_confidence IS
'Confidence that email from this source is valid and belongs to the right person (0-1)';

COMMENT ON COLUMN trapper.source_identity_confidence.phone_confidence IS
'Confidence that phone from this source is valid and belongs to the right person (0-1)';

COMMENT ON COLUMN trapper.source_identity_confidence.name_only_confidence IS
'Confidence when matching by name alone (without email/phone) from this source (0-1)';

COMMENT ON COLUMN trapper.source_identity_confidence.source_id_confidence IS
'Confidence when matching by source-specific ID (e.g., VH ID, SL ID) (0-1)';

\echo 'Created source_identity_confidence table'

-- ============================================================================
-- Step 2: Insert default confidence values
-- ============================================================================

\echo ''
\echo 'Step 2: Inserting default confidence values...'

INSERT INTO trapper.source_identity_confidence
(source_system, email_confidence, phone_confidence, name_only_confidence, source_id_confidence, data_quality_tier, notes)
VALUES
    -- Highest quality: Staff-entered and clinic data
    ('web_app', 0.95, 0.95, 0.60, NULL, 'high', 'Staff-entered data, manually verified'),
    ('clinichq', 0.95, 0.90, 0.50, 0.95, 'high', 'Clinic requires accurate contact for appointments'),

    -- High quality: Systems with login verification
    ('volunteerhub', 0.95, 0.85, 0.45, 0.90, 'high', 'VH requires valid login email'),

    -- Medium quality: External systems
    ('shelterluv', 0.85, 0.80, 0.40, 0.85, 'medium', 'Shelter data may have outdated contact info'),
    ('petlink', 0.85, 0.80, 0.40, 0.85, 'medium', 'Registry data from microchip registration'),

    -- Lower quality: Historical/imported data
    ('airtable', 0.80, 0.75, 0.35, 0.80, 'low', 'Historical data, may be outdated'),

    -- User-entered: Medium-high (users want to be contacted)
    ('web_intake', 0.90, 0.85, 0.50, NULL, 'medium', 'User-entered via web form'),

    -- Default for unknown sources
    ('unknown', 0.60, 0.55, 0.30, 0.50, 'low', 'Unknown source, low confidence')
ON CONFLICT (source_system) DO UPDATE SET
    email_confidence = EXCLUDED.email_confidence,
    phone_confidence = EXCLUDED.phone_confidence,
    name_only_confidence = EXCLUDED.name_only_confidence,
    source_id_confidence = EXCLUDED.source_id_confidence,
    data_quality_tier = EXCLUDED.data_quality_tier,
    notes = EXCLUDED.notes,
    updated_at = NOW();

\echo 'Inserted default confidence values'

-- ============================================================================
-- Step 3: Create function to get confidence for a source
-- ============================================================================

\echo ''
\echo 'Step 3: Creating get_source_confidence function...'

CREATE OR REPLACE FUNCTION trapper.get_source_confidence(
    p_source_system TEXT,
    p_match_type TEXT DEFAULT 'email'  -- 'email', 'phone', 'name_only', 'source_id'
)
RETURNS NUMERIC AS $$
DECLARE
    v_confidence NUMERIC;
BEGIN
    SELECT
        CASE p_match_type
            WHEN 'email' THEN email_confidence
            WHEN 'phone' THEN phone_confidence
            WHEN 'name_only' THEN name_only_confidence
            WHEN 'source_id' THEN source_id_confidence
            ELSE email_confidence  -- Default to email
        END INTO v_confidence
    FROM trapper.source_identity_confidence
    WHERE source_system = COALESCE(p_source_system, 'unknown');

    -- If source not found, use 'unknown' defaults
    IF v_confidence IS NULL THEN
        SELECT
            CASE p_match_type
                WHEN 'email' THEN email_confidence
                WHEN 'phone' THEN phone_confidence
                WHEN 'name_only' THEN name_only_confidence
                WHEN 'source_id' THEN source_id_confidence
                ELSE email_confidence
            END INTO v_confidence
        FROM trapper.source_identity_confidence
        WHERE source_system = 'unknown';
    END IF;

    RETURN COALESCE(v_confidence, 0.50);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_source_confidence IS
'Get identity matching confidence for a source and match type.
Returns confidence value (0-1) for use in identity resolution.';

\echo 'Created get_source_confidence function'

-- ============================================================================
-- Step 4: Create survivorship priority table
-- ============================================================================

\echo ''
\echo 'Step 4: Creating survivorship_priority table...'

CREATE TABLE IF NOT EXISTS trapper.survivorship_priority (
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'cat', 'place')),
    field_name TEXT NOT NULL,
    priority_order TEXT[] NOT NULL,  -- Array of source_systems in priority order
    notes TEXT,

    PRIMARY KEY (entity_type, field_name),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.survivorship_priority IS
'Defines which source wins when multiple sources provide conflicting values.
First source in priority_order wins (if it has a value).';

-- Insert default survivorship rules
INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
VALUES
    -- Person fields
    ('person', 'display_name', ARRAY['web_app', 'clinichq', 'shelterluv', 'volunteerhub', 'airtable', 'web_intake'],
     'Manual edits first, then clinic (most accurate names)'),
    ('person', 'email', ARRAY['web_app', 'volunteerhub', 'clinichq', 'shelterluv', 'web_intake', 'airtable'],
     'VH requires login email so its most reliable'),
    ('person', 'phone', ARRAY['web_app', 'clinichq', 'volunteerhub', 'shelterluv', 'web_intake', 'airtable'],
     'Clinic needs accurate contact for appointments'),
    ('person', 'address', ARRAY['web_app', 'clinichq', 'shelterluv', 'volunteerhub', 'web_intake', 'airtable'],
     'Clinic requires valid address'),

    -- Cat fields
    ('cat', 'microchip', ARRAY['clinichq', 'petlink', 'shelterluv', 'airtable'],
     'Clinic implants the chip, so its authoritative'),
    ('cat', 'altered_status', ARRAY['clinichq', 'shelterluv', 'web_intake', 'airtable'],
     'Clinic performs surgery, so its authoritative'),
    ('cat', 'name', ARRAY['shelterluv', 'clinichq', 'web_intake', 'airtable'],
     'Shelter assigns official names'),
    ('cat', 'breed', ARRAY['shelterluv', 'clinichq', 'web_intake', 'airtable'],
     'Shelter does formal breed assessment'),
    ('cat', 'sex', ARRAY['clinichq', 'shelterluv', 'web_intake', 'airtable'],
     'Clinic verifies sex during surgery'),

    -- Place fields
    ('place', 'formatted_address', ARRAY['web_app', 'clinichq', 'shelterluv', 'web_intake', 'airtable'],
     'Manual edits first'),
    ('place', 'lat_lng', ARRAY['google', 'web_app', 'clinichq'],
     'Google geocoding is most accurate')
ON CONFLICT (entity_type, field_name) DO UPDATE SET
    priority_order = EXCLUDED.priority_order,
    notes = EXCLUDED.notes;

\echo 'Created survivorship_priority table with defaults'

-- ============================================================================
-- Step 5: Create function to apply survivorship rules
-- ============================================================================

\echo ''
\echo 'Step 5: Creating apply_survivorship function...'

CREATE OR REPLACE FUNCTION trapper.apply_survivorship(
    p_entity_type TEXT,
    p_field_name TEXT,
    p_current_value TEXT,
    p_current_source TEXT,
    p_new_value TEXT,
    p_new_source TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_priority TEXT[];
    v_current_priority INT;
    v_new_priority INT;
    v_winner TEXT;
    v_winning_value TEXT;
BEGIN
    -- Get priority order for this field
    SELECT priority_order INTO v_priority
    FROM trapper.survivorship_priority
    WHERE entity_type = p_entity_type AND field_name = p_field_name;

    -- If no priority defined, new value wins if current is null
    IF v_priority IS NULL THEN
        RETURN jsonb_build_object(
            'winner', CASE WHEN p_current_value IS NULL THEN p_new_source ELSE p_current_source END,
            'value', COALESCE(p_current_value, p_new_value),
            'reason', 'no_priority_defined'
        );
    END IF;

    -- Find positions in priority array (1-indexed, 0 = not found)
    v_current_priority := COALESCE(array_position(v_priority, p_current_source), 999);
    v_new_priority := COALESCE(array_position(v_priority, p_new_source), 999);

    -- If new value is null, keep current regardless of priority
    IF p_new_value IS NULL OR LENGTH(TRIM(p_new_value)) = 0 THEN
        RETURN jsonb_build_object(
            'winner', p_current_source,
            'value', p_current_value,
            'reason', 'new_value_empty'
        );
    END IF;

    -- If current value is null, use new value
    IF p_current_value IS NULL OR LENGTH(TRIM(p_current_value)) = 0 THEN
        RETURN jsonb_build_object(
            'winner', p_new_source,
            'value', p_new_value,
            'reason', 'current_value_empty'
        );
    END IF;

    -- Compare priorities (lower = higher priority)
    IF v_new_priority < v_current_priority THEN
        v_winner := p_new_source;
        v_winning_value := p_new_value;
    ELSE
        v_winner := p_current_source;
        v_winning_value := p_current_value;
    END IF;

    RETURN jsonb_build_object(
        'winner', v_winner,
        'value', v_winning_value,
        'reason', 'priority_comparison',
        'current_priority', v_current_priority,
        'new_priority', v_new_priority
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.apply_survivorship IS
'Apply survivorship rules to determine which value wins when sources conflict.
Returns JSON with winner source, winning value, and reason.';

\echo 'Created apply_survivorship function'

-- ============================================================================
-- Step 6: Summary
-- ============================================================================

\echo ''
\echo '=== MIG_482 Complete ==='
\echo ''
\echo 'Created:'
\echo '  - source_identity_confidence: Confidence levels by source'
\echo '  - survivorship_priority: Which source wins for each field'
\echo '  - get_source_confidence(): Get confidence for source/match type'
\echo '  - apply_survivorship(): Determine winning value when sources conflict'
\echo ''
\echo 'Default confidence levels:'
\echo '  - clinichq: 95% email, 90% phone (high quality)'
\echo '  - volunteerhub: 95% email, 85% phone (high quality)'
\echo '  - shelterluv: 85% email, 80% phone (medium quality)'
\echo '  - airtable: 80% email, 75% phone (low quality)'
\echo '  - web_intake: 90% email, 85% phone (medium quality)'
\echo ''

