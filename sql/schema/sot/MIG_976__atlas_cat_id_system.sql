-- MIG_976: Atlas Cat ID System
--
-- Purpose: Create a human-readable identification system for verified clinic cats
-- Format: MMDDYYYY##-[****] where:
--   - MMDDYYYY = clinic appointment date
--   - ## = clinic day number (01-99, from master list waiver)
--   - **** = last 4 digits of microchip OR 4-char hash for unchipped cats
--
-- Key Design Decisions:
--   1. IMMUTABILITY: Atlas Cat ID assigned ONCE on first clinic visit with clinic_day_number
--   2. RECAPTURE: Same cat returning gets same ID (no new ID generated)
--   3. MERGE SUPPORT: Loser cat's atlas_cat_id preserved as queryable alias
--
-- MANUAL APPLY:
--   export $(cat .env.local | grep DATABASE_URL)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_976__atlas_cat_id_system.sql

\echo ''
\echo '=============================================='
\echo 'MIG_976: Atlas Cat ID System'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. ADD ATLAS_CAT_ID COLUMN TO SOT_CATS
-- ============================================================

\echo '1. Adding atlas_cat_id column to sot_cats...'

ALTER TABLE trapper.sot_cats
ADD COLUMN IF NOT EXISTS atlas_cat_id TEXT;

-- Unique index - only one cat can have a given atlas_cat_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_sot_cats_atlas_cat_id
ON trapper.sot_cats(atlas_cat_id)
WHERE atlas_cat_id IS NOT NULL;

COMMENT ON COLUMN trapper.sot_cats.atlas_cat_id IS
'Human-readable ID for verified clinic cats. Format: MMDDYYYY##-[****]
where MMDDYYYY is clinic date, ## is clinic day number (01-99),
and **** is last 4 of microchip or hash for unchipped.
IMMUTABLE once assigned. See MIG_976.';

-- ============================================================
-- 2. CREATE ATLAS_CAT_ID_REGISTRY TABLE (Collision Prevention)
-- ============================================================

\echo '2. Creating atlas_cat_id_registry table...'

CREATE TABLE IF NOT EXISTS trapper.atlas_cat_id_registry (
    registry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The components that form the atlas_cat_id
    clinic_date DATE NOT NULL,
    clinic_day_number SMALLINT NOT NULL,

    -- Reference to the cat
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),

    -- The generated atlas_cat_id
    atlas_cat_id TEXT NOT NULL,

    -- Suffix type tracking
    microchip_suffix TEXT,  -- Last 4 of microchip (NULL for unchipped)
    hash_suffix TEXT,       -- 4-char hash (NULL for chipped)

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system',

    -- Constraints
    UNIQUE (clinic_date, clinic_day_number),  -- Only one cat per date+number combo
    UNIQUE (atlas_cat_id),                     -- IDs must be globally unique
    UNIQUE (cat_id)                            -- One atlas_cat_id per cat
);

CREATE INDEX IF NOT EXISTS idx_atlas_cat_id_registry_date
ON trapper.atlas_cat_id_registry(clinic_date);

CREATE INDEX IF NOT EXISTS idx_atlas_cat_id_registry_cat
ON trapper.atlas_cat_id_registry(cat_id);

COMMENT ON TABLE trapper.atlas_cat_id_registry IS
'Registry of all generated Atlas Cat IDs for collision prevention.
Each cat can only have ONE atlas_cat_id (enforced by unique constraint).
Each clinic_date + clinic_day_number combination can only be used once.
See MIG_976 for Atlas Cat ID System documentation.';

-- ============================================================
-- 3. CREATE ATLAS_CAT_ID_ALIASES TABLE (Merge Support)
-- ============================================================

\echo '3. Creating atlas_cat_id_aliases table...'

