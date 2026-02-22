-- MIG_2430: Remove Clinic Fallback in Cat-Place Linking
--
-- Problem: link_cats_to_appointment_places() uses COALESCE(inferred_place_id, place_id)
--          which falls back to clinic address when owner's inferred place is NULL.
--          This pollutes cat-place data with incorrect clinic links.
--
-- Solution: Only link cats when inferred_place_id IS NOT NULL and is a valid
--           residential address (not clinic/blacklisted).
--
-- @see DATA_GAP_040
-- @see docs/ENTITY_LINKING_FORTIFICATION_PLAN.md
--
-- Created: 2026-02-21

\echo ''
\echo '=============================================='
\echo '  MIG_2430: Remove Clinic Fallback'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE SKIPPED ENTITIES TABLE
-- ============================================================================

\echo '1. Creating ops.entity_linking_skipped table...'

CREATE TABLE IF NOT EXISTS ops.entity_linking_skipped (
    id SERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, entity_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_entity_linking_skipped_type
    ON ops.entity_linking_skipped(entity_type, reason);

COMMENT ON TABLE ops.entity_linking_skipped IS
'Tracks entities that could not be linked during entity linking pipeline.
Used for monitoring and debugging. Populated by link_cats_to_appointment_places().';

\echo '   Created ops.entity_linking_skipped'

-- ============================================================================
-- 2. FIX link_cats_to_appointment_places() - REMOVE COALESCE FALLBACK
-- ============================================================================

\echo ''
\echo '2. Fixing sot.link_cats_to_appointment_places()...'

CREATE OR REPLACE FUNCTION sot.link_cats_to_appointment_places()
RETURNS TABLE(cats_linked INTEGER, cats_skipped INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
    v_linked INT := 0;
    v_skipped INT := 0;
    v_result UUID;
    v_cat_id UUID;
    v_place_id UUID;
BEGIN
    -- Link cats to places using the pre-computed inferred_place_id from appointments.
    --
    -- CRITICAL FIX (MIG_2430): Removed COALESCE fallback to place_id (clinic).
    -- Now ONLY links when inferred_place_id is NOT NULL and points to a
    -- residential address (not clinic/blacklisted).
    --
    -- This prevents cats from being incorrectly linked to clinic addresses
    -- (845 Todd, 1814/1820 Empire Industrial) when owner address is unknown.

    FOR v_cat_id, v_place_id IN
        SELECT DISTINCT ON (a.cat_id)
            a.cat_id,
            a.inferred_place_id
        FROM ops.appointments a
        JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
        JOIN sot.places p ON p.place_id = a.inferred_place_id
            AND p.merged_into_place_id IS NULL
        WHERE a.cat_id IS NOT NULL
          AND a.inferred_place_id IS NOT NULL  -- NO FALLBACK - must have real address
          -- Exclude clinics and blacklisted places
          AND sot.should_compute_disease_for_place(a.inferred_place_id)
          AND NOT EXISTS (
              SELECT 1 FROM sot.cat_place cp
              WHERE cp.cat_id = a.cat_id AND cp.place_id = a.inferred_place_id
          )
        ORDER BY a.cat_id, a.appointment_date DESC  -- most recent appointment wins
    LOOP
        v_result := sot.link_cat_to_place(
            p_cat_id := v_cat_id,
            p_place_id := v_place_id,
            p_relationship_type := 'home',  -- MIG_2305 fix: use 'home' not 'appointment_site'
            p_evidence_type := 'appointment',
            p_source_system := 'entity_linking',
            p_source_table := 'link_cats_to_appointment_places',
            p_confidence := 'high'
        );
        IF v_result IS NOT NULL THEN
            v_linked := v_linked + 1;
        END IF;
    END LOOP;

    -- Log cats that couldn't be linked (for monitoring)
    INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
    SELECT 'cat', a.cat_id,
           CASE
               WHEN a.inferred_place_id IS NULL THEN 'no_inferred_place_id'
               WHEN NOT sot.should_compute_disease_for_place(a.inferred_place_id) THEN 'place_is_clinic_or_blacklisted'
               ELSE 'unknown'
           END,
           NOW()
    FROM ops.appointments a
    JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
    WHERE a.cat_id IS NOT NULL
      AND (
          a.inferred_place_id IS NULL
          OR NOT sot.should_compute_disease_for_place(a.inferred_place_id)
      )
      AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = a.cat_id)
    ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;

    GET DIAGNOSTICS v_skipped = ROW_COUNT;

    cats_linked := v_linked;
    cats_skipped := v_skipped;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION sot.link_cats_to_appointment_places IS
'V2/MIG_2430: Links cats to places using appointment inferred_place_id.
CRITICAL: Does NOT fallback to place_id (clinic) when inferred_place_id is NULL.
Only links to valid residential addresses, not clinics or blacklisted places.
Logs skipped cats to ops.entity_linking_skipped for monitoring.
See DATA_GAP_040.';

\echo '   Fixed sot.link_cats_to_appointment_places()'

-- ============================================================================
-- 3. CLEAN UP EXISTING CLINIC POLLUTION
-- ============================================================================

\echo ''
\echo '3. Archiving existing clinic-linked cats...'

-- Create archive table for audit trail
CREATE TABLE IF NOT EXISTS ops.archived_clinic_cat_place (
    id SERIAL PRIMARY KEY,
    original_id UUID,
    cat_id UUID NOT NULL,
    place_id UUID NOT NULL,
    relationship_type TEXT,
    confidence NUMERIC,
    evidence_type TEXT,
    source_system TEXT,
    source_table TEXT,
    created_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ DEFAULT NOW(),
    archive_reason TEXT DEFAULT 'MIG_2430_clinic_fallback_cleanup'
);

-- Archive existing clinic-linked cats
INSERT INTO ops.archived_clinic_cat_place (
    original_id, cat_id, place_id, relationship_type, confidence,
    evidence_type, source_system, source_table, created_at
)
SELECT
    cp.id, cp.cat_id, cp.place_id, cp.relationship_type, cp.confidence,
    cp.evidence_type, cp.source_system, cp.source_table, cp.created_at
FROM sot.cat_place cp
JOIN sot.places p ON p.place_id = cp.place_id
WHERE (
    p.place_kind = 'clinic'
    OR p.formatted_address ILIKE '%1814%Empire Industrial%'
    OR p.formatted_address ILIKE '%1820%Empire Industrial%'
    OR p.formatted_address ILIKE '%845 Todd%'
)
AND cp.source_table = 'link_cats_to_appointment_places';

-- Delete the polluted links
DELETE FROM sot.cat_place cp
USING sot.places p
WHERE cp.place_id = p.place_id
AND (
    p.place_kind = 'clinic'
    OR p.formatted_address ILIKE '%1814%Empire Industrial%'
    OR p.formatted_address ILIKE '%1820%Empire Industrial%'
    OR p.formatted_address ILIKE '%845 Todd%'
)
AND cp.source_table = 'link_cats_to_appointment_places';

\echo '   Archived and cleaned clinic-linked cats'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Clinic-linked cats remaining (should be 0):'
SELECT COUNT(*) as clinic_cat_links
FROM sot.cat_place cp
JOIN sot.places p ON p.place_id = cp.place_id
WHERE (
    p.place_kind = 'clinic'
    OR p.formatted_address ILIKE '%1814%Empire Industrial%'
    OR p.formatted_address ILIKE '%1820%Empire Industrial%'
    OR p.formatted_address ILIKE '%845 Todd%'
);

\echo ''
\echo 'Archived clinic links:'
SELECT COUNT(*) as archived_links FROM ops.archived_clinic_cat_place;

\echo ''
\echo 'Skipped entities by reason:'
SELECT entity_type, reason, COUNT(*) as count
FROM ops.entity_linking_skipped
GROUP BY entity_type, reason
ORDER BY count DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_2430 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Removed COALESCE fallback to clinic in link_cats_to_appointment_places()'
\echo '  - Now only links when inferred_place_id exists AND is not clinic/blacklisted'
\echo '  - Logs skipped cats to ops.entity_linking_skipped'
\echo '  - Archived and deleted existing clinic pollution'
\echo ''
