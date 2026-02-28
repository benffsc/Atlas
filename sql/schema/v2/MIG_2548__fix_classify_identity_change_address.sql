-- MIG_2548: Fix classify_identity_change to consider address differences
--
-- Problem (DATA_GAP_056): When phone matches but addresses differ significantly,
-- the function incorrectly auto-processes as "married name change" even when
-- it's clearly two different people at different addresses sharing a phone.
--
-- Example that was wrongly classified:
--   Samantha Spaletta (949 Chileno Valley) → Samantha Tresch (1170 Walker Rd)
--   Same cell phone: 7072178913
--   Result: auto_process=TRUE, change_type='name_update' (WRONG!)
--   Should be: auto_process=FALSE, change_type='household_member' (needs review)
--
-- Fix: In TIER 2 (phone match), check if addresses are significantly different.
-- If same phone + similar name + DIFFERENT address → require review.
-- A married name change typically doesn't involve moving to a new address.
--
-- Created: 2026-02-27

\echo ''
\echo '=============================================='
\echo '  MIG_2548: Fix classify_identity_change'
\echo '=============================================='
\echo ''

\echo 'Testing BEFORE fix...'

SELECT
    'BEFORE FIX' as test_phase,
    change_type,
    auto_process,
    LEFT(explanation, 60) as explanation_preview
FROM sot.classify_identity_change(
    'Samantha Spaletta', 'windy4s@aol.com', '7072178913', '949 Chileno Valley Road, Petaluma, CA 94952',
    'Samantha Tresch', NULL, '7072178913', '1170 Walker Rd, Petaluma, CA 94952'
);

\echo ''
\echo 'Applying fix...'

CREATE OR REPLACE FUNCTION sot.classify_identity_change(
  -- Old person data
  p_old_name TEXT,
  p_old_email TEXT,
  p_old_phone TEXT,
  p_old_address TEXT,
  -- New data from incoming record
  p_new_name TEXT,
  p_new_email TEXT,
  p_new_phone TEXT,
  p_new_address TEXT
) RETURNS TABLE (
  change_type TEXT,
  confidence NUMERIC,
  auto_process BOOLEAN,
  explanation TEXT,
  action_recommended TEXT
) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_name_comparison RECORD;
  v_email_match BOOLEAN;
  v_phone_match BOOLEAN;
  v_address_similar BOOLEAN;
  v_address_different BOOLEAN;  -- NEW: Track when addresses clearly differ
  v_change_type TEXT;
  v_confidence NUMERIC;
  v_auto_process BOOLEAN;
  v_explanation TEXT;
  v_action TEXT;
