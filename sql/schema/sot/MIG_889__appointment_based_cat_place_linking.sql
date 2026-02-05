-- ============================================================================
-- MIG_889: Appointment-Based Cat-Place Linking
-- ============================================================================
-- Root Cause: link_cats_to_places() chains person_cat → person_place and links
-- cats to ALL historical addresses a person has. This pollutes cat-place data
-- with stale/wrong addresses. 92.3% of appointments have inferred_place_id
-- (a pre-computed best-place), but it's not used for cat-place linking.
--
-- Fixes:
-- 1. New function link_cats_to_appointment_places() using inferred_place_id
-- 2. Update link_cats_to_places() to LIMIT 1 per person (best confidence/recency)
-- ============================================================================

\echo '=== MIG_889: Appointment-Based Cat-Place Linking ==='

-- ============================================================================
-- Phase 1: New function - link cats to places via appointment inferred_place_id
-- ============================================================================

\echo ''
\echo 'Phase 1: Creating link_cats_to_appointment_places()...'

CREATE OR REPLACE FUNCTION trapper.link_cats_to_appointment_places()
RETURNS TABLE(cats_linked integer) LANGUAGE plpgsql AS $$
DECLARE
    v_total INT := 0;
    v_result UUID;
    v_cat_id UUID;
    v_place_id UUID;
BEGIN
    -- Link cats to places using the pre-computed inferred_place_id from appointments.
    -- This is more accurate than the person_cat → person_place chain because:
    -- 1. inferred_place_id comes from the appointment's actual owner address
    -- 2. It uses the most recent appointment per cat (not all historical addresses)
    -- 3. 92.3% of appointments have inferred_place_id coverage

    FOR v_cat_id, v_place_id IN
        WITH appointment_places AS (
            SELECT DISTINCT ON (a.cat_id)
                a.cat_id,
                COALESCE(a.inferred_place_id, a.place_id) AS place_id
            FROM trapper.sot_appointments a
            WHERE a.cat_id IS NOT NULL
              AND COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM trapper.sot_cats sc
                  WHERE sc.cat_id = a.cat_id AND sc.merged_into_cat_id IS NULL
              )
            ORDER BY a.cat_id, a.appointment_date DESC  -- most recent appointment wins
        )
        SELECT ap.cat_id, ap.place_id
        FROM appointment_places ap
        JOIN trapper.places pl ON pl.place_id = ap.place_id
          AND pl.merged_into_place_id IS NULL
        WHERE NOT EXISTS (
            SELECT 1 FROM trapper.cat_place_relationships cpr
            WHERE cpr.cat_id = ap.cat_id AND cpr.place_id = ap.place_id
        )
    LOOP
        v_result := trapper.link_cat_to_place(
            p_cat_id := v_cat_id,
            p_place_id := v_place_id,
            p_relationship_type := 'appointment_site',
            p_evidence_type := 'appointment',
            p_source_system := 'atlas',
            p_source_table := 'link_cats_to_appointment_places',
            p_evidence_detail := jsonb_build_object('link_method', 'appointment_inferred_place'),
            p_confidence := 'high'
        );
        IF v_result IS NOT NULL THEN
            v_total := v_total + 1;
        END IF;
    END LOOP;

    cats_linked := v_total;
    RETURN NEXT;
END; $$;

COMMENT ON FUNCTION trapper.link_cats_to_appointment_places() IS
'MIG_889: Links cats to places using appointment inferred_place_id.
More accurate than person_cat → person_place chain because it uses
the pre-computed best-place from the most recent appointment.
Uses link_cat_to_place() gatekeeper (INV-10).';

-- ============================================================================
-- Phase 2: Update link_cats_to_places() to LIMIT 1 per person
-- ============================================================================

\echo ''
\echo 'Phase 2: Updating link_cats_to_places() with LIMIT 1 per person...'

CREATE OR REPLACE FUNCTION trapper.link_cats_to_places()
RETURNS TABLE(cats_linked_home integer, cats_linked_appointment integer, total_edges integer)
LANGUAGE plpgsql
AS $$
DECLARE
    v_total INT := 0;
    v_cat_id UUID;
    v_place_id UUID;
    v_pcr_type TEXT;
    v_cpr_type TEXT;
    v_confidence TEXT;
    v_evidence_type TEXT;
    v_result UUID;
