-- MIG_2855: Expand FFSC Classification + Entity Linking Skip Logging
--
-- Fixes:
--   FFS-266: External rescues/shelters using FFSC clinic (Marin Humane, Twenty Tails, etc.)
--   FFS-264: ~3,237 entity_linking_skipped entries logged under generic reasons instead of 'ffsc_program_cat'
--   Bug: classify_ffsc_booking() regex misses "[Location] Forgotten Felines Of Sonoma County" — 444 cats
--
-- Changes:
--   1a. Expand ops.classify_ffsc_booking() — new patterns for rescue_transfer, shelter_transfer, trapping sites
--   1b. Re-backfill ops.appointments.ffsc_program
--   1c. Update sot.link_cats_to_appointment_places() skip logging — FFSC-only cats get 'ffsc_program_cat' reason
--   1d. Update sot.link_cats_to_places() skip logging — same FFSC check
--   1e. Clean up stale entity_linking_skipped entries
--   1f. Update ops.v_ffsc_trapping_sites view — strip "Forgotten Felines Of Sonoma County"

BEGIN;

-- =============================================================================
-- 1a. Expand ops.classify_ffsc_booking()
-- =============================================================================
-- Order matters: specific patterns before generic.
-- ClinicHQ concatenates first+last name, so org names often appear doubled
-- (e.g., "Twenty Tails Rescue Twenty Tails Rescue"). Use LIKE partial matching, NOT ^ anchoring.

CREATE OR REPLACE FUNCTION ops.classify_ffsc_booking(p_client_name TEXT)
RETURNS TEXT AS $$
DECLARE
    v_name TEXT;
BEGIN
    IF p_client_name IS NULL THEN
        RETURN NULL;
    END IF;

    v_name := LOWER(TRIM(p_client_name));

    -- Specific FFSC program types (check first — most specific)
    IF v_name LIKE '%forgotten felines foster%' THEN
        RETURN 'ffsc_foster';
    END IF;

    IF v_name LIKE '%forgotten felines office%' THEN
        RETURN 'ffsc_office';
    END IF;

    IF v_name LIKE '%forgotten felines colony%' THEN
        RETURN 'ffsc_colony';
    END IF;

    -- Bug fix: catch "[Location] Forgotten Felines Of Sonoma County" before generic FFSC pattern
    -- 444 cats, 102 client_name variants were missed by the trailing regex
    IF v_name LIKE '%forgotten felines of sonoma county%' THEN
        RETURN 'ffsc_trapping_site';
    END IF;

    -- Municipal shelter transfers (SCAS = Sonoma County Animal Services, RPAS = Rohnert Park Animal Shelter)
    IF v_name ~ '^(scas|rpas)\b' THEN
        RETURN 'shelter_transfer';
    END IF;

    -- Additional municipal shelter transfers
    IF v_name LIKE '%northbay animal services%'
       OR v_name LIKE '%sc animal services%'
       OR v_name LIKE '%sonoma county animal services%' THEN
        RETURN 'shelter_transfer';
    END IF;

    -- External rescue/shelter transfers (FFS-266)
    -- These orgs use FFSC clinic for spay/neuter but are NOT FFSC programs
    IF v_name LIKE '%humane society for inland mendocino%'
       OR v_name LIKE '%twenty tails rescue%'
       OR v_name LIKE '%bitten by a kitten%'
       OR v_name LIKE '%marin humane%'
       OR v_name LIKE '%cat rescue of cloverdale%'
       OR v_name LIKE '%dogwood animal rescue%'
       OR v_name LIKE '%countryside rescue%'
       OR v_name LIKE '%esther pruitt feline rescue%'
       OR v_name LIKE '%sonoma county wildlife rescue%'
       OR v_name LIKE '%little paws kitten rescue%' THEN
        RETURN 'rescue_transfer';
    END IF;

    -- Fire rescue cats
    IF v_name LIKE 'fire cat%' THEN
        RETURN 'fire_rescue';
    END IF;

    -- Rebooking placeholders
    IF v_name LIKE '%rebooking placeholder%' OR v_name LIKE '%rebook%' THEN
        RETURN 'placeholder';
    END IF;

    -- Named trapping sites (known locations)
    IF v_name LIKE '%sonoma county landfill%' OR v_name LIKE '%sonoma county fairgrounds%' THEN
        RETURN 'ffsc_trapping_site';
    END IF;

    -- Generic FFSC trapping sites (e.g., "West School Street Ffsc", "Silveira Ranch Forgotten Felines")
    IF v_name ~ '\s(ffsc|forgotten felines)\s*$' THEN
        RETURN 'ffsc_trapping_site';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION ops.classify_ffsc_booking(TEXT) IS
