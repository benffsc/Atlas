#!/usr/bin/env node
/**
 * run_mig_175.mjs
 * Creates unified clinichq_visits table and rebuild functions
 */

import fs from 'fs';
import pg from 'pg';

const { Client } = pg;

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  console.log('MIG_175: ClinicHQ Unified Visits');
  console.log('=================================\n');

  try {
    // Read and execute the SQL file
    const sqlPath = 'sql/schema/sot/MIG_175__clinichq_unified_visits.sql';
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Split by major sections and execute
    // We'll execute the key statements manually for better control

    console.log('Step 1: Creating clinichq_visits table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS trapper.clinichq_visits (
          visit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          microchip TEXT NOT NULL,
          visit_date DATE NOT NULL,
          appointment_number TEXT NOT NULL,
          animal_name TEXT,
          sex TEXT,
          breed TEXT,
          primary_color TEXT,
          secondary_color TEXT,
          weight_lbs NUMERIC(5,2),
          age_years INT,
          age_months INT,
          altered_status TEXT,
          client_first_name TEXT,
          client_last_name TEXT,
          client_email TEXT,
          client_phone TEXT,
          client_cell_phone TEXT,
          client_address TEXT,
          ownership_type TEXT,
          client_type TEXT,
          vet_name TEXT,
          technician TEXT,
          temperature NUMERIC(4,1),
          body_composition_score TEXT,
          is_spay BOOLEAN DEFAULT FALSE,
          is_neuter BOOLEAN DEFAULT FALSE,
          no_surgery_reason TEXT,
          is_pregnant BOOLEAN DEFAULT FALSE,
          is_lactating BOOLEAN DEFAULT FALSE,
          is_in_heat BOOLEAN DEFAULT FALSE,
          has_uri BOOLEAN DEFAULT FALSE,
          has_dental_disease BOOLEAN DEFAULT FALSE,
          has_ear_issue BOOLEAN DEFAULT FALSE,
          has_eye_issue BOOLEAN DEFAULT FALSE,
          has_skin_issue BOOLEAN DEFAULT FALSE,
          has_mouth_issue BOOLEAN DEFAULT FALSE,
          has_fleas BOOLEAN DEFAULT FALSE,
          has_ticks BOOLEAN DEFAULT FALSE,
          has_tapeworms BOOLEAN DEFAULT FALSE,
          has_ear_mites BOOLEAN DEFAULT FALSE,
          has_ringworm BOOLEAN DEFAULT FALSE,
          felv_fiv_result TEXT,
          total_invoiced NUMERIC(10,2),
          service_value NUMERIC(10,2),
          subsidy_value NUMERIC(10,2),
          internal_notes TEXT,
          source_file TEXT,
          ingest_run_id UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_clinichq_visit UNIQUE (microchip, visit_date, appointment_number)
      )
    `);
    console.log('  ✓ Table created');

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clinichq_visits_microchip ON trapper.clinichq_visits(microchip)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clinichq_visits_date ON trapper.clinichq_visits(visit_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clinichq_visits_client_email ON trapper.clinichq_visits(client_email) WHERE client_email IS NOT NULL`);
    console.log('  ✓ Indexes created');

    console.log('\nStep 2: Adding needs_microchip flag to sot_cats...');
    await client.query(`ALTER TABLE trapper.sot_cats ADD COLUMN IF NOT EXISTS needs_microchip BOOLEAN DEFAULT FALSE`);
    console.log('  ✓ Column added');

    console.log('\nStep 3: Creating build_clinichq_visits function...');
    // This is a complex function - read from file and execute
    await client.query(`
      CREATE OR REPLACE FUNCTION trapper.build_clinichq_visits(p_run_id UUID DEFAULT NULL)
      RETURNS TABLE(visits_created INT, visits_updated INT, visits_skipped INT) AS $$
      DECLARE
          v_created INT := 0;
          v_updated INT := 0;
          v_skipped INT := 0;
          v_rec RECORD;
          v_microchip TEXT;
          v_visit_date DATE;
          v_appt_num TEXT;
      BEGIN
          FOR v_rec IN
              SELECT
                  COALESCE(
                      NULLIF(TRIM(appt.payload->>'Microchip Number'), ''),
                      NULLIF(TRIM(cat.payload->>'Microchip Number'), ''),
                      NULLIF(TRIM(owner.payload->>'Microchip Number'), '')
                  ) AS microchip,
                  COALESCE(
                      appt.payload->>'Date',
                      cat.payload->>'Date',
                      owner.payload->>'Date'
                  ) AS visit_date_str,
                  COALESCE(
                      appt.payload->>'Number',
                      cat.payload->>'Number',
                      owner.payload->>'Number'
                  ) AS appointment_number,
                  cat.payload->>'Animal Name' AS animal_name,
                  cat.payload->>'Sex' AS sex,
                  cat.payload->>'Breed' AS breed,
                  cat.payload->>'Primary Color' AS primary_color,
                  cat.payload->>'Secondary Color' AS secondary_color,
                  cat.payload->>'Weight' AS weight,
                  cat.payload->>'Age Years' AS age_years,
                  cat.payload->>'Age Months' AS age_months,
                  cat.payload->>'Spay Neuter Status' AS altered_status,
                  owner.payload->>'Owner First Name' AS client_first_name,
                  owner.payload->>'Owner Last Name' AS client_last_name,
                  owner.payload->>'Owner Email' AS client_email,
                  owner.payload->>'Owner Phone' AS client_phone,
                  owner.payload->>'Owner Cell Phone' AS client_cell_phone,
                  owner.payload->>'Owner Address' AS client_address,
                  owner.payload->>'Ownership' AS ownership_type,
                  owner.payload->>'ClientType' AS client_type,
                  appt.payload->>'Vet Name' AS vet_name,
                  appt.payload->>'Technician' AS technician,
                  appt.payload->>'Temperature' AS temperature,
                  appt.payload->>'Body Composition Score' AS body_score,
                  appt.payload->>'Spay' AS is_spay,
                  appt.payload->>'Neuter' AS is_neuter,
                  appt.payload->>'No Surgery Reason' AS no_surgery_reason,
                  appt.payload->>'Pregnant' AS is_pregnant,
                  appt.payload->>'Lactating' AS is_lactating,
                  appt.payload->>'In Heat' AS is_in_heat,
                  appt.payload->>'URI' AS has_uri,
                  appt.payload->>'Dental Disease' AS has_dental,
                  appt.payload->>'Ear Issue' AS has_ear_issue,
                  appt.payload->>'Eye Issue' AS has_eye_issue,
                  appt.payload->>'Skin Issue' AS has_skin_issue,
                  appt.payload->>'Mouth Issue' AS has_mouth_issue,
                  appt.payload->>'Fleas' AS has_fleas,
                  appt.payload->>'Ticks' AS has_ticks,
                  appt.payload->>'Tapeworms' AS has_tapeworms,
                  appt.payload->>'Ear mites' AS has_ear_mites,
                  appt.payload->>'Wood''s Lamp Ringworm Test' AS ringworm_test,
                  appt.payload->>'FeLV/FIV (SNAP test, in-house)' AS felv_fiv_result,
                  appt.payload->>'Total Invoiced' AS total_invoiced,
                  appt.payload->>'Serv Value' AS service_value,
                  appt.payload->>'Sub Value' AS subsidy_value,
                  appt.payload->>'Internal Medical Notes' AS internal_notes,
                  COALESCE(appt.source_file, cat.source_file, owner.source_file) AS source_file
              FROM trapper.staged_records appt
              LEFT JOIN trapper.staged_records cat
                  ON cat.source_system = 'clinichq'
                  AND cat.source_table = 'cat_info'
                  AND cat.payload->>'Microchip Number' = appt.payload->>'Microchip Number'
                  AND cat.payload->>'Number' = appt.payload->>'Number'
              LEFT JOIN trapper.staged_records owner
                  ON owner.source_system = 'clinichq'
                  AND owner.source_table = 'owner_info'
                  AND owner.payload->>'Microchip Number' = appt.payload->>'Microchip Number'
                  AND owner.payload->>'Number' = appt.payload->>'Number'
              WHERE appt.source_system = 'clinichq'
                AND appt.source_table = 'appointment_info'
                AND appt.payload->>'Microchip Number' IS NOT NULL
                AND TRIM(appt.payload->>'Microchip Number') != ''
                AND LENGTH(TRIM(appt.payload->>'Microchip Number')) >= 9
          LOOP
              v_microchip := TRIM(v_rec.microchip);
              v_appt_num := TRIM(COALESCE(v_rec.appointment_number, ''));

              BEGIN
                  v_visit_date := TO_DATE(v_rec.visit_date_str, 'MM/DD/YYYY');
              EXCEPTION WHEN OTHERS THEN
                  v_skipped := v_skipped + 1;
                  CONTINUE;
              END;

              IF v_microchip IS NULL OR v_visit_date IS NULL OR v_appt_num = '' THEN
                  v_skipped := v_skipped + 1;
                  CONTINUE;
              END IF;

              INSERT INTO trapper.clinichq_visits (
                  microchip, visit_date, appointment_number,
                  animal_name, sex, breed, primary_color, secondary_color,
                  weight_lbs, age_years, age_months, altered_status,
                  client_first_name, client_last_name, client_email,
                  client_phone, client_cell_phone, client_address,
                  ownership_type, client_type,
                  vet_name, technician, temperature, body_composition_score,
                  is_spay, is_neuter, no_surgery_reason,
                  is_pregnant, is_lactating, is_in_heat,
                  has_uri, has_dental_disease, has_ear_issue, has_eye_issue,
                  has_skin_issue, has_mouth_issue, has_fleas, has_ticks,
                  has_tapeworms, has_ear_mites, has_ringworm,
                  felv_fiv_result, total_invoiced, service_value, subsidy_value,
                  internal_notes, source_file, ingest_run_id
              ) VALUES (
                  v_microchip, v_visit_date, v_appt_num,
                  v_rec.animal_name, v_rec.sex, v_rec.breed,
                  v_rec.primary_color, v_rec.secondary_color,
                  NULLIF(v_rec.weight, '')::NUMERIC,
                  NULLIF(v_rec.age_years, '')::INT,
                  NULLIF(v_rec.age_months, '')::INT,
                  v_rec.altered_status,
                  v_rec.client_first_name, v_rec.client_last_name,
                  NULLIF(LOWER(TRIM(v_rec.client_email)), ''),
                  NULLIF(TRIM(v_rec.client_phone), ''),
                  NULLIF(TRIM(v_rec.client_cell_phone), ''),
                  v_rec.client_address,
                  v_rec.ownership_type, v_rec.client_type,
                  v_rec.vet_name, v_rec.technician,
                  NULLIF(v_rec.temperature, '')::NUMERIC,
                  v_rec.body_score,
                  COALESCE(v_rec.is_spay, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.is_neuter, '') IN ('Yes', 'TRUE', '1', 'true'),
                  NULLIF(v_rec.no_surgery_reason, ''),
                  COALESCE(v_rec.is_pregnant, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.is_lactating, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.is_in_heat, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.has_uri, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.has_dental, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.has_ear_issue, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.has_eye_issue, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.has_skin_issue, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.has_mouth_issue, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.has_fleas, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.has_ticks, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.has_tapeworms, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.has_ear_mites, '') IN ('Yes', 'TRUE', '1', 'true'),
                  COALESCE(v_rec.ringworm_test, '') IN ('Positive', 'positive'),
                  CASE
                      WHEN v_rec.felv_fiv_result ILIKE '%negative%' THEN 'negative'
                      WHEN v_rec.felv_fiv_result ILIKE '%positive%' THEN 'positive'
                      ELSE NULL
                  END,
                  NULLIF(v_rec.total_invoiced, '')::NUMERIC,
                  NULLIF(v_rec.service_value, '')::NUMERIC,
                  NULLIF(v_rec.subsidy_value, '')::NUMERIC,
                  NULLIF(v_rec.internal_notes, ''),
                  v_rec.source_file,
                  p_run_id
              )
              ON CONFLICT (microchip, visit_date, appointment_number) DO UPDATE SET
                  animal_name = COALESCE(EXCLUDED.animal_name, trapper.clinichq_visits.animal_name),
                  client_first_name = COALESCE(EXCLUDED.client_first_name, trapper.clinichq_visits.client_first_name),
                  client_last_name = COALESCE(EXCLUDED.client_last_name, trapper.clinichq_visits.client_last_name),
                  client_email = COALESCE(EXCLUDED.client_email, trapper.clinichq_visits.client_email),
                  client_cell_phone = COALESCE(EXCLUDED.client_cell_phone, trapper.clinichq_visits.client_cell_phone);

              IF FOUND THEN
                  v_created := v_created + 1;
              END IF;
          END LOOP;

          RETURN QUERY SELECT v_created, v_updated, v_skipped;
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log('  ✓ Function created');

    console.log('\nStep 4: Creating sync_cats_from_visits function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION trapper.sync_cats_from_visits()
      RETURNS TABLE(cats_created INT, cats_updated INT, identifiers_added INT) AS $$
      DECLARE
          v_created INT := 0;
          v_updated INT := 0;
          v_idents INT := 0;
          v_rec RECORD;
          v_cat_id UUID;
      BEGIN
          FOR v_rec IN
              SELECT
                  v.microchip,
                  (SELECT animal_name FROM trapper.clinichq_visits WHERE microchip = v.microchip ORDER BY visit_date DESC LIMIT 1) AS animal_name,
                  (SELECT sex FROM trapper.clinichq_visits WHERE microchip = v.microchip AND sex IS NOT NULL ORDER BY visit_date DESC LIMIT 1) AS sex,
                  (SELECT altered_status FROM trapper.clinichq_visits WHERE microchip = v.microchip AND altered_status IS NOT NULL ORDER BY visit_date DESC LIMIT 1) AS altered_status,
                  (SELECT breed FROM trapper.clinichq_visits WHERE microchip = v.microchip AND breed IS NOT NULL ORDER BY visit_date DESC LIMIT 1) AS breed,
                  (SELECT primary_color FROM trapper.clinichq_visits WHERE microchip = v.microchip AND primary_color IS NOT NULL ORDER BY visit_date DESC LIMIT 1) AS primary_color,
                  (SELECT secondary_color FROM trapper.clinichq_visits WHERE microchip = v.microchip AND secondary_color IS NOT NULL ORDER BY visit_date DESC LIMIT 1) AS secondary_color,
                  (SELECT ownership_type FROM trapper.clinichq_visits WHERE microchip = v.microchip AND ownership_type IS NOT NULL ORDER BY visit_date DESC LIMIT 1) AS ownership_type,
                  EXISTS(SELECT 1 FROM trapper.clinichq_visits WHERE microchip = v.microchip AND (is_spay OR is_neuter)) AS altered_by_clinic
              FROM (SELECT DISTINCT microchip FROM trapper.clinichq_visits) v
          LOOP
              SELECT ci.cat_id INTO v_cat_id
              FROM trapper.cat_identifiers ci
              WHERE ci.id_type = 'microchip' AND ci.id_value = v_rec.microchip;

              IF v_cat_id IS NULL THEN
                  INSERT INTO trapper.sot_cats (
                      display_name, sex, altered_status, breed, primary_color,
                      secondary_color, data_source, ownership_type, altered_by_clinic,
                      needs_microchip
                  ) VALUES (
                      COALESCE(v_rec.animal_name, 'Unknown (Clinic ' || v_rec.microchip || ')'),
                      v_rec.sex, v_rec.altered_status, v_rec.breed, v_rec.primary_color,
                      v_rec.secondary_color, 'clinichq', v_rec.ownership_type,
                      v_rec.altered_by_clinic, FALSE
                  )
                  RETURNING cat_id INTO v_cat_id;

                  v_created := v_created + 1;

                  INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
                  VALUES (v_cat_id, 'microchip', v_rec.microchip, 'clinichq', 'clinichq_visits')
                  ON CONFLICT DO NOTHING;

                  IF FOUND THEN v_idents := v_idents + 1; END IF;
              ELSE
                  UPDATE trapper.sot_cats SET
                      display_name = COALESCE(display_name, v_rec.animal_name),
                      sex = COALESCE(sex, v_rec.sex),
                      altered_status = COALESCE(altered_status, v_rec.altered_status),
                      breed = COALESCE(breed, v_rec.breed),
                      primary_color = COALESCE(primary_color, v_rec.primary_color),
                      secondary_color = COALESCE(secondary_color, v_rec.secondary_color),
                      ownership_type = COALESCE(ownership_type, v_rec.ownership_type),
                      altered_by_clinic = altered_by_clinic OR v_rec.altered_by_clinic,
                      data_source = 'clinichq',
                      needs_microchip = FALSE,
                      updated_at = NOW()
                  WHERE cat_id = v_cat_id;

                  v_updated := v_updated + 1;
              END IF;
          END LOOP;

          RETURN QUERY SELECT v_created, v_updated, v_idents;
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log('  ✓ Function created');

    console.log('\nStep 5: Creating sync_relationships_from_visits function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION trapper.sync_relationships_from_visits()
      RETURNS TABLE(relationships_created INT, people_not_found INT) AS $$
      DECLARE
          v_created INT := 0;
          v_not_found INT := 0;
          v_rec RECORD;
          v_cat_id UUID;
          v_person_id UUID;
      BEGIN
          FOR v_rec IN
              SELECT DISTINCT
                  v.microchip,
                  v.client_email,
                  v.client_cell_phone,
                  v.client_phone
              FROM trapper.clinichq_visits v
              WHERE v.client_email IS NOT NULL OR v.client_cell_phone IS NOT NULL OR v.client_phone IS NOT NULL
          LOOP
              SELECT ci.cat_id INTO v_cat_id
              FROM trapper.cat_identifiers ci
              WHERE ci.id_type = 'microchip' AND ci.id_value = v_rec.microchip;

              IF v_cat_id IS NULL THEN CONTINUE; END IF;

              v_person_id := NULL;
              IF v_rec.client_email IS NOT NULL THEN
                  SELECT pi.person_id INTO v_person_id
                  FROM trapper.person_identifiers pi
                  WHERE pi.id_type = 'email' AND pi.id_value_norm = LOWER(TRIM(v_rec.client_email));
              END IF;

              IF v_person_id IS NULL AND v_rec.client_cell_phone IS NOT NULL THEN
                  SELECT pi.person_id INTO v_person_id
                  FROM trapper.person_identifiers pi
                  WHERE pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(v_rec.client_cell_phone);
              END IF;

              IF v_person_id IS NULL AND v_rec.client_phone IS NOT NULL THEN
                  SELECT pi.person_id INTO v_person_id
                  FROM trapper.person_identifiers pi
                  WHERE pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(v_rec.client_phone);
              END IF;

              IF v_person_id IS NULL THEN
                  v_not_found := v_not_found + 1;
                  CONTINUE;
              END IF;

              v_person_id := trapper.canonical_person_id(v_person_id);

              INSERT INTO trapper.person_cat_relationships (
                  person_id, cat_id, relationship_type, confidence,
                  source_system, source_table
              ) VALUES (
                  v_person_id, v_cat_id, 'owner', 'high',
                  'clinichq', 'clinichq_visits'
              )
              ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table)
              DO NOTHING;

              IF FOUND THEN v_created := v_created + 1; END IF;
          END LOOP;

          RETURN QUERY SELECT v_created, v_not_found;
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log('  ✓ Function created');

    console.log('\nStep 6: Creating master rebuild function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION trapper.rebuild_from_clinichq_visits(p_run_id UUID DEFAULT NULL)
      RETURNS TABLE(visits_created INT, cats_created INT, cats_updated INT, relationships_created INT) AS $$
      DECLARE
          v_visits RECORD;
          v_cats RECORD;
          v_rels RECORD;
      BEGIN
          RAISE NOTICE 'Step 1: Building clinichq_visits from staged_records...';
          SELECT * INTO v_visits FROM trapper.build_clinichq_visits(p_run_id);
          RAISE NOTICE '  Visits: % created, % skipped', v_visits.visits_created, v_visits.visits_skipped;

          RAISE NOTICE 'Step 2: Syncing cats from visits (microchip-keyed)...';
          SELECT * INTO v_cats FROM trapper.sync_cats_from_visits();
          RAISE NOTICE '  Cats: % created, % updated', v_cats.cats_created, v_cats.cats_updated;

          RAISE NOTICE 'Step 3: Syncing person-cat relationships...';
          SELECT * INTO v_rels FROM trapper.sync_relationships_from_visits();
          RAISE NOTICE '  Relationships: % created, % people not found', v_rels.relationships_created, v_rels.people_not_found;

          RETURN QUERY SELECT v_visits.visits_created, v_cats.cats_created, v_cats.cats_updated, v_rels.relationships_created;
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log('  ✓ Function created');

    console.log('\n=================================');
    console.log('MIG_175 Schema Complete!');
    console.log('=================================\n');
    console.log('Next: Run SELECT * FROM trapper.rebuild_from_clinichq_visits();');

  } finally {
    await client.end();
  }
}

runMigration().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
