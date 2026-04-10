-- MIG_3039: Partner Orgs & Animals
--
-- Tracks animals from partner organizations (e.g., Marin Humane/NBAS) that FFSC
-- helps with spay/neuter but are NOT colony cats. Critical for Beacon analytics:
-- these animals must be excluded from colony population models.
--
-- Data model:
--   ops.partner_orgs → the organization
--   ops.partner_animals → individual animals needing services
--   ops.partner_animal_documents → attached PDFs/records
--
-- Seeded with 31 NBAS foster animals from the 03/31/2026 foster report.

BEGIN;

-- ============================================================================
-- Table: ops.partner_orgs
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.partner_orgs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,                -- "Marin Humane / North Bay Animal Services"
  short_name  TEXT NOT NULL,                -- "NBAS"
  phone       TEXT,
  address     TEXT,
  website     TEXT,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.partner_orgs IS 'Partner organizations FFSC works with for spay/neuter services. These animals are NOT colony cats.';

-- ============================================================================
-- Table: ops.partner_animals
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.partner_animals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_org_id      UUID NOT NULL REFERENCES ops.partner_orgs(id),
  external_animal_id  TEXT,                  -- e.g. "A0059542790" (ShelterLuv ID)
  name                TEXT,
  sex                 TEXT,                  -- M/F
  species             TEXT NOT NULL DEFAULT 'cat',
  breed               TEXT,
  colors              TEXT,
  dob                 DATE,
  microchip           TEXT,
  altered             BOOLEAN NOT NULL DEFAULT FALSE,

  -- Procedure tracking
  procedure_needed    TEXT,                  -- Spay/Neuter/N/A
  priority            TEXT,                  -- Red/Blue/Yellow/Pink
  priority_meaning    TEXT,                  -- "Unable to make contact", etc.
  status              TEXT NOT NULL DEFAULT 'needed',
  -- status values: needed, scheduled, completed, already_done, foster_handling, cancelled

  -- Foster contact
  foster_name         TEXT,
  foster_phone        TEXT,
  foster_email        TEXT,
  foster_address      TEXT,
  foster_person_id    TEXT,                  -- external system person ID

  -- Placement info
  sub_location        TEXT,                  -- "Foster to Adopt Home", "Foster Home"
  intake_origin       TEXT,
  intake_location     TEXT,

  -- Tracking
  contact_notes       TEXT,                  -- running log of contact attempts
  scheduled_date      DATE,
  completed_date      DATE,
  completed_notes     TEXT,

  -- Beacon integration: explicitly NOT a colony cat
  is_colony_cat       BOOLEAN NOT NULL DEFAULT FALSE,

  raw_data            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_animals_org ON ops.partner_animals (partner_org_id);
CREATE INDEX IF NOT EXISTS idx_partner_animals_status ON ops.partner_animals (status);
CREATE INDEX IF NOT EXISTS idx_partner_animals_priority ON ops.partner_animals (priority);
CREATE INDEX IF NOT EXISTS idx_partner_animals_external_id ON ops.partner_animals (external_animal_id);

COMMENT ON TABLE ops.partner_animals IS 'Animals from partner orgs needing FFSC services. is_colony_cat=FALSE excludes from Beacon colony analytics.';

-- ============================================================================
-- Table: ops.partner_animal_documents
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.partner_animal_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_animal_id   UUID NOT NULL REFERENCES ops.partner_animals(id) ON DELETE CASCADE,
  document_type       TEXT NOT NULL,         -- medical_summary, foster_contract, animal_view, intake, photo
  filename            TEXT NOT NULL,
  file_path           TEXT,                  -- storage path or URL
  extracted_data      JSONB,                 -- LLM-extracted structured data from PDF
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_docs_animal ON ops.partner_animal_documents (partner_animal_id);

COMMENT ON TABLE ops.partner_animal_documents IS 'PDF documents attached to partner animals (medical summaries, foster contracts, etc.)';

