-- MIG_2032: Archive duplicate intake submissions
-- Date: 2026-02-13
-- Issue: Historical bulk import (2025-05-30) created duplicates
--
-- Strategy: Keep the EARLIEST submission per (email, first_name, cats_address, submitted_minute)
-- Mark others as archived with note

-- First, identify duplicates (for logging)
WITH duplicates AS (
  SELECT
    email,
    first_name,
    cats_address,
    DATE_TRUNC('minute', submitted_at) as submitted_minute,
    COUNT(*) as cnt,
    ARRAY_AGG(submission_id ORDER BY submitted_at) as submission_ids
  FROM ops.intake_submissions
  WHERE email IS NOT NULL
  GROUP BY email, first_name, cats_address, DATE_TRUNC('minute', submitted_at)
  HAVING COUNT(*) > 1
)
SELECT
  'Found ' || SUM(cnt - 1) || ' duplicate submissions to archive across ' || COUNT(*) || ' groups' as summary
FROM duplicates;

-- Archive duplicates (keep the first, archive the rest)
WITH ranked AS (
  SELECT
    submission_id,
    email,
    first_name,
    cats_address,
    submitted_at,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(email), LOWER(first_name), LOWER(TRIM(cats_address)), DATE_TRUNC('minute', submitted_at)
      ORDER BY submitted_at
    ) as rn
  FROM ops.intake_submissions
  WHERE email IS NOT NULL
),
to_archive AS (
  SELECT submission_id
  FROM ranked
  WHERE rn > 1
)
UPDATE ops.intake_submissions
SET
  submission_status = 'archived',
  review_notes = COALESCE(review_notes, '') || ' [Auto-archived: duplicate of earlier submission, MIG_2032]'
WHERE submission_id IN (SELECT submission_id FROM to_archive)
  AND (submission_status IS NULL OR submission_status NOT IN ('archived', 'closed'));

-- Also handle phone-only duplicates
WITH ranked_phone AS (
  SELECT
    submission_id,
    phone,
    first_name,
    cats_address,
    submitted_at,
    ROW_NUMBER() OVER (
      PARTITION BY REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), LOWER(first_name), LOWER(TRIM(cats_address)), DATE_TRUNC('minute', submitted_at)
      ORDER BY submitted_at
    ) as rn
  FROM ops.intake_submissions
  WHERE phone IS NOT NULL AND email IS NULL
),
to_archive_phone AS (
  SELECT submission_id
  FROM ranked_phone
  WHERE rn > 1
)
UPDATE ops.intake_submissions
SET
  submission_status = 'archived',
  review_notes = COALESCE(review_notes, '') || ' [Auto-archived: duplicate of earlier submission, MIG_2032]'
WHERE submission_id IN (SELECT submission_id FROM to_archive_phone)
  AND (submission_status IS NULL OR submission_status NOT IN ('archived', 'closed'));

-- Verify
SELECT
  submission_status,
  COUNT(*) as cnt
FROM ops.intake_submissions
GROUP BY submission_status
ORDER BY cnt DESC;