'MIG_2855: Classifies ClinicHQ bookings as FFSC program bookings.
Returns NULL if not a program booking.
Categories: ffsc_foster, ffsc_office, ffsc_colony, ffsc_trapping_site,
shelter_transfer, rescue_transfer, fire_rescue, placeholder.
FFS-266: Added rescue_transfer for external rescues using FFSC clinic.
Bug fix: Added "Forgotten Felines Of Sonoma County" catch (444 cats).';

-- =============================================================================
-- 1b. Re-backfill appointments with expanded classification
-- =============================================================================

UPDATE ops.appointments
SET ffsc_program = ops.classify_ffsc_booking(client_name)
WHERE client_name IS NOT NULL
  AND ops.classify_ffsc_booking(client_name) IS NOT NULL
  AND (ffsc_program IS NULL OR ffsc_program != ops.classify_ffsc_booking(client_name));

-- =============================================================================
-- 1c. Update sot.link_cats_to_appointment_places() — add FFSC skip reason
-- =============================================================================
-- Only the skip-logging INSERT changes. The linking FOR loop is NOT modified.

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
            p_relationship_type := 'home',
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
    -- MIG_2855 / FFS-264: FFSC-only cats get specific 'ffsc_program_cat' reason
    INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
    SELECT 'cat', a.cat_id,
           CASE
               -- FFS-264: FFSC-only cats (all appointments are FFSC program bookings)
               WHEN NOT EXISTS (
                   SELECT 1 FROM ops.appointments a2
                   WHERE a2.cat_id = a.cat_id AND a2.ffsc_program IS NULL
               ) AND EXISTS (
                   SELECT 1 FROM ops.appointments a3
                   WHERE a3.cat_id = a.cat_id AND a3.ffsc_program IS NOT NULL
               ) THEN 'ffsc_program_cat'
               -- Original reasons unchanged
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

COMMENT ON FUNCTION sot.link_cats_to_appointment_places() IS
'MIG_2855: Links cats to places via appointment inferred_place_id.
No COALESCE fallback to clinic (MIG_2430).
FFS-264: FFSC-only cats logged as ffsc_program_cat instead of generic reasons.';

-- =============================================================================
-- 1d. Update sot.link_cats_to_places() — add FFSC skip reason
-- =============================================================================
-- Only the skip-logging INSERT changes. The linking FOR loop is NOT modified.