-- ============================================================================
-- Seed: Marin Humane / NBAS
-- ============================================================================

INSERT INTO ops.partner_orgs (id, name, short_name, phone, address, website, notes)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Marin Humane / North Bay Animal Services',
  'NBAS',
  '707-762-6227',
  '840 Hopper Street, Petaluma, CA 94952',
  'https://northbayanimalservices.org/',
  'Took over Petaluma shelter. FFSC helping get their foster cats spayed/neutered. 31 active fosters as of 03/31/2026.'
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- Seed: 31 NBAS foster animals
-- ============================================================================

INSERT INTO ops.partner_animals (
  partner_org_id, external_animal_id, name, sex, breed, colors, dob, microchip,
  procedure_needed, priority, priority_meaning, status,
  foster_name, foster_phone, foster_email, foster_address, foster_person_id,
  sub_location, intake_origin, intake_location, contact_notes
) VALUES
-- 1. Latte
('a0000000-0000-0000-0000-000000000001', 'A0054553000', 'Latte', 'F', 'Domestic Shorthair/Mix', 'Black', '2023-10-02', '941010001677506',
 'Spay', 'Red', 'Unable to make contact', 'needed',
 NULL, NULL, NULL, NULL, NULL,
 'Foster to Adopt Home', 'Stray/Born in Care', 'Petaluma',
 'In foster 2+ years (expected return 2/3/2024). 2/22/25: LMOM on daughter''s phone.'),
-- 2. Marla
('a0000000-0000-0000-0000-000000000001', 'A0056341499', 'Marla', 'F', 'Domestic Shorthair/Mix', 'Black/Orange', '2024-06-20', '941010003260635',
 'Spay', 'Red', 'Unable to make contact', 'needed',
 NULL, NULL, NULL, NULL, NULL,
 'Foster to Adopt Home', 'Seized/Custody', 'Arata Ln Windsor',
 '7/17/25: LMOM on both ph#s for spay. FTA reports possible asthma + blood in urine (heat). Seized litter with Dottie.'),
-- 3. Dottie
('a0000000-0000-0000-0000-000000000001', 'A0056341508', 'Dottie', 'F', 'Domestic Shorthair/Mix', 'Black/Orange', '2024-06-20', '941010003235792',
 'Spay', 'Red', 'Unable to make contact', 'needed',
 NULL, NULL, NULL, NULL, NULL,
 'Foster to Adopt Home', 'Seized/Custody', 'Arata Ln Windsor',
 '7/17/25: LMOM. 1/11/25: FTA came in re return date — doesn''t want to return. Language barrier. Seized litter with Marla.'),
-- 4. Jelly Bean
('a0000000-0000-0000-0000-000000000001', 'A0056682764', 'Jelly Bean', 'M', 'Domestic Shorthair/Mix', 'Brown', '2024-07-02', '941010003429815',
 'Neuter', 'Blue', 'Foster needs to provide medical', 'needed',
 'Erin Bishop', '707-328-4207', 'ladybish471@yahoo.com', '1648 Shenandoah Ct Petaluma CA 94954', 'P0048454092',
 'Foster to Adopt Home', 'Transfer In', 'Olympic Dr Clearlake',
 'Same foster as Chamomile (who already got spayed at own vet). Good contact info.'),
-- 5. Sammy
('a0000000-0000-0000-0000-000000000001', 'A0058319953', 'Sammy', 'M', 'Domestic Shorthair/Mix', 'Brown/Black', '2025-03-12', '933000321249954',
 'Neuter', 'Red', 'Unable to make contact', 'needed',
 'Daniela Nolasco', '628-209-9715', 'Daniela.N12@gmail.com', '82 Roundwalk Cir Petaluma CA 94952', 'P0047672017',
 'Foster to Adopt Home', 'Stray', 'Stomper Dr Windsor',
 '6/28-8/6/25: Ph# not in service. 10/4/25: Wrong ph# in system — corrected. 11/14/25: LMOM.'),
