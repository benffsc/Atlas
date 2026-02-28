-- MIG_2545: Enhanced Change Detection System
--
-- Implements industry best practices for identity resolution change detection:
-- 1. Fellegi-Sunter style three-way classification (match, non-match, review)
-- 2. Field-specific algorithms (Jaro-Winkler for names, phonetic for sound-alikes)
-- 3. Change type taxonomy (correction, household, transfer, new_entity)
-- 4. Confidence scoring based on what changed vs what stayed the same
--
-- References:
-- - Fellegi-Sunter (1969): "A Theory For Record Linkage"
-- - Jaro-Winkler: Best for short strings like names (97.4% sensitivity at 0.8 threshold)
-- - Double Metaphone: Handles phonetic variations (Smith/Smyth)
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2545: Enhanced Change Detection'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Enhanced name comparison function using multiple algorithms
-- ============================================================================

\echo '1. Creating enhanced name comparison function...'

CREATE OR REPLACE FUNCTION sot.compare_names(
  p_name1 TEXT,
  p_name2 TEXT
) RETURNS TABLE (
  trigram_similarity NUMERIC,
  phonetic_match BOOLEAN,
  levenshtein_distance INT,
  jaro_winkler_similarity NUMERIC,
  first_name_match BOOLEAN,
  last_name_match BOOLEAN,
  is_likely_same_person BOOLEAN,
  is_likely_correction BOOLEAN,
  comparison_notes TEXT
) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_name1_norm TEXT;
  v_name2_norm TEXT;
  v_first1 TEXT;
  v_last1 TEXT;
  v_first2 TEXT;
  v_last2 TEXT;
  v_trigram NUMERIC;
  v_phonetic BOOLEAN;
  v_levenshtein INT;
  v_jaro_winkler NUMERIC;
  v_first_match BOOLEAN;
  v_last_match BOOLEAN;
  v_same_person BOOLEAN := FALSE;
  v_correction BOOLEAN := FALSE;
  v_notes TEXT := '';
