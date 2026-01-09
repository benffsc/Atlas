-- MIG_266__person_contact_overrides.sql
-- UI_243: Add phone override columns and contact provenance view
--
-- Additive-only migration. Safe to run multiple times.

-- ============================================================
-- 1) Add phone override columns to trapper.people
-- ============================================================

-- Secondary phone slot
ALTER TABLE trapper.people
ADD COLUMN IF NOT EXISTS phone_secondary TEXT NULL;

COMMENT ON COLUMN trapper.people.phone_secondary IS 'Secondary/alternate phone number for this person';

-- Track when phone was manually overridden
ALTER TABLE trapper.people
ADD COLUMN IF NOT EXISTS phone_override_updated_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN trapper.people.phone_override_updated_at IS 'Timestamp when phone was manually updated';

-- Track source of phone override
ALTER TABLE trapper.people
ADD COLUMN IF NOT EXISTS phone_override_source TEXT NULL;

COMMENT ON COLUMN trapper.people.phone_override_source IS 'Source of phone override: manual, import, etc';

-- ============================================================
-- 2) Create contact provenance view
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_person_contact_provenance AS
WITH clinichq_contacts AS (
  -- Aggregate ClinicHQ phones and emails for each person
  SELECT
    p.id AS person_id,
    ARRAY_AGG(DISTINCT ho.owner_phone ORDER BY ho.owner_phone)
      FILTER (WHERE ho.owner_phone IS NOT NULL AND LENGTH(ho.owner_phone) >= 10) AS clinichq_phones,
    ARRAY_AGG(DISTINCT ho.owner_cell_phone ORDER BY ho.owner_cell_phone)
      FILTER (WHERE ho.owner_cell_phone IS NOT NULL AND LENGTH(ho.owner_cell_phone) >= 10) AS clinichq_cell_phones,
    ARRAY_AGG(DISTINCT ho.owner_email ORDER BY ho.owner_email)
      FILTER (WHERE ho.owner_email IS NOT NULL AND ho.owner_email LIKE '%@%') AS clinichq_emails,
    MAX(ho.appt_date) AS last_seen_date,
    COUNT(DISTINCT ho.id) AS clinichq_record_count
  FROM trapper.people p
  LEFT JOIN trapper.clinichq_hist_owners ho ON (
    (p.email IS NOT NULL AND LOWER(ho.owner_email) = LOWER(p.email))
    OR (p.phone_normalized IS NOT NULL AND REGEXP_REPLACE(COALESCE(ho.owner_phone, ho.owner_cell_phone), '[^0-9]', '', 'g') = p.phone_normalized)
  )
  GROUP BY p.id
),
airtable_contacts AS (
  -- Aggregate Airtable phones/emails via person_source_link (if linked)
  SELECT
    psl.person_id,
    ARRAY[]::TEXT[] AS airtable_phones,  -- Placeholder: no direct Airtable phone in current schema
    ARRAY[]::TEXT[] AS airtable_emails   -- Placeholder: extend when Airtable sync is built
  FROM trapper.person_source_link psl
  WHERE psl.source_system = 'airtable'
  GROUP BY psl.person_id
)
SELECT
  p.id AS person_id,
  p.display_name,
  p.full_name,
  -- Canonical contact (truth layer)
  p.phone AS canonical_phone,
  p.phone_normalized,
  p.phone_secondary,
  p.email AS canonical_email,
  -- Override tracking
  p.phone_override_updated_at,
  p.phone_override_source,
  -- ClinicHQ provenance
  COALESCE(cc.clinichq_phones, ARRAY[]::TEXT[]) AS clinichq_phones,
  COALESCE(cc.clinichq_cell_phones, ARRAY[]::TEXT[]) AS clinichq_cell_phones,
  COALESCE(cc.clinichq_emails, ARRAY[]::TEXT[]) AS clinichq_emails,
  cc.last_seen_date,
  COALESCE(cc.clinichq_record_count, 0) AS clinichq_record_count,
  -- Airtable provenance (placeholder)
  COALESCE(ac.airtable_phones, ARRAY[]::TEXT[]) AS airtable_phones,
  COALESCE(ac.airtable_emails, ARRAY[]::TEXT[]) AS airtable_emails,
  -- Computed flags
  (p.phone_override_source = 'manual') AS has_manual_override,
  (cc.last_seen_date IS NOT NULL) AS has_clinichq_history
FROM trapper.people p
LEFT JOIN clinichq_contacts cc ON cc.person_id = p.id
LEFT JOIN airtable_contacts ac ON ac.person_id = p.id;

COMMENT ON VIEW trapper.v_person_contact_provenance IS
  'Contact provenance view showing canonical + source phones/emails for each person (UI_243)';

-- ============================================================
-- 3) Index for phone_secondary lookup (optional)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_people_phone_secondary
ON trapper.people(phone_secondary)
WHERE phone_secondary IS NOT NULL;

-- ============================================================
-- Done
-- ============================================================

SELECT 'MIG_266 applied successfully' AS status, NOW() AS applied_at;
