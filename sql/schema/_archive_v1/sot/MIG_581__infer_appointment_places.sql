\echo ''
\echo '=================================================='
\echo 'MIG_581: Infer Appointment Places (Comprehensive)'
\echo '=================================================='
\echo ''
\echo 'Creates a function to infer place_id for appointments'
\echo 'from all available sources:'
\echo '  1. clinic_owner_accounts.linked_place_id'
\echo '  2. person_place_relationships (most common)'
\echo '  3. organization_place_mappings (existing)'
\echo ''
\echo 'Run after data ingest to fill inferred_place_id gaps.'
\echo ''

-- ============================================================
-- Function: Infer places for appointments
-- ============================================================
\echo 'Creating infer_appointment_places function...'

CREATE OR REPLACE FUNCTION trapper.infer_appointment_places()
RETURNS TABLE (
  source TEXT,
  appointments_linked INT
) AS $$
DECLARE
  v_count INT;
BEGIN
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
  -- Role is an enum: resident, owner, tenant, manager, requester, contact, etc.
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
'Infers place_id for appointments from all available sources:
1. clinic_owner_accounts.linked_place_id
2. person_place_relationships
3. organization_place_mappings
Run after data ingest to fill gaps.';

-- ============================================================
-- View: v_appointment_place_coverage
-- Shows place linkage status across appointments
-- ============================================================
\echo 'Creating coverage view...'

CREATE OR REPLACE VIEW trapper.v_appointment_place_coverage AS
SELECT
  source_system,
  COUNT(*) as total_appointments,
  COUNT(inferred_place_id) as has_place,
  COUNT(place_id) as has_direct_place,
  COUNT(partner_org_id) as has_partner_org,
  COUNT(owner_account_id) as has_owner_account,
  COUNT(person_id) as has_person_id,
  ROUND(100.0 * COUNT(COALESCE(inferred_place_id, place_id)) / NULLIF(COUNT(*), 0), 1) as place_coverage_pct,
  COUNT(*) FILTER (WHERE inferred_place_source = 'owner_account') as via_owner_account,
  COUNT(*) FILTER (WHERE inferred_place_source = 'person_place') as via_person_place,
  COUNT(*) FILTER (WHERE inferred_place_source = 'org_mapping') as via_org_mapping
FROM trapper.sot_appointments
GROUP BY source_system
ORDER BY total_appointments DESC;

COMMENT ON VIEW trapper.v_appointment_place_coverage IS
'Shows place linkage coverage by source system and inference method.';

-- ============================================================
-- Run the inference function
-- ============================================================
\echo ''
\echo 'Running infer_appointment_places()...'

SELECT * FROM trapper.infer_appointment_places();

-- ============================================================
-- SUMMARY
-- ============================================================
\echo ''
\echo '=================================================='
\echo 'MIG_581 Complete!'
\echo '=================================================='
\echo ''

\echo 'Created:'
\echo '  - infer_appointment_places() - Comprehensive place inference'
\echo '  - v_appointment_place_coverage - Coverage statistics'
\echo ''

\echo 'Coverage after inference:'
SELECT * FROM trapper.v_appointment_place_coverage;

\echo ''
\echo 'Add to entity linking chain:'
\echo '  SELECT * FROM trapper.infer_appointment_places();'
\echo ''