CREATE OR REPLACE FUNCTION sot.link_cats_to_places()
RETURNS TABLE(cats_linked_home INTEGER, cats_linked_appointment INTEGER, cats_skipped INTEGER, total_edges INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
    v_total INT := 0;
    v_skipped INT := 0;
    v_cat_id UUID;
    v_place_id UUID;
    v_pcr_type TEXT;
    v_cpr_type TEXT;
    v_confidence TEXT;
    v_evidence_type TEXT;
    v_result UUID;
BEGIN
    -- Link cats to places via person_cat → person_place chain.
    -- Maps person_cat relationship types to cat_place relationship types.
    --
    -- MIG_889 FIX: Uses LIMIT 1 per person (highest confidence, most recent)
    -- MIG_2433 FIX: Logs skipped cats, excludes clinic/blacklisted places
    -- MIG_2601 FIX: Added place_kind filter to exclude business/clinic/outdoor_site

    FOR v_cat_id, v_place_id, v_pcr_type IN
        SELECT DISTINCT
            pc.cat_id,
            best_place.place_id,
            pc.relationship_type
        FROM sot.person_cat pc
        JOIN sot.people sp ON sp.person_id = pc.person_id
            AND sp.merged_into_person_id IS NULL
        -- MIG_889: LATERAL join to get ONLY the best place per person
        JOIN LATERAL (
            SELECT pp.place_id
            FROM sot.person_place pp
            JOIN sot.places pl ON pl.place_id = pp.place_id
                AND pl.merged_into_place_id IS NULL
            WHERE pp.person_id = pc.person_id
              AND pp.relationship_type IN ('resident', 'owner', 'requester')
              -- MIG_2433: Exclude clinic/blacklisted places
              AND sot.should_compute_disease_for_place(pp.place_id)
              -- MIG_2601 FIX: Exclude non-residential place_kinds
              AND (
                  pl.place_kind IS NULL
                  OR pl.place_kind NOT IN ('business', 'clinic', 'outdoor_site', 'neighborhood', 'shelter')
              )
            ORDER BY pp.confidence DESC NULLS LAST, pp.created_at DESC
            LIMIT 1
        ) best_place ON TRUE
        JOIN sot.cats sc ON sc.cat_id = pc.cat_id
            AND sc.merged_into_cat_id IS NULL
        WHERE pc.relationship_type IN ('owner', 'caretaker', 'foster', 'adopter', 'colony_caretaker')
        -- INV-12: exclude staff/trappers
        AND NOT EXISTS (
            SELECT 1 FROM sot.person_roles pr
            WHERE pr.person_id = pc.person_id
              AND pr.role_status = 'active'
              AND (pr.role = 'staff' OR pr.role = 'trapper')
        )
        AND NOT EXISTS (
            SELECT 1 FROM sot.cat_place cp
            WHERE cp.cat_id = pc.cat_id
              AND cp.place_id = best_place.place_id
        )
    LOOP
        -- Map person_cat type → cat_place type + confidence
        CASE v_pcr_type
            WHEN 'owner' THEN
                v_cpr_type := 'home';
                v_confidence := 'high';
                v_evidence_type := 'owner_address';
            WHEN 'caretaker' THEN
                v_cpr_type := 'residence';
                v_confidence := 'medium';
                v_evidence_type := 'person_relationship';
            WHEN 'foster' THEN
                v_cpr_type := 'home';
                v_confidence := 'medium';
                v_evidence_type := 'person_relationship';
            WHEN 'adopter' THEN
                v_cpr_type := 'home';
                v_confidence := 'high';
                v_evidence_type := 'person_relationship';
            WHEN 'colony_caretaker' THEN
                v_cpr_type := 'colony_member';
                v_confidence := 'medium';
                v_evidence_type := 'person_relationship';
            ELSE
                CONTINUE;
        END CASE;

        v_result := sot.link_cat_to_place(
            p_cat_id := v_cat_id,
            p_place_id := v_place_id,
            p_relationship_type := v_cpr_type,
            p_evidence_type := v_evidence_type,
            p_source_system := 'entity_linking',
            p_source_table := 'link_cats_to_places',
            p_confidence := v_confidence
        );
        IF v_result IS NOT NULL THEN
            v_total := v_total + 1;
        END IF;
    END LOOP;

    -- MIG_2433 FIX: Log cats that couldn't be linked
    -- MIG_2601 UPDATE: Also captures business/work address cases
    -- MIG_2855 / FFS-264: FFSC-only cats get specific reason
    INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
    SELECT DISTINCT 'cat', pc.cat_id,
           CASE
               -- FFS-264: FFSC-only cats (all appointments are FFSC program bookings)
               WHEN NOT EXISTS (
                   SELECT 1 FROM ops.appointments a2
                   WHERE a2.cat_id = pc.cat_id AND a2.ffsc_program IS NULL
               ) AND EXISTS (
                   SELECT 1 FROM ops.appointments a3
                   WHERE a3.cat_id = pc.cat_id AND a3.ffsc_program IS NOT NULL
               ) THEN 'ffsc_program_cat'
               -- Original reasons unchanged
               WHEN NOT EXISTS (SELECT 1 FROM sot.person_place pp WHERE pp.person_id = pc.person_id)
               THEN 'person_has_no_place'
               WHEN NOT EXISTS (
                   SELECT 1 FROM sot.person_place pp
                   JOIN sot.places pl ON pl.place_id = pp.place_id
                   WHERE pp.person_id = pc.person_id
                   AND sot.should_compute_disease_for_place(pp.place_id)
               )
               THEN 'person_only_has_clinic_or_blacklisted_places'
               WHEN NOT EXISTS (
                   SELECT 1 FROM sot.person_place pp
                   JOIN sot.places pl ON pl.place_id = pp.place_id
                   WHERE pp.person_id = pc.person_id
                   AND (
                       pl.place_kind IS NULL
                       OR pl.place_kind NOT IN ('business', 'clinic', 'outdoor_site', 'neighborhood', 'shelter')
                   )
               )
               THEN 'person_only_has_business_or_nonresidential_places'
               ELSE 'person_chain_no_match'
           END,
           NOW()
    FROM sot.person_cat pc
    JOIN sot.people sp ON sp.person_id = pc.person_id
        AND sp.merged_into_person_id IS NULL
    JOIN sot.cats sc ON sc.cat_id = pc.cat_id
        AND sc.merged_into_cat_id IS NULL
    WHERE pc.relationship_type IN ('owner', 'caretaker', 'foster', 'adopter', 'colony_caretaker')
    -- Exclude staff/trappers
    AND NOT EXISTS (
        SELECT 1 FROM sot.person_roles pr
        WHERE pr.person_id = pc.person_id
          AND pr.role_status = 'active'
          AND (pr.role = 'staff' OR pr.role = 'trapper')
    )
    -- Cat doesn't have any place link yet
    AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = pc.cat_id)
    -- Person has no valid place for linking (MIG_2601 place_kind filter)
    AND NOT EXISTS (
        SELECT 1 FROM sot.person_place pp
        JOIN sot.places pl ON pl.place_id = pp.place_id
            AND pl.merged_into_place_id IS NULL
        WHERE pp.person_id = pc.person_id
          AND pp.relationship_type IN ('resident', 'owner', 'requester')
          AND sot.should_compute_disease_for_place(pp.place_id)
          AND (
              pl.place_kind IS NULL
              OR pl.place_kind NOT IN ('business', 'clinic', 'outdoor_site', 'neighborhood', 'shelter')
          )
    )
    ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;

    GET DIAGNOSTICS v_skipped = ROW_COUNT;

    cats_linked_home := v_total;
    cats_linked_appointment := 0;
    cats_skipped := v_skipped;
    total_edges := v_total;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION sot.link_cats_to_places() IS
