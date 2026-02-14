-- MIG_2047: Resolve remaining 39 fuzzy name matches
-- Date: 2026-02-13
-- Issue: 39 pending reviews after MIG_2042 and MIG_2043 bulk approvals
--
-- Analysis:
--   Pattern 1 - Name subset (26): "LMFM Bruce Poole" → "Bruce Poole"
--               These have data prefixes/suffixes - clearly same person
--   Pattern 2 - Typo/Nickname (3): "Jacob White" → "Jake White"
--               Same email + similar name - clearly same person
--   Pattern 3 - Different people (10): "Jason Harper" → "Cleophus McDonalds"
--               Different names sharing an email - should NOT match
--
-- Actions:
--   1. Approve name subsets and typos (29 rows)
--   2. Reject different-people matches (10 rows)
--   3. Soft-blacklist shared emails to prevent future false matches

-- Step 1: Check before state
SELECT 'BEFORE: Pending reviews' as context, COUNT(*) as count
FROM sot.match_decisions WHERE review_status = 'pending';

-- Step 2: Approve name subsets and clear typos/nicknames
-- These are clearly the same person based on name patterns
WITH to_approve AS (
  SELECT md.decision_id, md.incoming_name, p.display_name
  FROM sot.match_decisions md
  JOIN sot.people p ON p.person_id = md.top_candidate_person_id
  WHERE md.review_status = 'pending'
    AND (
      -- Name subset patterns (LMFM prefix, "colony cats" suffix, "Duplicate Report" prefix)
      LOWER(p.display_name) LIKE '%' || LOWER(REGEXP_REPLACE(md.incoming_name, '^(LMFM |Duplicate Report )', '', 'gi')) || '%'
      OR LOWER(REGEXP_REPLACE(md.incoming_name, '( colony cats| LMFM.*)$', '', 'gi')) LIKE '%' || LOWER(p.display_name) || '%'
      OR LOWER(md.incoming_name) LIKE '%' || LOWER(p.display_name) || '%'
      OR LOWER(p.display_name) LIKE '%' || LOWER(md.incoming_name) || '%'
      -- Typo/nickname patterns (same last name + similar first name)
      OR (
        LOWER(SPLIT_PART(md.incoming_name, ' ', 2)) = LOWER(SPLIT_PART(p.display_name, ' ', 2))
        AND SIMILARITY(
          LOWER(SPLIT_PART(md.incoming_name, ' ', 1)),
          LOWER(SPLIT_PART(p.display_name, ' ', 1))
        ) > 0.5
      )
      -- Kathryn/Katie case (maiden name)
      OR (md.incoming_name ILIKE '%Rasmussen%' AND p.display_name ILIKE '%Rasmussen%')
    )
    -- Exclude the clearly different names
    AND NOT (
      (md.incoming_name = 'Jason Harper' AND p.display_name = 'Cleophus McDonalds')
      OR (md.incoming_name = 'Judy Lear' AND p.display_name = 'Jorge Salazar')
      OR (md.incoming_name = 'Victoria Favela' AND p.display_name = 'Jessica Favela')
    )
)
UPDATE sot.match_decisions
SET
  review_status = 'approved',
  review_action = 'auto_approved',
  reviewed_at = NOW(),
  reviewed_by = 'MIG_2047',
  review_notes = 'Approved: name subset or typo/nickname pattern'
WHERE decision_id IN (SELECT decision_id FROM to_approve);

-- Step 3: Reject clearly different people sharing email
-- These should NOT be matched - they are different people
WITH to_reject AS (
  SELECT md.decision_id, md.incoming_email
  FROM sot.match_decisions md
  JOIN sot.people p ON p.person_id = md.top_candidate_person_id
  WHERE md.review_status = 'pending'
    AND (
      (md.incoming_name = 'Jason Harper' AND p.display_name = 'Cleophus McDonalds')
      OR (md.incoming_name = 'Judy Lear' AND p.display_name = 'Jorge Salazar')
      OR (md.incoming_name = 'Victoria Favela' AND p.display_name = 'Jessica Favela')
    )
)
UPDATE sot.match_decisions
SET
  review_status = 'rejected',
  review_action = 'rejected',
  reviewed_at = NOW(),
  reviewed_by = 'MIG_2047',
  review_notes = 'Rejected: different people sharing email - added to soft blacklist'
WHERE decision_id IN (SELECT decision_id FROM to_reject);

-- Step 4: Add shared emails to soft blacklist
-- These emails are shared by different people and should not be used for identity matching
INSERT INTO sot.soft_blacklist (identifier_type, identifier_norm, reason, created_by)
SELECT DISTINCT
  'email',
  LOWER(TRIM(md.incoming_email)),
  'Shared email: different people (' || md.incoming_name || ' vs ' || p.display_name || ')',
  'MIG_2047'
FROM sot.match_decisions md
JOIN sot.people p ON p.person_id = md.top_candidate_person_id
WHERE md.review_status = 'rejected'
  AND md.reviewed_by = 'MIG_2047'
  AND md.incoming_email IS NOT NULL
  AND TRIM(md.incoming_email) != ''
ON CONFLICT DO NOTHING;

-- Step 5: Check after state
SELECT 'AFTER: Reviews by status' as context, review_status, COUNT(*) as count
FROM sot.match_decisions
GROUP BY review_status
ORDER BY 2;

-- Step 6: Show what was soft-blacklisted
SELECT 'Soft-blacklisted emails' as context, identifier_norm, reason
FROM sot.soft_blacklist
WHERE created_by = 'MIG_2047';

-- Step 7: Show any remaining pending
SELECT 'Remaining pending' as context,
  md.incoming_name,
  p.display_name,
  ROUND(md.top_candidate_score::numeric, 2) as score
FROM sot.match_decisions md
LEFT JOIN sot.people p ON p.person_id = md.top_candidate_person_id
WHERE md.review_status = 'pending'
ORDER BY md.incoming_name;