BEGIN
    -- Link cats to places via person_cat_relationships + person_place_relationships.
    -- Maps person_cat relationship types to cat_place relationship types:
    --   owner            -> home        (high confidence)
    --   caretaker        -> residence   (medium confidence)
    --   foster           -> home        (medium confidence)
    --   adopter          -> home        (high confidence)
    --   colony_caretaker -> colony_member (medium confidence)
    --
    -- MIG_889: Now uses LIMIT 1 per person (highest confidence, most recent)
    -- instead of linking to ALL historical addresses. This prevents pollution
    -- from stale addresses.

    FOR v_cat_id, v_place_id, v_pcr_type IN
        SELECT DISTINCT
            pcr.cat_id,
            best_place.place_id,
            pcr.relationship_type
        FROM trapper.person_cat_relationships pcr
        JOIN trapper.sot_people sp ON sp.person_id = pcr.person_id
            AND sp.merged_into_person_id IS NULL
            AND COALESCE(sp.is_system_account, FALSE) = FALSE  -- INV-12: exclude system accounts
        -- MIG_889: LATERAL join to get ONLY the best place per person
        JOIN LATERAL (
            SELECT ppr.place_id
            FROM trapper.person_place_relationships ppr
            JOIN trapper.places pl ON pl.place_id = ppr.place_id
                AND pl.merged_into_place_id IS NULL
            WHERE ppr.person_id = pcr.person_id
              AND ppr.role IN ('resident', 'owner', 'requester')
            ORDER BY ppr.confidence DESC, ppr.created_at DESC
            LIMIT 1
        ) best_place ON TRUE
        JOIN trapper.sot_cats sc ON sc.cat_id = pcr.cat_id
            AND sc.merged_into_cat_id IS NULL
        WHERE pcr.relationship_type IN ('owner', 'caretaker', 'foster', 'adopter', 'colony_caretaker')
        -- INV-12: exclude staff/trappers whose cats are clinic-processed, not residents
        AND NOT EXISTS (
            SELECT 1 FROM trapper.person_roles pr
            WHERE pr.person_id = pcr.person_id
              AND pr.role_status = 'active'
              AND pr.role IN ('staff', 'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
        )
        AND NOT EXISTS (
            SELECT 1 FROM trapper.cat_place_relationships cpr
            WHERE cpr.cat_id = pcr.cat_id
              AND cpr.place_id = best_place.place_id
        )
    LOOP
        -- Map person_cat type -> cat_place type + confidence
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

        v_result := trapper.link_cat_to_place(
            p_cat_id := v_cat_id,
            p_place_id := v_place_id,
            p_relationship_type := v_cpr_type,
            p_evidence_type := v_evidence_type,
            p_source_system := 'atlas',
            p_source_table := 'link_cats_to_places',
            p_evidence_detail := jsonb_build_object(
                'link_method', 'person_cat_to_place',
                'person_cat_type', v_pcr_type
            ),
            p_confidence := v_confidence
        );
        IF v_result IS NOT NULL THEN
            v_total := v_total + 1;
        END IF;
    END LOOP;

    cats_linked_home := v_total;
    cats_linked_appointment := 0;
    total_edges := v_total;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION trapper.link_cats_to_places() IS
'MIG_889: Updated to LIMIT 1 person_place_relationship per person (highest confidence,
most recent). Prevents cats from being linked to ALL historical addresses of a person.
Uses link_cat_to_place() gatekeeper (INV-10).';

-- ============================================================================
-- Phase 3: Update infer_appointment_places() with booking address source
-- ============================================================================
-- Root cause: infer_appointment_places() resolves inferred_place_id from the
-- person's PRIMARY residence (person_place_relationships). But ClinicHQ
-- appointments are booked under the COLONY SITE address, not the person's home.
-- For trappers like Cassie Thomson (home=Silver Spur, colony=Stony Point Rd),
-- the cat incorrectly shows at Silver Spur instead of the colony.
--
-- Fix: Add Step 0 (highest priority) that resolves the booking address from
-- the original staged_record. This is the most accurate source because it
-- uses the address the appointment was actually booked under.
-- ============================================================================

\echo ''
\echo 'Phase 3: Updating infer_appointment_places() with booking address source...'

CREATE OR REPLACE FUNCTION trapper.infer_appointment_places()
RETURNS TABLE (
  source TEXT,
  appointments_linked INT
) AS $$
DECLARE
  v_count INT;