-- 6. Chicken
('a0000000-0000-0000-0000-000000000001', 'A0058348085', 'Chicken', 'F', 'Domestic Medium Hair/Mix', 'Black', '2025-03-24', NULL,
 'Spay', 'Blue', 'Foster needs to provide medical', 'needed',
 'Valerie Pustorino', '707-738-1051', 'saxophonegirl426@gmail.com', '294 Judith Ln Windsor CA 95492', 'P0041265280',
 'Foster to Adopt Home', 'Transfer In', '23 Ave Clearlake',
 'Same foster as Skipper + Porkchop (3 cats).'),
-- 7. Porkchop
('a0000000-0000-0000-0000-000000000001', 'A0058348101', 'Porkchop', 'F', 'Domestic Medium Hair/Mix', 'Black', '2025-03-24', '933000321249966',
 'Spay', 'Blue', 'Foster needs to provide medical', 'needed',
 'Valerie Pustorino', '707-738-1051', 'saxophonegirl426@gmail.com', '294 Judith Ln Windsor CA 95492', 'P0041265280',
 'Foster to Adopt Home', 'Transfer In', '23 Ave Clearlake',
 'Same foster as Skipper + Chicken. 7/19/25: One kitten sick.'),
-- 8. Skipper
('a0000000-0000-0000-0000-000000000001', 'A0058377134', 'Skipper', 'F', 'Domestic Shorthair/Mix', 'Black', '2025-03-21', '933000321249968',
 'Spay', 'Blue', 'Foster needs to provide medical', 'needed',
 'Valerie Pustorino', '707-738-1051', 'saxophonegirl426@gmail.com', '294 Judith Ln Windsor CA 95492', 'P0041265280',
 'Foster to Adopt Home', 'Transfer In', '3000 Covelo St Clearlake',
 'Same foster as Chicken + Porkchop. Contract 6/28/2025.'),
-- 9. Spicy
('a0000000-0000-0000-0000-000000000001', 'A0058486569', 'Spicy', 'F', 'Domestic Medium Hair/Mix', 'Black/Orange', '2025-05-07', '933000321259090',
 'Spay', 'Red', 'Unable to make contact', 'needed',
 NULL, NULL, NULL, NULL, NULL,
 'Foster to Adopt Home', 'Transfer In', '14000 Uhl Ave Clearlake',
 '10/7 + 11/14/25: LMOM about spay. Spay scheduled 1/22/26. Transfer from Clearlake.'),
-- 10. Jacob
('a0000000-0000-0000-0000-000000000001', 'A0058503413', 'Jacob', 'M', 'Domestic Shorthair/Mix', 'Black', '2025-03-16', '933000321254051',
 'Neuter', 'Blue', 'Foster needs to provide medical', 'needed',
 NULL, NULL, NULL, NULL, 'P0047647802',
 'Foster to Adopt Home', 'Owner Surrender', '830 D St Petaluma',
 'Bonded pair with Stanley. 7/3/25: LMOM about booster. Surrendered by Gwen Fritts (707) 241-6709.'),
-- 11. Stanley
('a0000000-0000-0000-0000-000000000001', 'A0058503417', 'Stanley', 'M', 'Domestic Shorthair/Mix', 'Black', '2025-03-16', '933000321254064',
 'Neuter', 'Blue', 'Foster needs to provide medical', 'needed',
 NULL, NULL, NULL, NULL, 'P0047647802',
 'Foster to Adopt Home', 'Owner Surrender', '830 D St Petaluma',
 'Bonded pair with Jacob. 7/3/25: LMOM about booster. Surrendered by Gwen Fritts (707) 241-6709.'),
-- 12. Mel
('a0000000-0000-0000-0000-000000000001', 'A0058609999', 'Mel', 'F', 'Domestic Shorthair/Mix', 'Black/Brown', '2025-05-25', '933000321259089',
 'Spay', NULL, NULL, 'needed',
 NULL, NULL, NULL, NULL, NULL,
 'Foster to Adopt Home', NULL, NULL,
 'No records scanned — fill in priority and contact from physical printout.'),