BEGIN
  -- Compare names using our enhanced function
  SELECT * INTO v_name_comparison
  FROM sot.compare_names(p_old_name, p_new_name);

  -- Normalize and compare identifiers
  v_email_match := (
    p_old_email IS NOT NULL AND p_new_email IS NOT NULL AND
    LOWER(TRIM(p_old_email)) = LOWER(TRIM(p_new_email))
  );

  v_phone_match := (
    p_old_phone IS NOT NULL AND p_new_phone IS NOT NULL AND
    sot.norm_phone_us(p_old_phone) = sot.norm_phone_us(p_new_phone)
  );

  v_address_similar := (
    p_old_address IS NOT NULL AND p_new_address IS NOT NULL AND
    similarity(LOWER(p_old_address), LOWER(p_new_address)) > 0.7
  );

  -- NEW: Check if addresses are clearly different (both present but low similarity)
  v_address_different := (
    p_old_address IS NOT NULL AND p_new_address IS NOT NULL AND
    similarity(LOWER(p_old_address), LOWER(p_new_address)) < 0.4
  );

  -- =========================================================================
  -- CLASSIFICATION LOGIC (Fellegi-Sunter style thresholds)
  -- =========================================================================

  -- TIER 1: SAME EMAIL = SAME PERSON (Auto-process)
  -- Email is most reliable identifier
  IF v_email_match THEN
    IF v_name_comparison.is_likely_correction THEN
      v_change_type := 'correction';
      v_confidence := 0.98;
      v_explanation := 'Same email with name correction: ' || v_name_comparison.comparison_notes;
      v_action := 'Auto-update name on existing person record';
    ELSE
      v_change_type := 'name_update';
      v_confidence := 0.95;
      v_explanation := 'Same email, name changed (married name, legal change): ' || v_name_comparison.comparison_notes;
      v_action := 'Update name on existing person, log as name change';
    END IF;
    v_auto_process := TRUE;

  -- TIER 2: SAME PHONE, ASSESS NAME AND ADDRESS
  ELSIF v_phone_match THEN
    -- FIX: If addresses are clearly different, this is likely two people sharing a phone
    IF v_address_different THEN
      -- Same phone, different addresses = likely shared phone (household members at different locations)
      v_change_type := 'household_member';
      v_confidence := 0.75;
      v_explanation := 'Same phone but DIFFERENT addresses. Old: ' ||
                       COALESCE(p_old_address, 'unknown') || '. New: ' ||
                       COALESCE(p_new_address, 'unknown') || '. ' ||
                       'Name comparison: ' || v_name_comparison.comparison_notes;
      v_action := 'REVIEW: Different people sharing a phone number. Create separate person records.';
      v_auto_process := FALSE;
    ELSIF v_name_comparison.is_likely_same_person THEN
      -- Same phone, similar name, same/similar address = same person
      IF v_name_comparison.is_likely_correction THEN
        v_change_type := 'correction';
        v_confidence := 0.90;
        v_explanation := 'Same phone with name correction: ' || v_name_comparison.comparison_notes;
        v_action := 'Auto-update name on existing person record';
        v_auto_process := TRUE;
      ELSIF v_address_similar OR p_old_address IS NULL OR p_new_address IS NULL THEN
        -- Only auto-process married name if addresses are similar or unknown
        v_change_type := 'name_update';
        v_confidence := 0.85;
        v_explanation := 'Same phone + similar/unknown address, name changed: ' || v_name_comparison.comparison_notes;
        v_action := 'Update name on existing person, log as name change';
        v_auto_process := TRUE;
      ELSE
        -- Address doesn't match well enough - be cautious
        v_change_type := 'name_update';
        v_confidence := 0.70;
        v_explanation := 'Same phone, name changed, but address similarity unclear: ' || v_name_comparison.comparison_notes;
        v_action := 'REVIEW: Verify this is a name change and not a different person';
        v_auto_process := FALSE;
      END IF;
    ELSIF v_name_comparison.is_likely_same_person IS NULL THEN
      -- Ambiguous - could be household member
      v_change_type := 'household_member';
      v_confidence := 0.60;
      v_explanation := 'Same phone but name is ambiguous: ' || v_name_comparison.comparison_notes;
      v_action := 'REVIEW: May be spouse/family member sharing phone';
      v_auto_process := FALSE;
    ELSE
      -- Same phone, very different name = likely household member
      v_change_type := 'household_member';
      v_confidence := 0.70;
      v_explanation := 'Same phone, different person: ' || v_name_comparison.comparison_notes;
      v_action := 'REVIEW: Create new person linked to same household';
      v_auto_process := FALSE;
    END IF;

  -- TIER 3: DIFFERENT EMAIL AND PHONE
  ELSIF p_new_email IS NOT NULL AND p_new_phone IS NOT NULL THEN
    -- Both identifiers changed = likely different person
    IF v_address_similar THEN
      -- Same address but different identifiers = ownership transfer
      v_change_type := 'ownership_transfer';
      v_confidence := 0.75;
      v_explanation := 'Same address, different contact info. Previous: ' ||
                       COALESCE(p_old_name, 'unknown') || '. New: ' || COALESCE(p_new_name, 'unknown');
      v_action := 'REVIEW: Property may have transferred to new owner/resident. Create new person?';
      v_auto_process := FALSE;
    ELSE
      -- Everything different = new entity
      v_change_type := 'new_entity';
      v_confidence := 0.80;
      v_explanation := 'All identifiers differ. This appears to be a completely different person.';
      v_action := 'REVIEW: Create new person record. Why is this booking under old contact?';
      v_auto_process := FALSE;
    END IF;

  -- TIER 4: PARTIAL DATA - NEED REVIEW
  ELSE
    v_change_type := 'ambiguous';
    v_confidence := 0.50;
    v_explanation := 'Insufficient data to classify. Old: ' ||
                     COALESCE(p_old_email, 'no email') || ' / ' || COALESCE(p_old_phone, 'no phone') ||
                     '. New: ' || COALESCE(p_new_email, 'no email') || ' / ' || COALESCE(p_new_phone, 'no phone');
    v_action := 'REVIEW: Manual inspection required due to missing identifiers';
    v_auto_process := FALSE;
  END IF;

  RETURN QUERY SELECT v_change_type, v_confidence, v_auto_process, v_explanation, v_action;
