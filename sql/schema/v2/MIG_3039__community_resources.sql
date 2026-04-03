-- MIG_3039: Community Resources Registry
--
-- Centralized table for all community resources displayed in the kiosk
-- and website. Replaces hardcoded resource cards in tippy-tree.ts and
-- clinic-cat-tree.ts.
--
-- Key features:
-- - Admin-editable (no code deploy for phone/address changes)
-- - Scrape-verified (cron job checks URLs and flags changes)
-- - Category-based (pet_spay, emergency_vet, ffsc, general)
-- - Change tracking (scrape_diff stores what changed)
--
-- FFS-1099 (Digital Lobby Kiosk)

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ops.community_resources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,           -- e.g., 'sonoma_humane', 'vca_petcare'
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,                  -- 'pet_spay', 'emergency_vet', 'ffsc', 'general'
  description     TEXT,
  phone           TEXT,
  address         TEXT,
  hours           TEXT,
  website_url     TEXT,                           -- public-facing URL
  scrape_url      TEXT,                           -- URL to scrape for verification
  icon            TEXT NOT NULL DEFAULT 'heart',
  urgency         TEXT NOT NULL DEFAULT 'info',   -- 'emergency', 'soon', 'info'
  display_order   INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,

  -- Verification tracking
  last_verified_at   TIMESTAMPTZ,                 -- last time a human confirmed info
  last_verified_by   TEXT,
  verify_by          TIMESTAMPTZ,                 -- reminder: re-verify by this date

  -- Scrape tracking
  last_scraped_at    TIMESTAMPTZ,
  scrape_status      TEXT DEFAULT 'pending',      -- 'ok', 'changed', 'error', 'unreachable', 'pending'
  scrape_diff        JSONB,                       -- { field: { old, new } } when changes detected
  scrape_phones_found TEXT[],                     -- all phone numbers found on the page
  scrape_error       TEXT,                        -- error message if scrape failed

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_resources_category
  ON ops.community_resources (category) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_community_resources_scrape_status
  ON ops.community_resources (scrape_status) WHERE scrape_url IS NOT NULL;

-- ── Seed Data ────────────────────────────────────────────────────────────────

INSERT INTO ops.community_resources (slug, name, category, description, phone, address, hours, website_url, scrape_url, icon, urgency, display_order, last_verified_at)
VALUES
  -- FFSC (primary)
  ('ffsc', 'Forgotten Felines of Sonoma County', 'ffsc',
   'Free spay/neuter for community cats through our Trap-Neuter-Return program.',
   '(707) 576-7999', '1814 Empire Industrial Ct, Santa Rosa, CA 95404', NULL,
   'https://www.forgottenfelines.com', 'https://www.forgottenfelines.com',
   'heart', 'info', 0, NOW()),

  -- Pet spay/neuter resources
  ('humane_society_soco', 'Humane Society of Sonoma County', 'pet_spay',
   'Low-cost spay/neuter for owned pets. Appointment only.',
   '(707) 284-3499', '5345 Hwy 12 W, Santa Rosa, CA 95407', 'Scheduling: Mon-Fri 10am-2pm',
   'https://humanesocietysoco.org', 'https://humanesocietysoco.org/spay-neuter/',
   'heart-handshake', 'info', 1, NOW()),

  ('love_me_fix_me', 'Love Me, Fix Me Voucher Program', 'pet_spay',
   'Sonoma County''s low-cost spay/neuter voucher program. Up to 2 vouchers per household per year.',
   '(707) 565-7100', NULL, NULL,
   'https://sonomacounty.ca.gov/animal-services', 'https://sonomacounty.ca.gov/animal-services',
   'heart-pulse', 'info', 2, NOW()),

  ('pets_lifeline', 'Pets Lifeline', 'pet_spay',
   'Low-cost community spay/neuter clinic with sliding scale.',
   '(707) 996-4577', '19686 Eighth Street East, Sonoma, CA 95476', NULL,
   'https://www.petslifeline.org', 'https://www.petslifeline.org',
   'heart', 'info', 3, NOW()),

  ('esperanza_truck', 'Esperanza Spay & Neuter Truck', 'pet_spay',
   'Mobile low-cost spay/neuter service throughout Sonoma County. Run by Compassion Without Borders.',
   '(707) 304-6238', NULL, NULL,
   'https://www.cwob.org', 'https://www.cwob.org',
   'truck', 'info', 4, NOW()),

  -- Emergency vets
  ('vca_petcare_east', 'VCA PetCare East Veterinary Hospital', 'emergency_vet',
   '24-hour emergency veterinary hospital.',
   '(707) 579-3900', '2425 Mendocino Ave, Santa Rosa, CA 95403', 'Open 24/7',
   'https://vcahospitals.com/petcare-east', 'https://vcahospitals.com/petcare-east',
   'siren', 'emergency', 1, NOW()),

  ('truvet_emergency', 'TruVet Specialty and Emergency Hospital', 'emergency_vet',
   '24-hour emergency and specialty hospital.',
   '(707) 787-5340', '2620 Lakeville Hwy, Bldg D, Petaluma, CA 94954', 'Open 24/7',
   'https://truvethospital.com', 'https://truvethospital.com',
   'siren', 'emergency', 2, NOW()),

  ('emergency_animal_hospital', 'Emergency Animal Hospital of Santa Rosa', 'emergency_vet',
   'After-hours emergency care (weekday evenings, weekends/holidays 24hr).',
   '(707) 542-4012', '1946 Santa Rosa Ave, Santa Rosa, CA 95407',
   'Mon-Fri 6PM-8AM, Sat-Sun & Holidays 24hr',
   NULL, NULL,
   'siren', 'emergency', 3, NOW()),

  -- Additional pet spay/neuter
  ('rohnert_park_animal_shelter', 'Rohnert Park Animal Shelter', 'pet_spay',
   'Low-income free monthly spay/neuter clinics. Rohnert Park residents prioritized.',
   '(707) 588-3531', '301 J Rogers Ln, Rohnert Park, CA 94928', NULL,
   'https://www.rpcity.org/departments/public-safety/animal-services', NULL,
   'heart-handshake', 'info', 5, NOW()),

  -- General resources
  ('dogwood_rescue', 'Dogwood Animal Rescue', 'general',
   'Free and low-cost spay/neuter assistance for rural Sonoma County areas.',
   '(707) 799-9957', NULL, NULL,
   NULL, NULL,
   'heart', 'info', 1, NOW()),

  ('twenty_tails_rescue', 'Twenty Tails Rescue', 'general',
   'TNR assistance and barn cat program for Sonoma County.',
   NULL, NULL, NULL,
   NULL, NULL,
   'heart', 'info', 2, NOW())

ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  phone = EXCLUDED.phone,
  address = EXCLUDED.address,
  hours = EXCLUDED.hours,
  website_url = EXCLUDED.website_url,
  scrape_url = EXCLUDED.scrape_url,
  updated_at = NOW();

-- Set verify_by to 90 days from now for all resources
UPDATE ops.community_resources
SET verify_by = NOW() + INTERVAL '90 days'
WHERE verify_by IS NULL;