CREATE TABLE IF NOT EXISTS trapper.atlas_cat_id_aliases (
    alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The old atlas_cat_id that was on the merged (loser) cat
    alias_atlas_cat_id TEXT NOT NULL UNIQUE,

    -- The canonical cat this alias now points to (winner)
    canonical_cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),

    -- The original cat that had this ID (for audit trail)
    original_cat_id UUID NOT NULL,

    -- Merge metadata
    merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    merge_reason TEXT,
    merged_by TEXT DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_atlas_cat_id_aliases_canonical
ON trapper.atlas_cat_id_aliases(canonical_cat_id);

CREATE INDEX IF NOT EXISTS idx_atlas_cat_id_aliases_original
ON trapper.atlas_cat_id_aliases(original_cat_id);

COMMENT ON TABLE trapper.atlas_cat_id_aliases IS
'Stores atlas_cat_id values from merged cats as queryable aliases.
When cat A (with atlas_cat_id) is merged into cat B:
  - B keeps its atlas_cat_id (or gets A''s if B had none)
  - A''s atlas_cat_id becomes an alias pointing to B
This ensures historical references remain valid.
See MIG_976.';

-- ============================================================
-- 4. HELPER FUNCTION: Generate Suffix
-- ============================================================

\echo '4. Creating helper functions...'

CREATE OR REPLACE FUNCTION trapper.generate_atlas_cat_id_suffix(
    p_cat_id UUID
) RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_microchip TEXT;
BEGIN
    -- Try to get microchip
    SELECT ci.id_value INTO v_microchip
    FROM trapper.cat_identifiers ci
    WHERE ci.cat_id = p_cat_id
      AND ci.id_type = 'microchip'
      AND ci.id_value IS NOT NULL
      AND ci.id_value != ''
    ORDER BY ci.confidence DESC, ci.created_at DESC
    LIMIT 1;

    IF v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 4 THEN
        -- Return last 4 digits of microchip
        RETURN RIGHT(v_microchip, 4);
    ELSE
        -- Return first 4 chars of MD5 hash (uppercase)
        RETURN UPPER(LEFT(MD5(p_cat_id::TEXT), 4));
    END IF;
END;
$$;

COMMENT ON FUNCTION trapper.generate_atlas_cat_id_suffix IS
'Generates the 4-character suffix for Atlas Cat ID.
If cat has microchip: returns last 4 digits.
If no microchip: returns uppercase 4-char MD5 hash of cat_id.
See MIG_976.';

-- ============================================================
-- 5. MAIN FUNCTION: Generate Atlas Cat ID
-- ============================================================

\echo '5. Creating generate_atlas_cat_id function...'

CREATE OR REPLACE FUNCTION trapper.generate_atlas_cat_id(
    p_cat_id UUID,
    p_clinic_date DATE,
    p_clinic_day_number INTEGER,
    p_created_by TEXT DEFAULT 'system'
) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    v_existing_id TEXT;
    v_suffix TEXT;
    v_atlas_cat_id TEXT;
    v_microchip TEXT;
    v_microchip_suffix TEXT;
    v_hash_suffix TEXT;