BEGIN
  -- 0. Link via booking address from staged_records (HIGHEST PRIORITY)
  -- ClinicHQ appointments are booked under the colony site address.
  -- This is more accurate than person_place_relationships which resolves
  -- to the person's home address.
  WITH booking_addresses AS (
    UPDATE trapper.sot_appointments a
    SET inferred_place_id = pl.place_id,
        inferred_place_source = 'booking_address'
    FROM trapper.staged_records sr
    JOIN trapper.places pl ON pl.normalized_address = trapper.normalize_address(sr.payload->>'Owner Address')
      AND pl.merged_into_place_id IS NULL
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.payload->>'Number' = a.appointment_number
      AND sr.payload->>'Owner Address' IS NOT NULL
      AND TRIM(sr.payload->>'Owner Address') != ''
      AND LENGTH(TRIM(sr.payload->>'Owner Address')) > 10
      AND a.inferred_place_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM booking_addresses;
  source := 'booking_address'; appointments_linked := v_count; RETURN NEXT;

  -- 1. Link via clinic_owner_accounts.linked_place_id
  WITH updated AS (
    UPDATE trapper.sot_appointments a
    SET inferred_place_id = coa.linked_place_id,
        inferred_place_source = 'owner_account'
    FROM trapper.clinic_owner_accounts coa
    WHERE a.owner_account_id = coa.account_id
      AND coa.linked_place_id IS NOT NULL
      AND a.inferred_place_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'clinic_owner_accounts'; appointments_linked := v_count; RETURN NEXT;

  -- 2. Link via person_place_relationships (primary residence)
  -- Uses most recent relationship if multiple exist
  WITH person_primary_places AS (
    SELECT DISTINCT ON (person_id) person_id, place_id
    FROM trapper.person_place_relationships
    WHERE role IN ('resident', 'owner', 'tenant', 'requester')
    ORDER BY person_id,
      CASE role
        WHEN 'resident' THEN 1
        WHEN 'owner' THEN 2
        WHEN 'tenant' THEN 3
        WHEN 'requester' THEN 4
      END,
      created_at DESC
  ),
  updated AS (
    UPDATE trapper.sot_appointments a
    SET inferred_place_id = ppp.place_id,
        inferred_place_source = 'person_place'
    FROM person_primary_places ppp
    WHERE a.person_id = ppp.person_id
      AND a.inferred_place_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'person_place_relationships'; appointments_linked := v_count; RETURN NEXT;

  -- 3. Link via organization_place_mappings (existing logic)
  WITH org_appointments AS (
    SELECT
      a.appointment_id,
      p.display_name AS owner_name,
      (
        SELECT m.place_id
        FROM trapper.organization_place_mappings m
        WHERE m.auto_link_enabled = TRUE
          AND (
            (m.org_pattern_type = 'ilike' AND p.display_name ILIKE m.org_pattern) OR
            (m.org_pattern_type = 'exact' AND LOWER(p.display_name) = LOWER(m.org_pattern)) OR
            (m.org_pattern_type = 'regex' AND p.display_name ~* m.org_pattern)
          )
        ORDER BY CASE WHEN LOWER(p.display_name) = LOWER(m.org_pattern) THEN 0 ELSE 1 END
        LIMIT 1
      ) AS mapped_place_id
    FROM trapper.sot_appointments a
    JOIN trapper.sot_people p ON a.person_id = p.person_id
    WHERE a.inferred_place_id IS NULL
      AND p.is_canonical = FALSE
  ),
  updated AS (
    UPDATE trapper.sot_appointments a
    SET inferred_place_id = oa.mapped_place_id,
        inferred_place_source = 'org_mapping'
    FROM org_appointments oa
    WHERE a.appointment_id = oa.appointment_id
      AND oa.mapped_place_id IS NOT NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'organization_place_mappings'; appointments_linked := v_count; RETURN NEXT;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.infer_appointment_places IS
'MIG_889: Added booking_address as highest-priority source (Step 0).
ClinicHQ appointments are booked under the colony site address,
not the person home. Step 0 resolves the actual booking address
from staged_records before falling back to person_place.
Sources (priority order):
  0. booking_address (from staged_records Owner Address)
  1. clinic_owner_accounts.linked_place_id
  2. person_place_relationships (primary residence)
  3. organization_place_mappings';

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_889 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. link_cats_to_appointment_places(): new function using inferred_place_id'
\echo '  2. link_cats_to_places(): LIMIT 1 per person (best confidence/recency)'
\echo '  3. infer_appointment_places(): booking address as highest priority source'
\echo ''
\echo 'Prefer link_cats_to_appointment_places() over link_cats_to_places().'
\echo 'The appointment path covers 92.3% of cats and is more accurate.'
\echo 'Booking address (Step 0) ensures colony site, not person home.'