-- 13. Artie (Meatball)
('a0000000-0000-0000-0000-000000000001', 'A0058860262', 'Artie (Meatball)', 'M', 'Domestic Shorthair/Mix', 'White/Brown', '2025-05-15', '933000321259093',
 'Neuter', 'Red', 'Unable to make contact', 'needed',
 NULL, NULL, NULL, NULL, 'P0047993575',
 'Foster to Adopt Home', 'Stray', 'Caulfield Ln & Daniel Dr Petaluma',
 '3/11/26: No VM set up. 2/17/26: NO-SHOWED neuter. Multiple LMOM since 8/25.'),
-- 14. Molly
('a0000000-0000-0000-0000-000000000001', 'A0058860796', 'Molly', 'F', 'Domestic Shorthair/Mix', 'Grey/White', '2025-04-14', '985141008849322',
 'N/A', 'Pink', 'Need to finalize adoption', 'already_done',
 'Bryan C', '(717) 830-6160', NULL, '2560 Pleasant Hill Rd Petaluma CA 94952', 'P0048652832',
 'Foster to Adopt Home', 'Return', 'Lakeshore Dr Clearlake',
 'ALREADY SPAYED. FTA won''t finalize without combo test. 12/2/25: Return call failed — all circuits busy.'),
-- 15. Akame
('a0000000-0000-0000-0000-000000000001', 'A0058900495', 'Akame', 'F', 'Domestic Shorthair/Mix', 'Black/Orange', '2025-07-02', '933000321259130',
 'Spay', 'Red', 'Unable to make contact', 'needed',
 'Olivia Iniguez', '(707) 480-5577', NULL, '8204 Windmill Farms Dr Cotati CA 94931', 'P0047931483',
 'Foster to Adopt Home', 'Stray', '1600 Blk Zinfandel Dr Petaluma',
 '2/13/26: NO CALL/NO SHOW for 1/22/26 spay. Alt ph#: sister 707-806-8857. Adopter is 18 lives with mom.'),
-- 16. Dixie
('a0000000-0000-0000-0000-000000000001', 'A0058953692', 'Dixie', 'F', 'Domestic Shorthair/Mix', 'Brown/Black', '2025-07-20', '933000321259129',
 'Spay', 'Red', 'Unable to make contact', 'needed',
 NULL, NULL, NULL, NULL, 'P0046057554',
 'Foster to Adopt Home', 'Seized/Custody', '800 Block Hopper St Petaluma',
 '3/11 + 2/19 + 2/13/26: LMOM regarding spay (3 attempts). 10/31/25: FTA says everything great.'),
-- 17. Sweetie
('a0000000-0000-0000-0000-000000000001', 'A0059007491', 'Sweetie', 'F', 'Domestic Shorthair/Mix', 'Black', '2025-06-17', '933000321293083',
 'N/A', 'Blue', 'Foster needs to provide medical', 'already_done',
 NULL, NULL, NULL, NULL, 'P0048387181',
 'Foster to Adopt Home', 'Stray', '14000 Burns Valley Rd Clearlake',
 'DONE — 2/19/26: Already got spayed at own vet.'),
-- 18. Baby Cat
('a0000000-0000-0000-0000-000000000001', 'A0059542790', 'Baby Cat', 'F', 'Domestic Shorthair/Mix', 'Black/White', '2025-08-30', '933000321292597',
 'Spay', 'Yellow', 'Needs medical', 'needed',
 'Vicky Willard', '707-477-2111', NULL, '1663 Peggy Ln Petaluma CA 94954', 'P48641635',
 'Foster to Adopt Home', 'Stray', NULL,
 'Foster contract 11/13/2025. Expected return 03/28/2026 (overdue).'),
