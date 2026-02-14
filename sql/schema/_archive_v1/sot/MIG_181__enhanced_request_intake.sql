-- MIG_181: Enhanced Request Intake Fields
-- Adds structured fields for better request triage while maintaining Airtable compatibility

BEGIN;

-- ============================================================================
-- ENUMS for structured fields (create if not exists)
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE trapper.permission_status AS ENUM (
        'yes', 'no', 'pending', 'not_needed', 'unknown'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE trapper.colony_duration AS ENUM (
        'under_1_month', '1_to_6_months', '6_to_24_months', 'over_2_years', 'unknown'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE trapper.eartip_estimate AS ENUM (
        'none', 'few', 'some', 'most', 'all', 'unknown'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE trapper.count_confidence AS ENUM (
        'exact', 'good_estimate', 'rough_guess', 'unknown'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE trapper.property_type AS ENUM (
        'private_home', 'apartment_complex', 'mobile_home_park',
        'business', 'farm_ranch', 'public_park', 'industrial', 'other'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- ADD NEW COLUMNS to sot_requests
-- ============================================================================

-- Permission & Access
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS permission_status trapper.permission_status DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS property_owner_contact TEXT,           -- Name/phone of owner/manager if known
ADD COLUMN IF NOT EXISTS access_notes TEXT,                     -- Gate codes, dogs, parking, etc.
ADD COLUMN IF NOT EXISTS traps_overnight_safe BOOLEAN,          -- Can traps be left overnight?
ADD COLUMN IF NOT EXISTS access_without_contact BOOLEAN;        -- Can trapper access without requester present?

-- Colony characteristics
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS property_type trapper.property_type,
ADD COLUMN IF NOT EXISTS colony_duration trapper.colony_duration DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS location_description TEXT;             -- "behind dumpster", "in barn", etc.

-- Ear-tip tracking (smart handling for small vs large colonies)
-- For small colonies (<=5): use eartip_count for exact number
-- For larger colonies: use eartip_estimate for percentage range
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS eartip_count INTEGER,                  -- Exact count if known (usually for small colonies)
ADD COLUMN IF NOT EXISTS eartip_estimate trapper.eartip_estimate DEFAULT 'unknown';

-- Count confidence
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS count_confidence trapper.count_confidence DEFAULT 'unknown';

-- Kitten details (more structured than just has_kittens boolean)
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS kitten_count INTEGER,                  -- How many kittens
ADD COLUMN IF NOT EXISTS kitten_age_weeks INTEGER;              -- Approximate age in weeks

-- Feeding patterns
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS is_being_fed BOOLEAN,
ADD COLUMN IF NOT EXISTS feeder_name TEXT,                      -- Who feeds them
ADD COLUMN IF NOT EXISTS feeding_schedule TEXT,                 -- "7am and 5pm daily", "random", etc.
ADD COLUMN IF NOT EXISTS best_times_seen TEXT;                  -- When cats are most visible

-- Urgency (structured)
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS urgency_reasons TEXT[],                -- Array: 'kittens', 'sick_injured', 'eviction', 'threat', etc.
ADD COLUMN IF NOT EXISTS urgency_deadline DATE,                 -- If there's a hard deadline (moving date, etc.)
ADD COLUMN IF NOT EXISTS urgency_notes TEXT;                    -- Free text for context

-- Contact preferences (expanded)
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS best_contact_times TEXT;               -- "mornings", "after 5pm", etc.

-- ============================================================================
-- COMPUTED COLUMNS / HELPERS
-- ============================================================================

-- Function to compute a "readiness score" for Beacon
-- Higher = more ready to act on
CREATE OR REPLACE FUNCTION trapper.compute_request_readiness(r trapper.sot_requests)
RETURNS INTEGER AS $$
DECLARE
    score INTEGER := 0;
BEGIN
    -- Permission granted = +30
    IF r.permission_status = 'yes' OR r.permission_status = 'not_needed' THEN
        score := score + 30;
    ELSIF r.permission_status = 'pending' THEN
        score := score + 10;
    END IF;

    -- Access info provided = +15
    IF r.access_notes IS NOT NULL AND r.access_notes != '' THEN
        score := score + 15;
    END IF;

    -- Traps safe overnight = +10
    IF r.traps_overnight_safe = TRUE THEN
        score := score + 10;
    END IF;

    -- Feeding info (helps with trapping) = +10
    IF r.is_being_fed = TRUE AND r.feeding_schedule IS NOT NULL THEN
        score := score + 10;
    END IF;

    -- Good count confidence = +10
    IF r.count_confidence IN ('exact', 'good_estimate') THEN
        score := score + 10;
    END IF;

    -- Has contact info = +15
    IF r.requester_person_id IS NOT NULL THEN
        score := score + 15;
    END IF;

    -- Has place linked = +10
    IF r.place_id IS NOT NULL THEN
        score := score + 10;
    END IF;

    RETURN score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to compute "urgency score" for Beacon
-- Higher = more urgent
CREATE OR REPLACE FUNCTION trapper.compute_request_urgency(r trapper.sot_requests)
RETURNS INTEGER AS $$
DECLARE
    score INTEGER := 0;
BEGIN
    -- Kittens present = +25
    IF r.has_kittens = TRUE OR 'kittens' = ANY(r.urgency_reasons) THEN
        score := score + 25;
    END IF;

    -- Young kittens (< 8 weeks) = additional +15
    IF r.kitten_age_weeks IS NOT NULL AND r.kitten_age_weeks < 8 THEN
        score := score + 15;
    END IF;

    -- Sick/injured = +20
    IF 'sick_injured' = ANY(r.urgency_reasons) THEN
        score := score + 20;
    END IF;

    -- Threat/at risk = +25
    IF 'threat' = ANY(r.urgency_reasons) OR 'poison' = ANY(r.urgency_reasons) THEN
        score := score + 25;
    END IF;

    -- Eviction/moving deadline = +20
    IF 'eviction' = ANY(r.urgency_reasons) OR 'moving' = ANY(r.urgency_reasons) THEN
        score := score + 20;
    END IF;

    -- Hard deadline approaching = +15 to +30 based on proximity
    IF r.urgency_deadline IS NOT NULL THEN
        IF r.urgency_deadline <= CURRENT_DATE + INTERVAL '7 days' THEN
            score := score + 30;
        ELSIF r.urgency_deadline <= CURRENT_DATE + INTERVAL '30 days' THEN
            score := score + 15;
        END IF;
    END IF;

    -- Large unfixed colony (>10 cats, few ear-tipped) = +15
    IF r.estimated_cat_count > 10 AND r.eartip_estimate IN ('none', 'few') THEN
        score := score + 15;
    END IF;

    -- Priority override
    IF r.priority = 'urgent' THEN
        score := score + 20;
    END IF;

    RETURN score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- VIEW for Beacon-ready request data
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_request_beacon AS
SELECT
    r.request_id,
    r.status,
    r.priority,
    r.summary,
    r.estimated_cat_count,
    r.has_kittens,
    r.kitten_count,
    r.kitten_age_weeks,

    -- Ear-tip info (computed display)
    CASE
        WHEN r.eartip_count IS NOT NULL THEN r.eartip_count || ' ear-tipped'
        WHEN r.eartip_estimate IS NOT NULL AND r.eartip_estimate != 'unknown' THEN r.eartip_estimate::TEXT
        ELSE 'unknown'
    END as eartip_display,
    r.eartip_count,
    r.eartip_estimate,

    -- Colony info
    r.colony_duration,
    r.count_confidence,
    r.property_type,
    r.location_description,

    -- Readiness
    r.permission_status,
    r.traps_overnight_safe,
    r.access_without_contact,
    r.access_notes,

    -- Feeding
    r.is_being_fed,
    r.feeding_schedule,
    r.best_times_seen,

    -- Urgency
    r.urgency_reasons,
    r.urgency_deadline,

    -- Computed scores for Beacon
    trapper.compute_request_readiness(r) as readiness_score,
    trapper.compute_request_urgency(r) as urgency_score,

    -- Combined priority score (urgency * readiness factor)
    (trapper.compute_request_urgency(r) *
     GREATEST(0.5, trapper.compute_request_readiness(r)::NUMERIC / 100)) as beacon_priority,

    -- Place info
    r.place_id,
    p.display_name as place_name,
    p.formatted_address,

    -- Requester info
    r.requester_person_id,
    per.display_name as requester_name,

    -- Dates
    r.source_created_at,
    r.created_at,
    r.updated_at
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
WHERE r.status NOT IN ('completed', 'cancelled');

-- ============================================================================
-- INDEXES for new columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_requests_permission ON trapper.sot_requests(permission_status);
CREATE INDEX IF NOT EXISTS idx_requests_urgency_deadline ON trapper.sot_requests(urgency_deadline) WHERE urgency_deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_has_kittens ON trapper.sot_requests(has_kittens) WHERE has_kittens = TRUE;

COMMIT;