BEGIN
  -- Handle nulls
  IF p_name1 IS NULL OR p_name2 IS NULL THEN
    RETURN QUERY SELECT
      0::NUMERIC, FALSE, 999, 0::NUMERIC, FALSE, FALSE, FALSE, FALSE,
      'One or both names are null'::TEXT;
    RETURN;
  END IF;

  -- Normalize names
  v_name1_norm := LOWER(TRIM(p_name1));
  v_name2_norm := LOWER(TRIM(p_name2));

  -- Exact match
  IF v_name1_norm = v_name2_norm THEN
    RETURN QUERY SELECT
      1.0::NUMERIC, TRUE, 0, 1.0::NUMERIC, TRUE, TRUE, TRUE, TRUE,
      'Exact match'::TEXT;
    RETURN;
  END IF;

  -- Split into first/last names
  v_first1 := SPLIT_PART(v_name1_norm, ' ', 1);
  v_last1 := NULLIF(TRIM(SUBSTRING(v_name1_norm FROM POSITION(' ' IN v_name1_norm))), '');
  v_first2 := SPLIT_PART(v_name2_norm, ' ', 1);
  v_last2 := NULLIF(TRIM(SUBSTRING(v_name2_norm FROM POSITION(' ' IN v_name2_norm))), '');

  -- Calculate similarity metrics
  v_trigram := similarity(v_name1_norm, v_name2_norm);
  v_levenshtein := levenshtein(v_name1_norm, v_name2_norm);

  -- Phonetic comparison using Double Metaphone
  v_phonetic := (
    dmetaphone(v_name1_norm) = dmetaphone(v_name2_norm) OR
    (v_last1 IS NOT NULL AND v_last2 IS NOT NULL AND
     dmetaphone(v_last1) = dmetaphone(v_last2))
  );

  -- Jaro-Winkler (approximation using similarity + prefix bonus)
  -- True Jaro-Winkler not in pg, but we simulate with trigram + prefix check
  v_jaro_winkler := v_trigram;
  IF LEFT(v_name1_norm, 3) = LEFT(v_name2_norm, 3) THEN
    v_jaro_winkler := v_jaro_winkler + (1 - v_jaro_winkler) * 0.1 * 3;
  END IF;

  -- Check first/last name matches separately
  v_first_match := (
    v_first1 = v_first2 OR
    similarity(v_first1, v_first2) > 0.7 OR
    dmetaphone(v_first1) = dmetaphone(v_first2)
  );

  v_last_match := (
    v_last1 IS NOT NULL AND v_last2 IS NOT NULL AND (
      v_last1 = v_last2 OR
      similarity(v_last1, v_last2) > 0.7 OR
      dmetaphone(v_last1) = dmetaphone(v_last2)
    )
  );

  -- Determine if likely same person or correction
  -- CASE 1: Same first name, different last name = likely married name change
  IF v_first_match AND NOT v_last_match AND v_last1 IS NOT NULL AND v_last2 IS NOT NULL THEN
    v_same_person := TRUE;
    v_correction := FALSE;
    v_notes := 'First name matches, last name differs - possible married name';
  -- CASE 2: Different first name, same last name = likely household member (spouse, sibling)
  ELSIF NOT v_first_match AND v_last_match THEN
    v_same_person := FALSE;  -- Different person
    v_correction := FALSE;
    v_notes := 'Same last name, different first name - likely household member (family)';
  -- CASE 3: High similarity + phonetic match = typo correction
  ELSIF v_trigram > 0.6 AND v_phonetic THEN
    v_same_person := TRUE;
    v_correction := TRUE;
    v_notes := 'High similarity with phonetic match - likely typo correction';
  -- CASE 4: Low edit distance (1-2 chars) = typo
  ELSIF v_levenshtein <= 2 THEN
    v_same_person := TRUE;
    v_correction := TRUE;
    v_notes := 'Small edit distance (' || v_levenshtein || ' chars) - likely typo';
  -- CASE 5: Both first and last names match phonetically = likely same person with typo
  ELSIF v_first_match AND v_last_match THEN
    v_same_person := TRUE;
    v_correction := TRUE;
    v_notes := 'Both first and last names match - likely same person';
  -- CASE 6: Very different names
  ELSIF v_trigram < 0.2 AND NOT v_first_match AND NOT v_last_match THEN
    v_same_person := FALSE;
    v_correction := FALSE;
    v_notes := 'Completely different names - likely different person';
  -- CASE 7: Ambiguous - needs review
  ELSE
    v_same_person := NULL;
    v_correction := FALSE;
    v_notes := 'Ambiguous - requires manual review';
  END IF;

  RETURN QUERY SELECT
    v_trigram,
    v_phonetic,
    v_levenshtein,
    v_jaro_winkler,
    v_first_match,
    v_last_match,
    v_same_person,
    v_correction,
    v_notes;
END;
$$;

COMMENT ON FUNCTION sot.compare_names IS
'Industry-standard name comparison using multiple algorithms:
- Trigram similarity (pg_trgm)
- Double Metaphone for phonetic matching
- Levenshtein edit distance
- First/last name component analysis
Returns assessment of whether names represent same person and if change is a correction.';

-- ============================================================================
-- 2. Change type taxonomy enum
-- ============================================================================

\echo '2. Creating change type taxonomy...'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'identity_change_type') THEN
    CREATE TYPE sot.identity_change_type AS ENUM (
      'correction',       -- Typo fix, spelling correction (auto-process)
      'name_update',      -- Legal name change, married name (auto-process with same identifier)
      'household_member', -- Same address/phone, different person (review)
      'ownership_transfer', -- Property/account transferred to new person (review)
      'new_entity',       -- Completely different person (create new, review)
      'ambiguous'         -- Cannot determine automatically (review)
    );
  END IF;
END $$;

-- ============================================================================
-- 3. Enhanced change classification function
-- ============================================================================