BEGIN
    -- Check if cat already has an atlas_cat_id (immutability)
    SELECT atlas_cat_id INTO v_existing_id
    FROM trapper.sot_cats
    WHERE cat_id = p_cat_id
      AND atlas_cat_id IS NOT NULL;

    IF v_existing_id IS NOT NULL THEN
        -- Cat already has an ID - return it (no new ID generated)
        RETURN v_existing_id;
    END IF;

    -- Check if this cat is already in the registry
    SELECT atlas_cat_id INTO v_existing_id
    FROM trapper.atlas_cat_id_registry
    WHERE cat_id = p_cat_id;

    IF v_existing_id IS NOT NULL THEN
        RETURN v_existing_id;
    END IF;

    -- Validate clinic_day_number
    IF p_clinic_day_number < 1 OR p_clinic_day_number > 99 THEN
        RAISE EXCEPTION 'clinic_day_number must be between 1 and 99, got: %', p_clinic_day_number;
    END IF;

    -- Check if this date+number combo is already taken
    IF EXISTS (
        SELECT 1 FROM trapper.atlas_cat_id_registry
        WHERE clinic_date = p_clinic_date
          AND clinic_day_number = p_clinic_day_number
    ) THEN
        RAISE EXCEPTION 'Atlas Cat ID for date % number % already assigned',
            p_clinic_date, p_clinic_day_number;
    END IF;

    -- Generate suffix (microchip last 4 or hash)
    v_suffix := trapper.generate_atlas_cat_id_suffix(p_cat_id);

    -- Determine if we used microchip or hash
    SELECT ci.id_value INTO v_microchip
    FROM trapper.cat_identifiers ci
    WHERE ci.cat_id = p_cat_id
      AND ci.id_type = 'microchip'
      AND ci.id_value IS NOT NULL
      AND ci.id_value != ''
    ORDER BY ci.confidence DESC, ci.created_at DESC
    LIMIT 1;

    IF v_microchip IS NOT NULL AND LENGTH(v_microchip) >= 4 THEN
        v_microchip_suffix := v_suffix;
        v_hash_suffix := NULL;
    ELSE
        v_microchip_suffix := NULL;
        v_hash_suffix := v_suffix;
    END IF;

    -- Build the atlas_cat_id: MMDDYYYY##-[****]
    v_atlas_cat_id := TO_CHAR(p_clinic_date, 'MMDDYYYY')
        || LPAD(p_clinic_day_number::TEXT, 2, '0')
        || '-'
        || v_suffix;

    -- Register the ID
    INSERT INTO trapper.atlas_cat_id_registry (
        clinic_date,
        clinic_day_number,
        cat_id,
        atlas_cat_id,
        microchip_suffix,
        hash_suffix,
        created_by
    ) VALUES (
        p_clinic_date,
        p_clinic_day_number,
        p_cat_id,
        v_atlas_cat_id,
        v_microchip_suffix,
        v_hash_suffix,
        p_created_by
    );

    -- Update the cat record
    UPDATE trapper.sot_cats
    SET atlas_cat_id = v_atlas_cat_id,
        updated_at = NOW()
    WHERE cat_id = p_cat_id;

    -- Also add to cat_identifiers for unified lookup
    INSERT INTO trapper.cat_identifiers (
        cat_id,
        id_type,
        id_value,
        id_value_norm,
        source_system,
        source_table,
        confidence,
        created_at
    ) VALUES (
        p_cat_id,
        'atlas_cat_id',
        v_atlas_cat_id,
        v_atlas_cat_id,
        'atlas_ui',
        'atlas_cat_id_registry',
        1.0,
        NOW()
    )
    ON CONFLICT (cat_id, id_type, id_value) DO NOTHING;

    RETURN v_atlas_cat_id;
END;
$$;

COMMENT ON FUNCTION trapper.generate_atlas_cat_id IS
'Generates and registers an Atlas Cat ID for a verified clinic cat.
Format: MMDDYYYY##-[****]
- Returns existing ID if cat already has one (immutability)
- Validates clinic_day_number is 1-99
- Prevents duplicate date+number assignments
- Adds to cat_identifiers for unified lookup
See MIG_976.';

-- ============================================================
-- 6. LOOKUP FUNCTION: Find Cat by Atlas Cat ID
-- ============================================================

\echo '6. Creating find_cat_by_atlas_cat_id function...'

CREATE OR REPLACE FUNCTION trapper.find_cat_by_atlas_cat_id(
    p_atlas_cat_id TEXT
) RETURNS UUID
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_cat_id UUID;
BEGIN
    -- First, check sot_cats directly
    SELECT cat_id INTO v_cat_id
    FROM trapper.sot_cats
    WHERE atlas_cat_id = p_atlas_cat_id
      AND merged_into_cat_id IS NULL;

    IF v_cat_id IS NOT NULL THEN
        RETURN v_cat_id;
    END IF;

    -- Second, check aliases (for merged cats)
    SELECT canonical_cat_id INTO v_cat_id
    FROM trapper.atlas_cat_id_aliases
    WHERE alias_atlas_cat_id = p_atlas_cat_id;

    IF v_cat_id IS NOT NULL THEN
        -- Follow merge chain to get truly canonical cat
        RETURN trapper.get_canonical_cat_id(v_cat_id);
    END IF;

    -- Not found
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION trapper.find_cat_by_atlas_cat_id IS
'Looks up a cat by Atlas Cat ID.
1. Checks sot_cats.atlas_cat_id (canonical cats)
2. Checks atlas_cat_id_aliases (for merged cat lookups)
3. Follows merge chain to return truly canonical cat_id
Returns NULL if not found.
See MIG_976.';

