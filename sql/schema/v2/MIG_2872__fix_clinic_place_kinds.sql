-- ============================================================================
-- MIG_2872: Fix FFSC Clinic Place Kinds
-- ============================================================================
-- Problem: FFSC clinic at 1814 Empire Industrial Ct and variants have
-- place_kind = 'single_family' or 'apartment_unit' or 'outdoor_site'
-- instead of 'clinic'. This causes confusion in analytics but doesn't
-- affect entity linking (blacklist already blocks them correctly).
--
-- FFS-318
-- ============================================================================

\echo ''
\echo '================================================'
\echo '  MIG_2872: Fix FFSC Clinic Place Kinds'
\echo '================================================'
\echo ''

UPDATE sot.places
SET place_kind = 'clinic', updated_at = NOW()
WHERE place_id IN (
  'd03a685b-854c-4f5e-84fd-be09e92b4e99',  -- 1814 Empire Industrial Ct (main clinic)
  '6b68a693-87e3-4fea-a7d3-eac06b36edfd',  -- 1814A Empire Industrial Ct
  'dc0babf9-7190-4baa-9b11-f771c4266c13',  -- 1814 Empire Industrial Ct Suite F
  '1a2aedd8-2020-4af5-b649-17c7d615e796',  -- 636 Montgomery Road / 1814 Empire Industrial (combined)
  '661fedcc-05f3-4838-8658-6eab4080eeac'   -- 1813 Empire Industrial Ct (adjacent)
)
AND place_kind <> 'clinic';

\echo 'Fixed FFSC clinic place_kinds'
\echo ''

-- Verify
SELECT place_id, place_kind, formatted_address
FROM sot.places
WHERE place_id IN (
  'd03a685b-854c-4f5e-84fd-be09e92b4e99',
  '6b68a693-87e3-4fea-a7d3-eac06b36edfd',
  'dc0babf9-7190-4baa-9b11-f771c4266c13',
  '1a2aedd8-2020-4af5-b649-17c7d615e796',
  '661fedcc-05f3-4838-8658-6eab4080eeac'
);

\echo ''
\echo '================================================'
\echo '  MIG_2872 Complete (FFS-318)'
\echo '================================================'