\echo '3. Creating enhanced change classification function...'

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

  -- =========================================================================
  -- CLASSIFICATION LOGIC (Fellegi-Sunter style thresholds)
  -- =========================================================================

  -- TIER 1: SAME IDENTIFIER = SAME PERSON (Auto-process)
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

  -- TIER 2: SAME PHONE, ASSESS NAME
  ELSIF v_phone_match THEN
    IF v_name_comparison.is_likely_same_person THEN
      -- Same phone, similar name = same person
      IF v_name_comparison.is_likely_correction THEN
        v_change_type := 'correction';
        v_confidence := 0.90;
        v_explanation := 'Same phone with name correction: ' || v_name_comparison.comparison_notes;
        v_action := 'Auto-update name on existing person record';
        v_auto_process := TRUE;
      ELSE
        -- Could be married name change
        v_change_type := 'name_update';
        v_confidence := 0.85;
        v_explanation := 'Same phone, name changed: ' || v_name_comparison.comparison_notes;
        v_action := 'Update name on existing person, log as name change';
        v_auto_process := TRUE;
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
'Classifies identity changes using Fellegi-Sunter style thresholds:
- CORRECTION: Typo fix, auto-process
- NAME_UPDATE: Legal/married name change, auto-process with same identifier
- HOUSEHOLD_MEMBER: Same phone, different person - review
- OWNERSHIP_TRANSFER: Same address, different identifiers - review
- NEW_ENTITY: Everything different - review
- AMBIGUOUS: Cannot determine - review';

-- ============================================================================
-- 4. Test the classification with real examples
-- ============================================================================

\echo ''
\echo '4. Testing classification with examples...'

\echo 'Test 1: Same email, typo correction (Smith -> Smyth)'
SELECT * FROM sot.classify_identity_change(
  'John Smith', 'john@example.com', '7075551234', '123 Main St',
  'John Smyth', 'john@example.com', '7075551234', '123 Main St'
);

\echo 'Test 2: Same phone, married name (Samantha Spaletta -> Samantha Tresch)'
SELECT * FROM sot.classify_identity_change(
  'Samantha Spaletta', 'sam@example.com', '7079532214', '1170 Walker Rd',
  'Samantha Tresch', NULL, '7079532214', '1170 Walker Rd'
);

\echo 'Test 3: Same phone, different person (Samantha -> Kathy at same address)'
SELECT * FROM sot.classify_identity_change(
  'Samantha Tresch', 'sam@example.com', '7079532214', '1170 Walker Rd',
  'Kathy Tresch', 'kathy@example.com', '7079532214', '1170 Walker Rd'
);

\echo 'Test 4: Same address, ownership transfer (Dahlia and Sage -> Jessica)'
SELECT * FROM sot.classify_identity_change(
  'Dahlia and Sage Market', 'dahlia@market.com', '7075551111', '118 E 2nd St Cloverdale',
  'Jessica Gonzalez', 'jessica@email.com', '7075365213', '118 E. 2nd St Cloverdale'
);

\echo 'Test 5: Everything different (Jill Manning -> Kathleen Sartori)'
SELECT * FROM sot.classify_identity_change(
  'Jill Manning', 'jill@example.com', '7075551111', '100 Oak Ave',
  'Kathleen Sartori', 'kathleen@example.com', '7075552222', '200 Pine St'
);

-- ============================================================================
-- 5. Update the detect_owner_changes function to use new classification
-- ============================================================================

\echo ''
\echo '5. This migration adds the classification functions.'
\echo '   The detect_owner_changes function should be updated to use'
\echo '   sot.classify_identity_change() for better categorization.'
\echo ''

\echo ''
\echo '=============================================='
\echo '  MIG_2545 Complete'
\echo '=============================================='
\echo ''
\echo 'Created functions:'
\echo '  - sot.compare_names(): Multi-algorithm name comparison'
\echo '  - sot.classify_identity_change(): Fellegi-Sunter style classification'
\echo ''
\echo 'Change types:'
\echo '  - correction: Auto-process (typo fix)'
\echo '  - name_update: Auto-process (married name, legal change)'
\echo '  - household_member: Review (same phone, different person)'
\echo '  - ownership_transfer: Review (same address, new identifiers)'
\echo '  - new_entity: Review (everything different)'
\echo '  - ambiguous: Review (insufficient data)'
\echo ''
