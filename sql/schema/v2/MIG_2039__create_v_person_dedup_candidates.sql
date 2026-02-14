-- MIG_2039: Create sot.v_person_dedup_candidates view for Person Dedup page
-- Date: 2026-02-13
-- Issue: Person dedup admin page needs candidates view

-- Main dedup candidates view
-- Uses person_identifiers to find potential duplicates with shared email/phone
CREATE OR REPLACE VIEW sot.v_person_dedup_candidates AS
WITH shared_identifiers AS (
  -- Find identifiers shared by multiple people
  SELECT
    pi1.id_value_norm AS identifier,
    pi1.id_type,
    pi1.person_id AS person1_id,
    pi2.person_id AS person2_id,
    LEAST(pi1.person_id, pi2.person_id) AS canonical_person_id,
    GREATEST(pi1.person_id, pi2.person_id) AS duplicate_person_id
  FROM sot.person_identifiers pi1
  JOIN sot.person_identifiers pi2
    ON pi1.id_value_norm = pi2.id_value_norm
    AND pi1.id_type = pi2.id_type
    AND pi1.person_id < pi2.person_id
    AND pi1.confidence >= 0.5
    AND pi2.confidence >= 0.5
  -- Exclude soft-blacklisted identifiers
  WHERE NOT EXISTS (
    SELECT 1 FROM sot.soft_blacklist sb
    WHERE sb.identifier_norm = pi1.id_value_norm
      AND sb.identifier_type = pi1.id_type
  )
),
candidate_pairs AS (
  SELECT DISTINCT
    si.canonical_person_id,
    si.duplicate_person_id,
    MAX(CASE WHEN si.id_type = 'email' THEN si.identifier END) AS shared_email,
    MAX(CASE WHEN si.id_type = 'phone' THEN si.identifier END) AS shared_phone
  FROM shared_identifiers si
  GROUP BY si.canonical_person_id, si.duplicate_person_id
)
SELECT
  cp.canonical_person_id,
  cp.duplicate_person_id,
  -- Match tier: 1 = same email+phone, 2 = same email, 3 = same phone, 4 = name match, 5 = fuzzy
  CASE
    WHEN cp.shared_email IS NOT NULL AND cp.shared_phone IS NOT NULL THEN 1
    WHEN cp.shared_email IS NOT NULL THEN 2
    WHEN cp.shared_phone IS NOT NULL THEN 3
    ELSE 5
  END AS match_tier,
  cp.shared_email,
  cp.shared_phone,
  COALESCE(p1.display_name, p1.first_name || ' ' || p1.last_name) AS canonical_name,
  COALESCE(p2.display_name, p2.first_name || ' ' || p2.last_name) AS duplicate_name,
  -- Name similarity (simple approach - exact match = 1.0, else 0.0 for now)
  CASE
    WHEN LOWER(COALESCE(p1.display_name, p1.first_name || ' ' || p1.last_name)) =
         LOWER(COALESCE(p2.display_name, p2.first_name || ' ' || p2.last_name))
    THEN 1.0
    ELSE 0.5
  END::numeric AS name_similarity,
  p1.created_at AS canonical_created_at,
  p2.created_at AS duplicate_created_at
FROM candidate_pairs cp
JOIN sot.people p1 ON p1.person_id = cp.canonical_person_id AND p1.merged_into_person_id IS NULL
JOIN sot.people p2 ON p2.person_id = cp.duplicate_person_id AND p2.merged_into_person_id IS NULL
-- Exclude already-processed pairs from match_decisions
WHERE NOT EXISTS (
  SELECT 1 FROM sot.match_decisions md
  WHERE md.resulting_person_id = cp.canonical_person_id
    AND md.top_candidate_person_id = cp.duplicate_person_id
    AND md.review_status = 'approved'
);

-- Tier 4 pending review view (same-name-same-address candidates)
CREATE OR REPLACE VIEW ops.v_tier4_pending_review AS
SELECT
  md.decision_id AS duplicate_id,
  md.top_candidate_person_id AS existing_person_id,
  md.resulting_person_id AS potential_match_id,
  md.top_candidate_score AS name_similarity,
  md.created_at AS detected_at,
  COALESCE(p_existing.display_name, p_existing.first_name || ' ' || p_existing.last_name) AS existing_name,
  p_existing.created_at AS existing_created_at,
  (SELECT array_agg(pi.id_value_norm) FROM sot.person_identifiers pi
   WHERE pi.person_id = md.top_candidate_person_id AND pi.id_type = 'email' AND pi.confidence >= 0.5) AS existing_emails,
  (SELECT array_agg(pi.id_value_norm) FROM sot.person_identifiers pi
   WHERE pi.person_id = md.top_candidate_person_id AND pi.id_type = 'phone' AND pi.confidence >= 0.5) AS existing_phones,
  md.incoming_name AS new_name,
  md.source_system AS new_source,
  md.incoming_address AS shared_address,
  -- Stats for existing person
  (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = md.top_candidate_person_id)::int AS existing_cat_count,
  (SELECT COUNT(*) FROM ops.requests r WHERE r.requester_person_id = md.top_candidate_person_id)::int AS existing_request_count,
  (SELECT COUNT(*) FROM ops.appointments a WHERE a.person_id = md.top_candidate_person_id OR a.resolved_person_id = md.top_candidate_person_id)::int AS existing_appointment_count,
  md.incoming_email,
  md.incoming_phone,
  md.incoming_address,
  EXTRACT(EPOCH FROM (NOW() - md.created_at)) / 3600 AS hours_in_queue,
  md.decision_reason,
  md.review_status AS status
FROM sot.match_decisions md
LEFT JOIN sot.people p_existing ON p_existing.person_id = md.top_candidate_person_id AND p_existing.merged_into_person_id IS NULL
WHERE md.decision_type IN ('review_required', 'review_pending', 'tier4')
  AND md.review_status = 'pending';