-- ============================================================
-- 7. MERGE SUPPORT: Transfer Atlas Cat ID on Merge
-- ============================================================

\echo '7. Creating transfer_atlas_cat_id_on_merge function...'

CREATE OR REPLACE FUNCTION trapper.transfer_atlas_cat_id_on_merge(
    p_source_cat_id UUID,  -- The cat being merged away (loser)
    p_target_cat_id UUID,  -- The cat being merged into (winner)
    p_reason TEXT DEFAULT 'merge',
    p_merged_by TEXT DEFAULT 'system'
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_source_atlas_id TEXT;
    v_target_atlas_id TEXT;
BEGIN
    -- Get atlas_cat_ids
    SELECT atlas_cat_id INTO v_source_atlas_id
    FROM trapper.sot_cats
    WHERE cat_id = p_source_cat_id;

    SELECT atlas_cat_id INTO v_target_atlas_id
    FROM trapper.sot_cats
    WHERE cat_id = p_target_cat_id;

    -- If source has an atlas_cat_id
    IF v_source_atlas_id IS NOT NULL THEN
        -- Create alias pointing to target
        INSERT INTO trapper.atlas_cat_id_aliases (
            alias_atlas_cat_id,
            canonical_cat_id,
            original_cat_id,
            merge_reason,
            merged_by
        ) VALUES (
            v_source_atlas_id,
            p_target_cat_id,
            p_source_cat_id,
            p_reason,
            p_merged_by
        )
        ON CONFLICT (alias_atlas_cat_id) DO UPDATE
        SET canonical_cat_id = p_target_cat_id,
            merge_reason = p_reason,
            merged_at = NOW();

        -- If target has no atlas_cat_id, give it source's
        IF v_target_atlas_id IS NULL THEN
            UPDATE trapper.sot_cats
            SET atlas_cat_id = v_source_atlas_id,
                updated_at = NOW()
            WHERE cat_id = p_target_cat_id;

            -- Update registry to point to target
            UPDATE trapper.atlas_cat_id_registry
            SET cat_id = p_target_cat_id
            WHERE cat_id = p_source_cat_id;
        END IF;

        -- Clear source's atlas_cat_id (it's now an alias)
        UPDATE trapper.sot_cats
        SET atlas_cat_id = NULL,
            updated_at = NOW()
        WHERE cat_id = p_source_cat_id;
    END IF;
END;
$$;

COMMENT ON FUNCTION trapper.transfer_atlas_cat_id_on_merge IS
'Handles Atlas Cat ID transfer during cat merges.
- Source cat''s atlas_cat_id becomes an alias pointing to target
- If target has no atlas_cat_id, it inherits source''s
- Source''s atlas_cat_id is cleared (preserved only as alias)
Call this from merge_cats() function.
See MIG_976.';

-- ============================================================
-- 8. UPDATE MERGE_CATS TO CALL TRANSFER FUNCTION
-- ============================================================

\echo '8. Updating merge_cats function to handle atlas_cat_id...'

-- We need to update merge_cats to call transfer_atlas_cat_id_on_merge
-- First, let's add a call to the transfer function in the existing merge_cats

CREATE OR REPLACE FUNCTION trapper.merge_cats(
    p_source_cat_id UUID,
    p_target_cat_id UUID,
    p_reason TEXT DEFAULT 'manual_merge',
    p_merged_by TEXT DEFAULT 'system'
) RETURNS jsonb AS $$
DECLARE
    v_source_cat RECORD;
    v_target_cat RECORD;
    v_result jsonb;
    v_transferred jsonb := '{}'::jsonb;
    v_merge_id UUID;
