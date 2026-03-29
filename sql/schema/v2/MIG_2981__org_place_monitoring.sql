-- MIG_2981: Monitoring guardrails for org-person cross-contamination
-- FFS-747: Detect future cases where org accounts get person_id set

-- ============================================================
-- VIEW 1: Org-person cross-contamination detector
-- Should always return 0 rows after MIG_2980 repair.
-- If rows appear, org-account guard in link_appointments_to_owners() has a gap.
-- ============================================================

CREATE OR REPLACE VIEW ops.v_org_person_cross_contamination AS
SELECT
    a.appointment_id,
    a.appointment_date,
    ca.account_type,
    ca.display_name as account_name,
    ca.owner_address as booking_address,
    a.person_id,
    p.display_name as linked_person_name,
    ip.formatted_address as inferred_address,
    a.owner_address as appointment_address
FROM ops.appointments a
JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
    AND ca.account_type IN ('organization', 'site_name', 'address')
    AND ca.resolved_person_id IS NULL
    AND ca.merged_into_account_id IS NULL
LEFT JOIN sot.people p ON p.person_id = a.person_id
LEFT JOIN sot.places ip ON ip.place_id = a.inferred_place_id
WHERE a.person_id IS NOT NULL;

COMMENT ON VIEW ops.v_org_person_cross_contamination IS
'FFS-747: Appointments where person_id is set but the booking belongs to an org/site/address account. Should always be 0 rows.';


-- ============================================================
-- VIEW 2: Address mismatch detector
-- Appointments where inferred_place_id doesn't match owner_address.
-- Some mismatches are expected (fuzzy matching), but low similarity = bug.
-- ============================================================

CREATE OR REPLACE VIEW ops.v_address_mismatch_appointments AS
SELECT
    a.appointment_id,
    a.appointment_date,
    a.owner_address,
    pl.formatted_address as inferred_address,
    ROUND(similarity(
        sot.normalize_address(a.owner_address),
        pl.normalized_address
    )::numeric, 2) as address_similarity,
    ca.display_name as account_name,
    ca.account_type
FROM ops.appointments a
JOIN sot.places pl ON pl.place_id = a.inferred_place_id
LEFT JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
WHERE a.owner_address IS NOT NULL
  AND TRIM(a.owner_address) != ''
  AND LENGTH(TRIM(a.owner_address)) > 10
  AND similarity(
      sot.normalize_address(a.owner_address),
      pl.normalized_address
  ) < 0.3
ORDER BY similarity(sot.normalize_address(a.owner_address), pl.normalized_address) ASC;

COMMENT ON VIEW ops.v_address_mismatch_appointments IS
'FFS-747: Appointments where inferred_place_id address has very low similarity to booking address. Should be 0 after MIG_2980.';
