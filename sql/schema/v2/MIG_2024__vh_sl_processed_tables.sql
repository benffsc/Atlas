-- MIG_2024: VolunteerHub + ShelterLuv Processed Tables
-- Creates denormalized tables for VH volunteers and user groups
-- These mirror V1's trapper.volunteerhub_* tables for cron compatibility

-- ============================================================================
-- VolunteerHub User Groups
-- ============================================================================
CREATE TABLE IF NOT EXISTS source.volunteerhub_user_groups (
  user_group_uid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  parent_user_group_uid TEXT REFERENCES source.volunteerhub_user_groups(user_group_uid),

  -- Atlas role mapping
  atlas_role TEXT CHECK (atlas_role IS NULL OR atlas_role IN (
    'trapper', 'foster', 'volunteer', 'staff', 'caretaker', 'board_member', 'donor'
  )),
  atlas_trapper_type TEXT CHECK (atlas_trapper_type IS NULL OR atlas_trapper_type IN (
    'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper'
  )),
  is_approved_parent BOOLEAN NOT NULL DEFAULT FALSE,

  -- Sync metadata
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vh_user_groups_parent
  ON source.volunteerhub_user_groups(parent_user_group_uid);

-- ============================================================================
-- VolunteerHub Volunteers (Denormalized)
-- ============================================================================
CREATE TABLE IF NOT EXISTS source.volunteerhub_volunteers (
  volunteerhub_id TEXT PRIMARY KEY,

  -- Contact info
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,

  -- Generated/computed columns (stored for query efficiency)
  display_name TEXT GENERATED ALWAYS AS (
    COALESCE(
      NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
      email
    )
  ) STORED,
  phone_norm TEXT GENERATED ALWAYS AS (
    -- Simple US phone normalization: extract digits, keep last 10
    CASE
      WHEN LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10
      THEN RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10)
      ELSE NULL
    END
  ) STORED,
  email_norm TEXT GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED,

  -- Address
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  full_address TEXT GENERATED ALWAYS AS (
    NULLIF(TRIM(
      COALESCE(address, '') ||
      CASE WHEN city IS NOT NULL THEN ', ' || city ELSE '' END ||
      CASE WHEN state IS NOT NULL THEN ', ' || state ELSE '' END ||
      CASE WHEN zip IS NOT NULL THEN ' ' || zip ELSE '' END
    ), '')
  ) STORED,

  -- Volunteer status
  status TEXT,
  roles JSONB DEFAULT '[]'::jsonb,
  tags JSONB DEFAULT '[]'::jsonb,
  hours_logged NUMERIC DEFAULT 0,
  last_activity_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,

  -- Group memberships (denormalized array)
  user_group_uids TEXT[],

  -- Additional volunteer fields
  volunteer_notes TEXT,
  skills JSONB DEFAULT '{}'::jsonb,
  volunteer_availability TEXT,
  languages TEXT,
  pronouns TEXT,
  occupation TEXT,
  how_heard TEXT,
  volunteer_motivation TEXT,
  emergency_contact_raw TEXT,
  can_drive BOOLEAN,
  date_of_birth DATE,
  volunteer_experience TEXT,
  event_count INTEGER,
  last_login_at TIMESTAMPTZ,
  username TEXT,
  waiver_status TEXT,

  -- Raw API response
  raw_data JSONB,
  vh_version BIGINT,

  -- Sync metadata
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ,
  last_api_sync_at TIMESTAMPTZ,
  sync_status TEXT DEFAULT 'pending',
  sync_error TEXT,

  -- Person matching
  matched_person_id UUID REFERENCES sot.people(person_id),
  matched_at TIMESTAMPTZ,
  match_confidence NUMERIC,
  match_method TEXT,
  match_locked BOOLEAN DEFAULT FALSE,

  -- Active status
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for volunteerhub_volunteers
CREATE INDEX IF NOT EXISTS idx_vh_volunteers_email_norm
  ON source.volunteerhub_volunteers(email_norm);
CREATE INDEX IF NOT EXISTS idx_vh_volunteers_phone_norm
  ON source.volunteerhub_volunteers(phone_norm);
CREATE INDEX IF NOT EXISTS idx_vh_volunteers_status
  ON source.volunteerhub_volunteers(status);
CREATE INDEX IF NOT EXISTS idx_vh_volunteers_sync_status
  ON source.volunteerhub_volunteers(sync_status);
CREATE INDEX IF NOT EXISTS idx_vh_volunteers_matched
  ON source.volunteerhub_volunteers(matched_person_id)
  WHERE matched_person_id IS NOT NULL;

-- ============================================================================
-- VolunteerHub Group Memberships (Normalized)
-- Links volunteers to groups with temporal tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS source.volunteerhub_group_memberships (
  membership_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  volunteerhub_id TEXT NOT NULL REFERENCES source.volunteerhub_volunteers(volunteerhub_id),
  user_group_uid TEXT NOT NULL REFERENCES source.volunteerhub_user_groups(user_group_uid),

  -- Temporal tracking
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,

  -- Source tracking
  source TEXT NOT NULL DEFAULT 'api_sync',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint for active memberships
CREATE UNIQUE INDEX IF NOT EXISTS idx_vh_memberships_active
  ON source.volunteerhub_group_memberships(volunteerhub_id, user_group_uid)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vh_memberships_group
  ON source.volunteerhub_group_memberships(user_group_uid);
CREATE INDEX IF NOT EXISTS idx_vh_memberships_volunteer
  ON source.volunteerhub_group_memberships(volunteerhub_id);

-- ============================================================================
-- ShelterLuv Sync State
-- Tracks sync progress for incremental ShelterLuv syncs
-- ============================================================================
CREATE TABLE IF NOT EXISTS source.shelterluv_sync_state (
  sync_type TEXT PRIMARY KEY,
  last_sync_timestamp BIGINT,  -- Unix timestamp from SL API
  last_sync_at TIMESTAMPTZ,
  records_synced INTEGER DEFAULT 0,
  total_records INTEGER,
  error_message TEXT,
  last_check_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initialize sync state for ShelterLuv entity types
INSERT INTO source.shelterluv_sync_state (sync_type) VALUES
  ('animals'),
  ('people'),
  ('events'),
  ('intakes'),
  ('outcomes')
ON CONFLICT (sync_type) DO NOTHING;

-- ============================================================================
-- ShelterLuv Unmatched Fosters (for review queue)
-- ============================================================================
CREATE TABLE IF NOT EXISTS source.shelterluv_unmatched_fosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shelterluv_person_id TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  animal_count INTEGER DEFAULT 0,
  last_animal_at TIMESTAMPTZ,
  match_attempted_at TIMESTAMPTZ,
  match_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sl_unmatched_fosters_email
  ON source.shelterluv_unmatched_fosters(LOWER(email));

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT ALL ON source.volunteerhub_user_groups TO postgres;
GRANT ALL ON source.volunteerhub_volunteers TO postgres;
GRANT ALL ON source.volunteerhub_group_memberships TO postgres;
GRANT ALL ON source.shelterluv_sync_state TO postgres;
GRANT ALL ON source.shelterluv_unmatched_fosters TO postgres;

-- ============================================================================
-- Summary
-- ============================================================================
-- Created tables:
-- - source.volunteerhub_user_groups (group definitions)
-- - source.volunteerhub_volunteers (denormalized volunteer profiles)
-- - source.volunteerhub_group_memberships (volunteer <-> group links)
-- - source.shelterluv_sync_state (incremental sync tracking)
-- - source.shelterluv_unmatched_fosters (review queue)