BEGIN
    -- Validate inputs
    IF p_source_cat_id = p_target_cat_id THEN
        RAISE EXCEPTION 'Cannot merge cat into itself';
    END IF;

    -- Get source cat
    SELECT * INTO v_source_cat FROM trapper.sot_cats WHERE cat_id = p_source_cat_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source cat not found: %', p_source_cat_id;
    END IF;

    IF v_source_cat.merged_into_cat_id IS NOT NULL THEN
        RAISE EXCEPTION 'Source cat is already merged into %', v_source_cat.merged_into_cat_id;
    END IF;

    -- Get target cat
    SELECT * INTO v_target_cat FROM trapper.sot_cats WHERE cat_id = p_target_cat_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target cat not found: %', p_target_cat_id;
    END IF;

    IF v_target_cat.merged_into_cat_id IS NOT NULL THEN
        RAISE EXCEPTION 'Target cat is already merged. Use canonical: %', v_target_cat.merged_into_cat_id;
    END IF;

    -- *** NEW: Transfer Atlas Cat ID before other operations ***
    PERFORM trapper.transfer_atlas_cat_id_on_merge(
        p_source_cat_id,
        p_target_cat_id,
        p_reason,
        p_merged_by
    );

    -- Transfer cat_identifiers
    WITH transferred AS (
        UPDATE trapper.cat_identifiers
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.cat_identifiers ci2
            WHERE ci2.cat_id = p_target_cat_id
            AND ci2.id_type = cat_identifiers.id_type
            AND ci2.id_value = cat_identifiers.id_value
        )
        RETURNING identifier_id
    )
    SELECT jsonb_set(v_transferred, '{identifiers}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer cat_procedures
    WITH transferred AS (
        UPDATE trapper.cat_procedures
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        RETURNING procedure_id
    )
    SELECT jsonb_set(v_transferred, '{procedures}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer cat_place_relationships
    WITH transferred AS (
        UPDATE trapper.cat_place_relationships
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.cat_place_relationships cpr2
            WHERE cpr2.cat_id = p_target_cat_id
            AND cpr2.place_id = cat_place_relationships.place_id
        )
        RETURNING relationship_id
    )
    SELECT jsonb_set(v_transferred, '{place_relationships}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer person_cat_relationships
    WITH transferred AS (
        UPDATE trapper.person_cat_relationships
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.person_cat_relationships pcr2
            WHERE pcr2.cat_id = p_target_cat_id
            AND pcr2.person_id = person_cat_relationships.person_id
        )
        RETURNING relationship_id
    )
    SELECT jsonb_set(v_transferred, '{person_relationships}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer sot_appointments
    WITH transferred AS (
        UPDATE trapper.sot_appointments
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        RETURNING appointment_id
    )
    SELECT jsonb_set(v_transferred, '{appointments}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Transfer request_cat_links
    WITH transferred AS (
        UPDATE trapper.request_cat_links
        SET cat_id = p_target_cat_id
        WHERE cat_id = p_source_cat_id
        AND NOT EXISTS (
            SELECT 1 FROM trapper.request_cat_links rcl2
            WHERE rcl2.cat_id = p_target_cat_id
            AND rcl2.request_id = request_cat_links.request_id
        )
        RETURNING link_id
    )
    SELECT jsonb_set(v_transferred, '{request_links}', to_jsonb(COUNT(*))) INTO v_transferred FROM transferred;

    -- Mark source as merged
    UPDATE trapper.sot_cats
    SET merged_into_cat_id = p_target_cat_id,
        merged_at = NOW(),
        merge_reason = p_reason,
        updated_at = NOW()
    WHERE cat_id = p_source_cat_id;

    -- Enrich target cat with any missing data from source
    UPDATE trapper.sot_cats
    SET
        sex = COALESCE(sex, v_source_cat.sex),
        birth_year = COALESCE(birth_year, v_source_cat.birth_year),
        primary_color = COALESCE(primary_color, v_source_cat.primary_color),
        secondary_color = COALESCE(secondary_color, v_source_cat.secondary_color),
        breed = COALESCE(breed, v_source_cat.breed),
        notes = CASE
            WHEN notes IS NULL THEN v_source_cat.notes
            WHEN v_source_cat.notes IS NOT NULL THEN notes || E'\n[Merged from ' || COALESCE(v_source_cat.atlas_id, v_source_cat.atlas_cat_id, v_source_cat.cat_id::TEXT) || '] ' || v_source_cat.notes
            ELSE notes
        END,
        updated_at = NOW()
    WHERE cat_id = p_target_cat_id;

    -- Log to history (include atlas_cat_id info)
    v_merge_id := trapper.log_entity_merge(
        'cat', p_source_cat_id, p_target_cat_id,
        COALESCE(v_source_cat.atlas_cat_id, v_source_cat.atlas_id),
        COALESCE(v_target_cat.atlas_cat_id, v_target_cat.atlas_id),
        p_reason, p_merged_by,
        jsonb_build_object(
            'transferred', v_transferred,
            'source_atlas_cat_id', v_source_cat.atlas_cat_id,
            'target_atlas_cat_id', v_target_cat.atlas_cat_id
        )
    );

    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'merge_id', v_merge_id,
        'source_cat_id', p_source_cat_id,
        'target_cat_id', p_target_cat_id,
        'source_atlas_id', v_source_cat.atlas_id,
        'target_atlas_id', v_target_cat.atlas_id,
        'source_atlas_cat_id', v_source_cat.atlas_cat_id,
        'target_atlas_cat_id', v_target_cat.atlas_cat_id,
        'source_name', v_source_cat.display_name,
        'target_name', v_target_cat.display_name,
        'reason', p_reason,
        'merged_by', p_merged_by,
        'merged_at', NOW(),
        'transferred', v_transferred
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 9. TRIGGER: Auto-generate on clinic_day_number assignment
-- ============================================================

\echo '9. Creating trigger for auto-generation...'

CREATE OR REPLACE FUNCTION trapper.trg_generate_atlas_cat_id_on_appointment()
RETURNS TRIGGER AS $$
BEGIN
    -- Only fire when clinic_day_number is set and cat_id exists
    IF NEW.clinic_day_number IS NOT NULL
       AND NEW.cat_id IS NOT NULL
       AND NEW.appointment_date IS NOT NULL THEN

        -- Check if this cat already has an atlas_cat_id
        IF NOT EXISTS (
            SELECT 1 FROM trapper.sot_cats
            WHERE cat_id = NEW.cat_id
              AND atlas_cat_id IS NOT NULL
        ) THEN
            -- Generate the atlas_cat_id
            PERFORM trapper.generate_atlas_cat_id(
                NEW.cat_id,
                NEW.appointment_date,
                NEW.clinic_day_number,
                'trigger'
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_appointment_atlas_cat_id ON trapper.sot_appointments;

-- Create the trigger
CREATE TRIGGER trg_appointment_atlas_cat_id
    AFTER INSERT OR UPDATE OF clinic_day_number
    ON trapper.sot_appointments
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_generate_atlas_cat_id_on_appointment();

COMMENT ON FUNCTION trapper.trg_generate_atlas_cat_id_on_appointment IS
'Trigger function that auto-generates atlas_cat_id when clinic_day_number is assigned.
Only fires if the cat does not already have an atlas_cat_id.
See MIG_976.';

-- ============================================================
-- 10. UTILITY: Check Microchip Status
-- ============================================================

\echo '10. Creating microchip status helper...'

CREATE OR REPLACE FUNCTION trapper.get_cat_microchip_status(p_cat_id UUID)
RETURNS TABLE (
    has_microchip BOOLEAN,
    microchip TEXT,
    atlas_cat_id TEXT,
    atlas_cat_id_type TEXT  -- 'microchip' or 'hash'
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    SELECT
        EXISTS (
            SELECT 1 FROM trapper.cat_identifiers ci
            WHERE ci.cat_id = p_cat_id
              AND ci.id_type = 'microchip'
              AND ci.id_value IS NOT NULL
              AND ci.id_value != ''
        ) AS has_microchip,
        (
            SELECT ci.id_value FROM trapper.cat_identifiers ci
            WHERE ci.cat_id = p_cat_id
              AND ci.id_type = 'microchip'
              AND ci.id_value IS NOT NULL
              AND ci.id_value != ''
            ORDER BY ci.confidence DESC, ci.created_at DESC
            LIMIT 1
        ) AS microchip,
        c.atlas_cat_id,
        CASE
            WHEN r.microchip_suffix IS NOT NULL THEN 'microchip'
            WHEN r.hash_suffix IS NOT NULL THEN 'hash'
            ELSE NULL
        END AS atlas_cat_id_type
    FROM trapper.sot_cats c
    LEFT JOIN trapper.atlas_cat_id_registry r ON r.cat_id = c.cat_id
    WHERE c.cat_id = p_cat_id;
END;
$$;

COMMENT ON FUNCTION trapper.get_cat_microchip_status IS
'Returns microchip status and atlas_cat_id info for a cat.
Used by UI to determine badge display (chipped vs unchipped).
See MIG_976.';

-- ============================================================
-- 11. VIEW: Cats with Atlas Cat IDs
-- ============================================================

\echo '11. Creating view for cats with atlas_cat_id...'

CREATE OR REPLACE VIEW trapper.v_cats_with_atlas_id AS
SELECT
    c.cat_id,
    c.atlas_cat_id,
    c.display_name AS cat_name,
    c.name,
    c.sex,
    c.microchip,
    r.clinic_date,
    r.clinic_day_number,
    r.microchip_suffix,
    r.hash_suffix,
    CASE
        WHEN r.microchip_suffix IS NOT NULL THEN 'chipped'
        WHEN r.hash_suffix IS NOT NULL THEN 'unchipped'
        ELSE NULL
    END AS chip_status,
    r.created_at AS atlas_id_created_at,
    c.created_at AS cat_created_at
FROM trapper.sot_cats c
INNER JOIN trapper.atlas_cat_id_registry r ON r.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NULL
ORDER BY r.clinic_date DESC, r.clinic_day_number;

COMMENT ON VIEW trapper.v_cats_with_atlas_id IS
'View of all cats with Atlas Cat IDs, showing chip status.
Excludes merged cats.
Use this for Beacon verified cat population.
See MIG_976.';

-- ============================================================
-- 12. VERIFICATION
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Atlas Cat ID column on sot_cats:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'sot_cats'
AND column_name = 'atlas_cat_id';

\echo ''
\echo 'Atlas Cat ID tables:'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'trapper'
AND table_name LIKE 'atlas_cat_id%'
ORDER BY table_name;

\echo ''
\echo 'Atlas Cat ID functions:'
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'trapper'
AND (routine_name LIKE '%atlas_cat_id%' OR routine_name LIKE 'get_cat_microchip%')
ORDER BY routine_name;

\echo ''
\echo 'Trigger on sot_appointments:'
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'trapper'
AND trigger_name = 'trg_appointment_atlas_cat_id';

-- ============================================================
-- 13. BACKFILL: Generate IDs for existing cats with clinic_day_number
-- ============================================================

\echo ''
\echo '13. Backfilling atlas_cat_id for existing cats with clinic_day_number...'

-- First, show how many cats need backfill
\echo 'Appointments with clinic_day_number (candidates for backfill):'
SELECT COUNT(*) AS total_appointments_with_clinic_day_number
FROM trapper.sot_appointments
WHERE clinic_day_number IS NOT NULL
  AND cat_id IS NOT NULL;

\echo ''
\echo 'Cats without atlas_cat_id that have appointments with clinic_day_number:'
SELECT COUNT(DISTINCT a.cat_id) AS cats_to_backfill
FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
WHERE a.clinic_day_number IS NOT NULL
  AND a.cat_id IS NOT NULL
  AND c.atlas_cat_id IS NULL
  AND c.merged_into_cat_id IS NULL;

-- Backfill using the earliest appointment with clinic_day_number per cat
\echo ''
\echo 'Running backfill...'

DO $$
DECLARE
    v_record RECORD;
    v_atlas_cat_id TEXT;
    v_count INTEGER := 0;
    v_errors INTEGER := 0;
BEGIN
    -- Get earliest appointment with clinic_day_number for each cat
    FOR v_record IN
        SELECT DISTINCT ON (a.cat_id)
            a.cat_id,
            a.appointment_date,
            a.clinic_day_number
        FROM trapper.sot_appointments a
        JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
        WHERE a.clinic_day_number IS NOT NULL
          AND a.cat_id IS NOT NULL
          AND c.atlas_cat_id IS NULL
          AND c.merged_into_cat_id IS NULL
        ORDER BY a.cat_id, a.appointment_date ASC
    LOOP
        BEGIN
            -- Generate atlas_cat_id
            v_atlas_cat_id := trapper.generate_atlas_cat_id(
                v_record.cat_id,
                v_record.appointment_date,
                v_record.clinic_day_number,
                'backfill_mig_976'
            );
            v_count := v_count + 1;

            -- Log progress every 100 records
            IF v_count % 100 = 0 THEN
                RAISE NOTICE 'Backfilled % cats...', v_count;
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                -- Log error but continue
                RAISE WARNING 'Failed to generate atlas_cat_id for cat %, date %, number %: %',
                    v_record.cat_id, v_record.appointment_date, v_record.clinic_day_number, SQLERRM;
                v_errors := v_errors + 1;
        END;
    END LOOP;

    RAISE NOTICE 'Backfill complete: % cats processed, % errors', v_count, v_errors;
END;
$$;

-- Show results
\echo ''
\echo 'Backfill results:'
SELECT COUNT(*) AS cats_with_atlas_cat_id
FROM trapper.sot_cats
WHERE atlas_cat_id IS NOT NULL
  AND merged_into_cat_id IS NULL;

\echo ''
\echo 'Registry entries:'
SELECT COUNT(*) AS total_registry_entries FROM trapper.atlas_cat_id_registry;

\echo ''
\echo 'Chip status distribution:'
SELECT
    CASE
        WHEN microchip_suffix IS NOT NULL THEN 'chipped'
        ELSE 'unchipped'
    END AS status,
    COUNT(*) AS count
FROM trapper.atlas_cat_id_registry
GROUP BY 1;

\echo ''
\echo '=============================================='
\echo 'MIG_976 Complete!'
\echo '=============================================='
\echo ''
\echo 'New capabilities:'
\echo '  - atlas_cat_id column on sot_cats'
\echo '  - atlas_cat_id_registry table (collision prevention)'
\echo '  - atlas_cat_id_aliases table (merge support)'
\echo ''
\echo 'Functions:'
\echo '  - generate_atlas_cat_id(cat_id, date, number) - Create ID'
\echo '  - find_cat_by_atlas_cat_id(id) - Lookup with alias support'
\echo '  - transfer_atlas_cat_id_on_merge(source, target) - Handle merges'
\echo '  - get_cat_microchip_status(cat_id) - Check chip status'
\echo ''
\echo 'Trigger:'
\echo '  - trg_appointment_atlas_cat_id: Auto-generates on clinic_day_number'
\echo ''
\echo 'View:'
\echo '  - v_cats_with_atlas_id: Beacon verified cat population'
\echo ''
\echo 'ID Format: MMDDYYYY##-[****]'
\echo '  Example chipped: 0115202607-4012 (microchip ...4012)'
\echo '  Example unchipped: 0115202607-A3F7 (hash)'
\echo ''
\echo 'Backfill completed for existing cats with clinic_day_number.'
\echo ''