-- 19. Chamomile
('a0000000-0000-0000-0000-000000000001', 'A0059542781', 'Chamomile', 'F', 'Domestic Shorthair/Mix', 'Brown/White', '2025-08-30', '933000321292596',
 'N/A', 'Blue', 'Foster needs to provide medical', 'already_done',
 'Erin Bishop', '707-328-4207', 'ladybish471@yahoo.com', '1648 Shenandoah Ct Petaluma CA 94954', 'P0048454092',
 'Foster Home', 'Stray', 'I Street Petaluma',
 'DONE — 2/19/26: Already spayed at own vet. Same foster as Jelly Bean.'),
-- 20. Fudge
('a0000000-0000-0000-0000-000000000001', 'A0059753625', 'Fudge', 'M', 'Domestic Shorthair/Mix', 'Black', '2025-09-10', '933000321292585',
 'Neuter', 'Blue', 'Foster needs to provide medical', 'foster_handling',
 NULL, NULL, NULL, NULL, 'P0048652846',
 'Foster to Adopt Home', 'Seized/Custody', 'Smart Pathway off Shasta Ave Petaluma',
 '2/13/26: Foster getting neuter done herself — will bring paperwork.'),
-- 21. Iggy
('a0000000-0000-0000-0000-000000000001', 'A0059897693', 'Iggy', 'F', 'Domestic Shorthair/Mix', 'Grey', '2025-10-10', '941010003750819',
 'Spay', 'Red', 'Unable to make contact', 'needed',
 'Jennifer Lake', '(707) 890-0818', NULL, '300 Stony Point Petaluma CA 94952', 'P0048741253',
 'Foster to Adopt Home', 'Stray', 'River Road',
 '2/13/26: Phone DISCONNECTED. No email on file.'),
-- 22. Winnie
('a0000000-0000-0000-0000-000000000001', 'A0059929402', 'Winnie', 'F', 'Domestic Shorthair/Mix', 'White/Orange', '2025-05-08', '933000321292987',
 'Spay', 'Blue', 'Foster needs to provide medical', 'needed',
 'Brady Fisher', '707-230-3576', 'blwc1997@gmail.com', '2016 Pioneer Way 170 Santa Rosa CA 95403', 'P48877386',
 'Foster to Adopt Home', 'Transfer In', NULL,
 'Foster contract 1/2/2026. Expected return 4/30/2026. Good contact — no spay follow-up yet.'),
-- 23. Della
('a0000000-0000-0000-0000-000000000001', 'A0059966957', 'Della', 'F', 'Domestic Shorthair/Mix', 'Black/Blond', '2025-10-15', '933000321292982',
 'Spay', 'Red', 'Unable to make contact', 'needed',
 'Marisa Krause', '(707) 347-7245', NULL, '45 Arlington Dr Petaluma CA 94952', 'P0047309440',
 'Foster to Adopt Home', 'Stray', '45 Arlington Dr Petaluma',
 '3/11 + 2/13/26: LMOM regarding spay. Same intake as Debra/Dusty/Denise.'),
-- 24. Debra
('a0000000-0000-0000-0000-000000000001', 'A0059966964', 'Debra', 'F', 'Domestic Shorthair/Mix', 'Brown/Blond', '2025-10-15', '933000321292981',
 'Spay', 'Red', 'Unable to make contact', 'needed',
 NULL, '(707) 347-7245', NULL, '45 Arlington Dr Petaluma CA 94952', NULL,
 'Foster to Adopt Home', 'Stray', '45 Arlington Dr Petaluma',
 '3/11 + 2/13/26: LMOM regarding spay. Intake person Marisa Krause. Different FTA.'),
-- 25. Dusty
('a0000000-0000-0000-0000-000000000001', 'A0059966969', 'Dusty', 'M', 'Domestic Shorthair/Mix', 'Black/Brown', '2025-10-15', '933000321292996',
 'Neuter', 'Red', 'Unable to make contact', 'needed',
 NULL, '(707) 347-7245', NULL, '45 Arlington Dr Petaluma CA 94952', NULL,
 'Foster to Adopt Home', 'Stray', '45 Arlington Dr Petaluma',
 '3/11/26: Called — BUSY TONE. Same group as Della/Debra/Denise.'),
