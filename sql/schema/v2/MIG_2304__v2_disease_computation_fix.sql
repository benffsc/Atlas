-- MIG_2304: V2-Compliant Disease Computation Fix
-- Date: 2026-02-14
--
-- ROOT CAUSE: V1 pattern violations in disease computation:
--   1. NO GATED CREATION - computed disease for ALL places including clinic/shelter
--   2. SOURCE AUTHORITY VIOLATED - ClinicHQ is medical authority, but disease ecology
--      belongs on RESIDENTIAL locations (ShelterLuv authority for cat location)
--   3. CAT-PLACE UNBOUNDED - used ALL cat_place relationships, not just residential
--   4. NO PLACE SOFT BLACKLIST - only had email/phone blacklist
--
-- V2 FIX:
--   1. Create place soft blacklist for FFSC clinic/office addresses
--   2. Create gated check: should_compute_disease_for_place()
--   3. Filter by relationship_type: only 'home', 'residence', 'colony_member'
--   4. Quarantine (don't delete) incorrect disease status records
--
-- V2 INVARIANT: Disease status is ECOLOGICAL data about WHERE CATS LIVE,
--               NOT about where cats were TESTED or TREATED.

\echo ''
\echo '=============================================='
\echo '  MIG_2304: V2-Compliant Disease Computation'
\echo '=============================================='
\echo ''
\echo 'Following V2 Architecture Principles:'
\echo '  - GATED CREATION: Check before creating disease status'
\echo '  - SOURCE AUTHORITY: Residential locations only'
\echo '  - BOUNDED LINKING: Filter by relationship_type'
\echo '  - QUARANTINE: Move bad records, never delete'
\echo ''

-- ============================================================================
-- 1. PLACE SOFT BLACKLIST TABLE
-- ============================================================================

\echo '1. Creating place soft blacklist table...'

CREATE TABLE IF NOT EXISTS sot.place_soft_blacklist (
    blacklist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id UUID REFERENCES sot.places(place_id),
    address_pattern TEXT,  -- For pattern matching (e.g., '%Empire Industrial%')
    reason TEXT NOT NULL,
    blacklist_type TEXT NOT NULL DEFAULT 'disease_computation'
        CHECK (blacklist_type IN ('disease_computation', 'cat_linking', 'all')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_place_soft_blacklist_place
    ON sot.place_soft_blacklist(place_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_place_soft_blacklist_pattern
    ON sot.place_soft_blacklist(address_pattern) WHERE is_active = TRUE AND address_pattern IS NOT NULL;

COMMENT ON TABLE sot.place_soft_blacklist IS
'V2 Soft Blacklist for Places.
Places in this list are EXCLUDED from certain computations:
  - disease_computation: Disease status not computed for these places
  - cat_linking: Cats not linked to these places
  - all: Both of the above

Use cases:
  - FFSC clinic/office addresses (cats treated there, dont live there)
  - Shelter intake locations
  - Foster hub addresses (high volume, not residential)
  - Staff addresses (INV-12 staff exclusion)';

\echo '   Created sot.place_soft_blacklist'

-- ============================================================================
-- 2. SEED FFSC CLINIC/OFFICE ADDRESSES
-- ============================================================================

\echo ''
\echo '2. Seeding FFSC clinic/office addresses...'

-- First, find the place_ids for FFSC locations
DO $$
DECLARE
    v_1814_id UUID;
    v_1820_id UUID;
BEGIN
    -- Find 1814 Empire Industrial (Clinic/Foster Hub)
    SELECT place_id INTO v_1814_id
    FROM sot.places
    WHERE (formatted_address ILIKE '%1814%Empire Industrial%'
           OR display_name ILIKE '%1814%Empire Industrial%')
      AND merged_into_place_id IS NULL
    LIMIT 1;

    -- Find 1820 Empire Industrial (Main Office)
    SELECT place_id INTO v_1820_id
    FROM sot.places
    WHERE (formatted_address ILIKE '%1820%Empire Industrial%'
           OR display_name ILIKE '%1820%Empire Industrial%')
      AND merged_into_place_id IS NULL
    LIMIT 1;

    -- Insert 1814 if found
    IF v_1814_id IS NOT NULL THEN
        INSERT INTO sot.place_soft_blacklist (place_id, address_pattern, reason, blacklist_type, created_by)
        VALUES (
            v_1814_id,
            '%1814%Empire Industrial%',
            'FFSC Clinic/Foster Hub - cats are TREATED here, not RESIDENT. Disease status should be on home locations.',
            'disease_computation',
            'MIG_2304'
        )
        ON CONFLICT DO NOTHING;
        RAISE NOTICE 'Added 1814 Empire Industrial to place blacklist (place_id: %)', v_1814_id;
    ELSE
        -- Insert pattern-based entry
        INSERT INTO sot.place_soft_blacklist (place_id, address_pattern, reason, blacklist_type, created_by)
        VALUES (
            NULL,
            '%1814%Empire Industrial%',
            'FFSC Clinic/Foster Hub - cats are TREATED here, not RESIDENT',
            'disease_computation',
            'MIG_2304'
        )
        ON CONFLICT DO NOTHING;
        RAISE NOTICE 'Added 1814 Empire Industrial pattern to blacklist (place not found)';
    END IF;

    -- Insert 1820 if found
    IF v_1820_id IS NOT NULL THEN
        INSERT INTO sot.place_soft_blacklist (place_id, address_pattern, reason, blacklist_type, created_by)
        VALUES (
            v_1820_id,
            '%1820%Empire Industrial%',
            'FFSC Main Office - administrative location, not residential',
            'disease_computation',
            'MIG_2304'
        )
        ON CONFLICT DO NOTHING;
        RAISE NOTICE 'Added 1820 Empire Industrial to place blacklist (place_id: %)', v_1820_id;
    ELSE
        INSERT INTO sot.place_soft_blacklist (place_id, address_pattern, reason, blacklist_type, created_by)
        VALUES (
            NULL,
            '%1820%Empire Industrial%',
            'FFSC Main Office - administrative location, not residential',
            'disease_computation',
            'MIG_2304'
        )
        ON CONFLICT DO NOTHING;
        RAISE NOTICE 'Added 1820 Empire Industrial pattern to blacklist (place not found)';
    END IF;
END $$;

\echo '   Seeded FFSC clinic/office addresses'

-- ============================================================================
-- 3. GATED CHECK: should_compute_disease_for_place()
-- ============================================================================

\echo ''
\echo '3. Creating gated check function...'

CREATE OR REPLACE FUNCTION sot.should_compute_disease_for_place(p_place_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_place RECORD;
    v_is_blacklisted BOOLEAN := FALSE;
BEGIN
    -- Get place info
    SELECT place_id, place_kind, formatted_address, display_name
    INTO v_place
    FROM sot.places
    WHERE place_id = p_place_id
      AND merged_into_place_id IS NULL;

    IF v_place IS NULL THEN
        RETURN FALSE;  -- Place doesn't exist or is merged
    END IF;

    -- Check 1: Explicit place_id blacklist
    IF EXISTS (
        SELECT 1 FROM sot.place_soft_blacklist
        WHERE place_id = p_place_id
          AND is_active = TRUE
          AND blacklist_type IN ('disease_computation', 'all')
    ) THEN
        RETURN FALSE;
    END IF;

    -- Check 2: Pattern-based blacklist
    IF EXISTS (
        SELECT 1 FROM sot.place_soft_blacklist
        WHERE address_pattern IS NOT NULL
          AND is_active = TRUE
          AND blacklist_type IN ('disease_computation', 'all')
          AND (v_place.formatted_address ILIKE address_pattern
               OR v_place.display_name ILIKE address_pattern)
    ) THEN
        RETURN FALSE;
    END IF;

    -- Check 3: place_kind exclusion (clinics, shelters)
    IF v_place.place_kind IN ('clinic', 'shelter', 'office', 'veterinary') THEN
        RETURN FALSE;
    END IF;

    -- Check 4: place_contexts exclusion
    IF EXISTS (
        SELECT 1 FROM sot.place_contexts pc
        WHERE pc.place_id = p_place_id
          AND pc.context_type IN ('clinic', 'shelter', 'ffsc_office', 'veterinary_clinic')
          AND pc.valid_to IS NULL
    ) THEN
        RETURN FALSE;
    END IF;

    -- All checks passed
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.should_compute_disease_for_place(UUID) IS
'V2 GATED CHECK: Determines if disease status should be computed for a place.
Returns FALSE for:
  - Places in sot.place_soft_blacklist (FFSC clinic, office)
  - Places with place_kind IN (clinic, shelter, office, veterinary)
  - Places with context_type IN (clinic, shelter, ffsc_office)

V2 Principle: Disease is ECOLOGICAL data about WHERE CATS LIVE,
not about where cats were tested/treated.';

\echo '   Created sot.should_compute_disease_for_place()'

-- ============================================================================
-- 4. RELATIONSHIP TYPE CONSTANTS
-- ============================================================================

\echo ''
\echo '4. Defining residential relationship types...'

-- Relationship types that indicate cat LIVES at location (for disease computation)
-- These are the ONLY types that should contribute to place disease status
CREATE OR REPLACE FUNCTION sot.get_residential_relationship_types()
RETURNS TEXT[] AS $$
BEGIN
    RETURN ARRAY[
        'home',           -- Primary residence
        'residence',      -- General residence
        'colony_member',  -- Feral colony location
        'caretaker',      -- Caretaker's location (cat lives there)
        'owner',          -- Owner's location
        'adopter'         -- Adopter's location (post-adoption home)
    ];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Relationship types that indicate cat was PROCESSED at location (NOT for disease)
-- These should be EXCLUDED from disease computation
CREATE OR REPLACE FUNCTION sot.get_transient_relationship_types()
RETURNS TEXT[] AS $$
BEGIN
    RETURN ARRAY[
        'treated_at',     -- Clinic treatment location
        'trapped_at',     -- Trapping location (may differ from colony)
        'found_at',       -- Discovery location
        'surrendered_at', -- Surrender location
        'intake',         -- Shelter intake
        'foster',         -- Foster home (temporary, not permanent residence)
        'temporary'       -- Any temporary placement
    ];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION sot.get_residential_relationship_types() IS
'V2 SOURCE AUTHORITY: Returns relationship types indicating cat LIVES at location.
Only these types should contribute to place disease status.
Disease is ecological data about residential locations.';

COMMENT ON FUNCTION sot.get_transient_relationship_types() IS
'V2 SOURCE AUTHORITY: Returns relationship types indicating cat was PROCESSED at location.
These should be EXCLUDED from disease computation.
Clinics, shelters, and trapping sites are NOT disease ecology sites.';

\echo '   Created relationship type functions'

-- ============================================================================
-- 5. QUARANTINE TABLE FOR BAD DISEASE STATUS
-- ============================================================================

\echo ''
\echo '5. Creating quarantine table for incorrect disease status...'

CREATE TABLE IF NOT EXISTS quarantine.place_disease_status_invalid (
    quarantine_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Original record data
    original_status_id UUID,
    place_id UUID,
    disease_type_key TEXT,
    status TEXT,
    evidence_source TEXT,
    first_positive_date DATE,
    last_positive_date DATE,
    positive_cat_count INT,
    total_tested_count INT,
    notes TEXT,
    set_by TEXT,
    set_at TIMESTAMPTZ,
    original_created_at TIMESTAMPTZ,
    -- Quarantine metadata
    quarantine_reason TEXT NOT NULL,
    quarantined_at TIMESTAMPTZ DEFAULT NOW(),
    quarantined_by TEXT DEFAULT 'MIG_2304',
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    resolution TEXT  -- 'deleted', 'restored', 'corrected'
);

COMMENT ON TABLE quarantine.place_disease_status_invalid IS
'V2 QUARANTINE: Disease status records that violated V2 rules.
These records were computed for clinic/shelter locations instead of residential.
Review and resolve - never hard delete from source.';

\echo '   Created quarantine.place_disease_status_invalid'

-- ============================================================================
-- 6. QUARANTINE EXISTING BAD RECORDS
-- ============================================================================

\echo ''
\echo '6. Quarantining incorrect disease status records...'

-- Move records for blacklisted places to quarantine
WITH quarantined AS (
    INSERT INTO quarantine.place_disease_status_invalid (
        original_status_id,
        place_id,
        disease_type_key,
        status,
        evidence_source,
        first_positive_date,
        last_positive_date,
        positive_cat_count,
        total_tested_count,
        notes,
        set_by,
        set_at,
        original_created_at,
        quarantine_reason
    )
    SELECT
        pds.status_id,
        pds.place_id,
        pds.disease_type_key,
        pds.status,
        pds.evidence_source,
        pds.first_positive_date,
        pds.last_positive_date,
        pds.positive_cat_count,
        pds.total_tested_count,
        pds.notes,
        pds.set_by,
        pds.set_at,
        pds.created_at,
        'V1 violation: Disease computed for clinic/office address instead of residential location. Place is in soft blacklist or has clinic/office place_kind.'
    FROM ops.place_disease_status pds
    WHERE NOT sot.should_compute_disease_for_place(pds.place_id)
    RETURNING place_id
)
SELECT COUNT(*) as quarantined_count FROM quarantined;

-- Delete from source (after quarantine)
DELETE FROM ops.place_disease_status pds
WHERE NOT sot.should_compute_disease_for_place(pds.place_id);

\echo '   Quarantined and removed invalid disease status records'

-- ============================================================================
-- 7. UPDATE DISEASE COMPUTATION FUNCTION (V2 COMPLIANT)
-- ============================================================================

\echo ''
\echo '7. Updating ops.compute_place_disease_status() to be V2 compliant...'

CREATE OR REPLACE FUNCTION ops.compute_place_disease_status(p_place_id UUID DEFAULT NULL)
RETURNS TABLE(
    out_place_id UUID,
    diseases_updated INT
) AS $$
DECLARE
    v_place_rec RECORD;
    v_disease_rec RECORD;
    v_updated INT := 0;
    v_total_updated INT := 0;
    v_residential_types TEXT[];
BEGIN
    -- V2: Get residential relationship types
    v_residential_types := sot.get_residential_relationship_types();

    -- ========================================================================
    -- Iterate through places (with V2 GATED CHECK)
    -- ========================================================================
    FOR v_place_rec IN
        SELECT p.place_id
        FROM sot.places p
        WHERE p.merged_into_place_id IS NULL
          AND (p_place_id IS NULL OR p.place_id = p_place_id)
          -- V2 GATED CHECK: Skip clinic/shelter/blacklisted places
          AND sot.should_compute_disease_for_place(p.place_id)
    LOOP
        v_updated := 0;

        -- ====================================================================
        -- Aggregate test results for RESIDENT cats at this place
        -- V2: Only use residential relationship types
        -- ====================================================================
        FOR v_disease_rec IN
            WITH place_cats AS (
                -- V2 BOUNDED LINKING: Only residential relationships
                SELECT DISTINCT cp.cat_id
                FROM sot.cat_place cp
                JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
                WHERE cp.place_id = v_place_rec.place_id
                  AND cp.relationship_type = ANY(v_residential_types)  -- V2 FIX
            ),
            place_test_results AS (
                -- Get test results for those cats
                SELECT
                    tr.test_type,
                    tr.result,
                    tr.test_date,
                    tr.cat_id
                FROM ops.cat_test_results tr
                JOIN place_cats pc ON pc.cat_id = tr.cat_id
            ),
            disease_summary AS (
                -- Aggregate by disease type
                SELECT
                    CASE
                        WHEN test_type IN ('felv', 'felv_fiv_combo') THEN 'felv'
                        WHEN test_type = 'fiv' THEN 'fiv'
                        WHEN test_type = 'felv_fiv_combo' THEN 'fiv'
                        ELSE test_type
                    END as disease_key,
                    COUNT(*) FILTER (WHERE result = 'positive') as positive_count,
                    COUNT(*) as total_tested,
                    MIN(test_date) FILTER (WHERE result = 'positive') as first_positive,
                    MAX(test_date) FILTER (WHERE result = 'positive') as last_positive
                FROM place_test_results
                GROUP BY 1
            )
            SELECT
                ds.disease_key,
                ds.positive_count,
                ds.total_tested,
                ds.first_positive,
                ds.last_positive,
                dt.decay_window_months
            FROM disease_summary ds
            JOIN ops.disease_types dt ON dt.disease_key = ds.disease_key
            WHERE ds.positive_count > 0
        LOOP
            -- Compute status based on decay window
            INSERT INTO ops.place_disease_status (
                place_id,
                disease_type_key,
                status,
                evidence_source,
                first_positive_date,
                last_positive_date,
                positive_cat_count,
                total_tested_count,
                set_at
            )
            VALUES (
                v_place_rec.place_id,
                v_disease_rec.disease_key,
                CASE
                    WHEN v_disease_rec.last_positive >= CURRENT_DATE - (v_disease_rec.decay_window_months * INTERVAL '1 month')
                    THEN 'confirmed_active'
                    ELSE 'historical'
                END,
                'computed',
                v_disease_rec.first_positive,
                v_disease_rec.last_positive,
                v_disease_rec.positive_count,
                v_disease_rec.total_tested,
                NOW()
            )
            ON CONFLICT (place_id, disease_type_key)
            DO UPDATE SET
                -- Don't overwrite manual overrides
                status = CASE
                    WHEN ops.place_disease_status.evidence_source IN ('manual')
                         AND ops.place_disease_status.status IN ('perpetual', 'false_flag', 'cleared')
                    THEN ops.place_disease_status.status
                    WHEN EXCLUDED.last_positive_date >= CURRENT_DATE - (v_disease_rec.decay_window_months * INTERVAL '1 month')
                    THEN 'confirmed_active'
                    ELSE 'historical'
                END,
                last_positive_date = GREATEST(ops.place_disease_status.last_positive_date, EXCLUDED.last_positive_date),
                first_positive_date = LEAST(ops.place_disease_status.first_positive_date, EXCLUDED.first_positive_date),
                positive_cat_count = EXCLUDED.positive_cat_count,
                total_tested_count = EXCLUDED.total_tested_count,
                updated_at = NOW();

            v_updated := v_updated + 1;
        END LOOP;

        IF v_updated > 0 THEN
            v_total_updated := v_total_updated + v_updated;
            out_place_id := v_place_rec.place_id;
            diseases_updated := v_updated;
            RETURN NEXT;
        END IF;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.compute_place_disease_status(UUID) IS
'V2 COMPLIANT: Compute place disease status from cat test results.

V2 INVARIANTS ENFORCED:
1. GATED CHECK: Calls should_compute_disease_for_place() - skips clinic/shelter/blacklisted
2. SOURCE AUTHORITY: Only uses residential relationship types (home, residence, colony_member)
3. BOUNDED LINKING: Filters cat_place by relationship_type
4. Manual overrides preserved (perpetual, false_flag, cleared)

Disease is ECOLOGICAL data about WHERE CATS LIVE, not where they were tested.';

\echo '   Updated ops.compute_place_disease_status() - now V2 compliant'

-- ============================================================================
-- 8. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Place soft blacklist entries:'
SELECT
    COALESCE(p.display_name, psb.address_pattern) as place_or_pattern,
    psb.reason,
    psb.blacklist_type
FROM sot.place_soft_blacklist psb
LEFT JOIN sot.places p ON p.place_id = psb.place_id
WHERE psb.is_active = TRUE;

\echo ''
\echo 'Quarantined disease status records:'
SELECT
    COUNT(*) as quarantined_count,
    disease_type_key,
    quarantine_reason
FROM quarantine.place_disease_status_invalid
GROUP BY disease_type_key, quarantine_reason;

\echo ''
\echo 'Remaining disease status (should only be residential locations):'
SELECT
    p.display_name,
    p.place_kind,
    pds.disease_type_key,
    pds.status,
    pds.positive_cat_count
FROM ops.place_disease_status pds
JOIN sot.places p ON p.place_id = pds.place_id
ORDER BY pds.positive_cat_count DESC
LIMIT 10;

\echo ''
\echo 'FFSC clinic check (should return 0):'
SELECT COUNT(*) as ffsc_clinic_disease_records
FROM ops.place_disease_status pds
JOIN sot.places p ON p.place_id = pds.place_id
WHERE p.formatted_address ILIKE '%Empire Industrial%'
   OR p.display_name ILIKE '%Empire Industrial%';

\echo ''
\echo '=============================================='
\echo '  MIG_2304 Complete!'
\echo '=============================================='
\echo ''
\echo 'V2 Principles Implemented:'
\echo '  1. GATED CREATION: should_compute_disease_for_place() checks before computing'
\echo '  2. SOURCE AUTHORITY: Only residential relationship types used'
\echo '  3. SOFT BLACKLIST: sot.place_soft_blacklist for clinic/office addresses'
\echo '  4. QUARANTINE: Invalid records moved to quarantine.place_disease_status_invalid'
\echo ''
\echo 'New Invariant:'
\echo '  Disease status is ECOLOGICAL data about WHERE CATS LIVE,'
\echo '  not about where cats were TESTED or TREATED.'
\echo ''