'MIG_2855: Links cats to places via person_cat → person_place chain.
LIMIT 1 per person (MIG_889), excludes staff/trappers (INV-12),
excludes clinic/blacklisted (MIG_2433), excludes non-residential place_kinds (MIG_2601).
FFS-264: FFSC-only cats logged as ffsc_program_cat instead of generic reasons.';

-- =============================================================================
-- 1e. Clean up stale entity_linking_skipped entries for FFSC-only cats
-- =============================================================================

-- Delete old generic entries for cats that are FFSC-only
DELETE FROM ops.entity_linking_skipped els
WHERE els.entity_type = 'cat'
  AND els.reason != 'ffsc_program_cat'
  AND NOT EXISTS (SELECT 1 FROM ops.appointments a WHERE a.cat_id = els.entity_id AND a.ffsc_program IS NULL)
  AND EXISTS (SELECT 1 FROM ops.appointments a WHERE a.cat_id = els.entity_id AND a.ffsc_program IS NOT NULL);

-- Insert correct 'ffsc_program_cat' reason for FFSC-only cats without place links
INSERT INTO ops.entity_linking_skipped (entity_type, entity_id, reason, created_at)
SELECT DISTINCT 'cat', a.cat_id, 'ffsc_program_cat', NOW()
FROM ops.appointments a
JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
WHERE a.ffsc_program IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ops.appointments a2 WHERE a2.cat_id = a.cat_id AND a2.ffsc_program IS NULL)
  AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = a.cat_id)
ON CONFLICT (entity_type, entity_id, reason) DO NOTHING;

-- =============================================================================
-- 1f. Update ops.v_ffsc_trapping_sites view
-- =============================================================================
-- Strip "Forgotten Felines Of Sonoma County" in addition to "ffsc"/"forgotten felines"

CREATE OR REPLACE VIEW ops.v_ffsc_trapping_sites AS
SELECT
    a.client_name,
    TRIM(REGEXP_REPLACE(
        REGEXP_REPLACE(a.client_name, '\s*forgotten felines of sonoma county\s*$', '', 'i'),
        '\s*(ffsc|forgotten felines)\s*$', '', 'i'
    )) AS extracted_location,
    COUNT(DISTINCT a.cat_id) as cat_count,
    MIN(a.appointment_date) as first_seen,
    MAX(a.appointment_date) as last_seen
FROM ops.appointments a
WHERE a.ffsc_program = 'ffsc_trapping_site'
GROUP BY a.client_name
ORDER BY cat_count DESC;

COMMENT ON VIEW ops.v_ffsc_trapping_sites IS
'MIG_2855: Trapping sites booked under FFSC accounts.
extracted_location strips FFSC suffixes including "Forgotten Felines Of Sonoma County".
Use for manual place matching (FFS-263).';

COMMIT;