-- 26. Denise (princess)
('a0000000-0000-0000-0000-000000000001', 'A0059966979', 'Denise (princess)', 'F', 'Domestic Shorthair/Mix', 'Grey/Orange', '2025-10-15', '933000321292988',
 'Spay', 'Yellow', 'Needs medical', 'needed',
 'Lila/Chris Welchel/Burke', '512-922-1505', 'lila.welchel@gmail.com', '1875 Tannery Creek Rd Bodega CA 94922', 'P34604989',
 'Foster to Adopt Home', 'Stray', '45 Arlington Dr Petaluma',
 'Foster contract 12/23/2025. Expected return 04/22/2026. On Pyrantel Pamoate dewormer.'),
-- 27. Pepper
('a0000000-0000-0000-0000-000000000001', 'A0060140226', 'Pepper', 'F', 'Domestic Shorthair/Mix', 'Black', '2025-05-21', '941010003845537',
 'Spay', 'Red', 'Unable to make contact', 'needed',
 NULL, NULL, NULL, NULL, 'P0037727305',
 'Foster to Adopt Home', 'Seized/Custody', 'Side of road',
 '3/11/26: PHONE NUMBER IS INCORRECT. Intake by Jori Donahoo (707) 364-5398. Case C0009380389.'),
-- 28. Nopo Way kitten 1
('a0000000-0000-0000-0000-000000000001', 'A0060319256', NULL, 'M', 'Domestic Shorthair/Mix', 'Black/White', NULL, NULL,
 'Neuter', 'Yellow', 'Needs medical', 'needed',
 NULL, NULL, NULL, NULL, NULL,
 'Foster Home', 'Stray/Abandoned', '1611 Nopo Way Cloverdale',
 'Nopo Way litter (4 kittens). Intake: Joseph Harold (707) 615-3916.'),
-- 29. Nopo Way kitten 2
('a0000000-0000-0000-0000-000000000001', 'A0060319262', NULL, 'F', 'Domestic Shorthair/Mix', 'Grey', NULL, NULL,
 'Spay', 'Yellow', 'Needs medical', 'needed',
 NULL, NULL, NULL, NULL, NULL,
 'Foster Home', 'Stray/Abandoned', '1611 Nopo Way Cloverdale',
 'Nopo Way litter (4 kittens). Intake: Joseph Harold (707) 615-3916.'),
-- 30. Nopo Way kitten 3
('a0000000-0000-0000-0000-000000000001', 'A0060319265', NULL, 'F', 'Domestic Shorthair/Mix', 'Orange/White', NULL, NULL,
 'Spay', 'Yellow', 'Needs medical', 'needed',
 NULL, NULL, NULL, NULL, NULL,
 'Foster Home', 'Stray/Abandoned', '1611 Nopo Way Cloverdale',
 'Nopo Way litter (4 kittens). Unweaned. Foster placed by Isabella O''Toole.'),
-- 31. Nopo Way kitten 4
('a0000000-0000-0000-0000-000000000001', 'A0060319272', NULL, 'M', 'Domestic Shorthair/Mix', 'Orange', NULL, NULL,
 'Neuter', 'Yellow', 'Needs medical', 'needed',
 NULL, NULL, NULL, NULL, NULL,
 'Foster Home', 'Stray/Abandoned', '1611 Nopo Way Cloverdale',
 'Nopo Way litter (4 kittens). Unweaned. Foster placed by Ashlyn Stone.')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Add nav item
-- ============================================================================

INSERT INTO ops.nav_items (sidebar, section, label, path, icon, sort_order, visible)
VALUES ('admin', 'Operations', 'Partner Orgs', '/admin/partner-orgs', 'handshake', 50, TRUE)
ON CONFLICT DO NOTHING;

COMMIT;