END;
$$;

COMMENT ON FUNCTION sot.classify_identity_change IS
'Classifies identity changes using Fellegi-Sunter style thresholds.
FIXED (MIG_2548): Now considers address differences when phone matches.
Same phone + different address = requires review, not auto-process.

Change types:
- CORRECTION: Typo fix, auto-process
- NAME_UPDATE: Legal/married name change, auto-process ONLY with same identifier AND similar address
- HOUSEHOLD_MEMBER: Same phone + different address OR different person - review
- OWNERSHIP_TRANSFER: Same address, different identifiers - review
- NEW_ENTITY: Everything different - review
- AMBIGUOUS: Cannot determine - review';

\echo ''
\echo 'Testing AFTER fix...'

SELECT
    'AFTER FIX' as test_phase,
    change_type,
    auto_process,
    LEFT(explanation, 80) as explanation_preview
FROM sot.classify_identity_change(
    'Samantha Spaletta', 'windy4s@aol.com', '7072178913', '949 Chileno Valley Road, Petaluma, CA 94952',
    'Samantha Tresch', NULL, '7072178913', '1170 Walker Rd, Petaluma, CA 94952'
);

\echo ''
\echo 'Additional test cases...'

-- Test: Same phone, similar name, SAME address (should still auto-process)
SELECT
    'Same phone+address+name change' as scenario,
    change_type,
    auto_process,
    LEFT(explanation, 60) as explanation_preview
FROM sot.classify_identity_change(
    'Samantha Spaletta', NULL, '7072178913', '949 Chileno Valley Road, Petaluma',
    'Samantha Tresch', NULL, '7072178913', '949 Chileno Valley Road, Petaluma'
);

-- Test: Same phone, typo correction, different address (should require review)
SELECT
    'Typo+different address' as scenario,
    change_type,
    auto_process,
    LEFT(explanation, 60) as explanation_preview
FROM sot.classify_identity_change(
    'John Smith', NULL, '7075551234', '123 Main St, Santa Rosa',
    'John Smyth', NULL, '7075551234', '456 Oak Ave, Petaluma'
);

-- Test: Same phone, same last name different first (household member)
SELECT
    'Kathy vs Samantha Tresch' as scenario,
    change_type,
    auto_process,
    LEFT(explanation, 60) as explanation_preview
FROM sot.classify_identity_change(
    'Samantha Tresch', NULL, '7072178913', '1170 Walker Rd',
    'Kathy Tresch', NULL, '7072178913', '1170 Walker Rd'
);

\echo ''
\echo '=============================================='
\echo '  MIG_2548 Complete'
\echo '=============================================='
\echo ''
\echo 'Fixed: Same phone + different address now requires review'
\echo ''
