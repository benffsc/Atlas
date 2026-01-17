#!/usr/bin/env node
/**
 * Re-ingest ClinicHQ files for the week with the fixed pipeline
 *
 * Usage: node scripts/reingest-clinichq-week.mjs
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import pg from 'pg';
import XLSX from 'xlsx';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

// Files to process in order
const files = [
  { path: '/Users/benmisdiaz/Downloads/report_74934c8c-2e10-44b6-8f51-e3a73de55142.xlsx', type: 'cat_info' },
  { path: '/Users/benmisdiaz/Downloads/report_d09a0509-77c4-4ee0-85af-5612e2d212d6.xlsx', type: 'owner_info' },
  { path: '/Users/benmisdiaz/Downloads/report_c6c3df01-e280-4da3-bdab-34fe6f0c7e48.xlsx', type: 'appointment_info' },
];

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result;
}

function parseFile(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function getIdField(sourceTable) {
  const configs = {
    cat_info: ['Microchip Number', 'Number'],
    owner_info: ['Owner ID', 'Number'],
    appointment_info: ['Number', 'Appointment ID'],
  };
  return configs[sourceTable] || ['ID', 'id', 'Number'];
}

async function stageRecords(rows, sourceTable) {
  const idFieldCandidates = getIdField(sourceTable);
  let inserted = 0, skipped = 0, updated = 0;

  // For appointment_info, aggregate service lines
  let processedRows = rows;
  if (sourceTable === 'appointment_info') {
    const aggregated = [];
    let currentAppointment = null;
    let services = [];

    for (const row of rows) {
      const hasNumber = row['Number'] && String(row['Number']).trim();

      if (hasNumber) {
        if (currentAppointment) {
          currentAppointment['All Services'] = services.join('; ');
          aggregated.push(currentAppointment);
        }
        currentAppointment = { ...row };
        services = [];
        const svc = row['Service / Subsidy'];
        if (svc && String(svc).trim()) {
          services.push(String(svc).trim());
        }
      } else if (currentAppointment) {
        const svc = row['Service / Subsidy'];
        if (svc && String(svc).trim()) {
          services.push(String(svc).trim());
        }
      }
    }
    if (currentAppointment) {
      currentAppointment['All Services'] = services.join('; ');
      aggregated.push(currentAppointment);
    }
    processedRows = aggregated;
  }

  for (const row of processedRows) {
    const hasData = Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== '');
    if (!hasData) {
      skipped++;
      continue;
    }

    let sourceRowId = null;
    for (const field of idFieldCandidates) {
      if (row[field]) {
        sourceRowId = String(row[field]);
        break;
      }
    }

    // For appointment_info, use composite key (Number_Date)
    if (sourceRowId && sourceTable === 'appointment_info' && row['Date']) {
      sourceRowId = `${sourceRowId}_${String(row['Date']).replace(/\//g, '-')}`;
    }

    if (!sourceRowId) {
      sourceRowId = `row_${processedRows.indexOf(row)}`;
    }

    const rowHash = createHash('sha256')
      .update(JSON.stringify(row))
      .digest('hex')
      .substring(0, 16);

    const existing = await query(
      `SELECT id, row_hash, source_row_id FROM trapper.staged_records
       WHERE source_system = $1 AND source_table = $2
         AND (source_row_id = $3 OR row_hash = $4)`,
      ['clinichq', sourceTable, sourceRowId, rowHash]
    );

    if (existing.rows.length > 0) {
      const ex = existing.rows[0];
      if (ex.row_hash === rowHash) {
        skipped++;
      } else {
        await query(
          `UPDATE trapper.staged_records
           SET payload = $1, row_hash = $2, updated_at = NOW()
           WHERE id = $3`,
          [JSON.stringify(row), rowHash, ex.id]
        );
        updated++;
      }
    } else {
      const insertResult = await query(
        `INSERT INTO trapper.staged_records
         (source_system, source_table, source_row_id, payload, row_hash)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_system, source_table, row_hash) DO NOTHING
         RETURNING id`,
        ['clinichq', sourceTable, sourceRowId, JSON.stringify(row), rowHash]
      );
      if (insertResult.rowCount > 0) {
        inserted++;
      } else {
        skipped++;
      }
    }
  }

  return { inserted, updated, skipped, total: processedRows.length };
}

async function runPostProcessing(sourceTable) {
  const results = {};

  if (sourceTable === 'cat_info') {
    // Create cats from microchips
    const catsCreated = await query(`
      WITH cat_data AS (
        SELECT DISTINCT ON (payload->>'Microchip Number')
          payload->>'Microchip Number' as microchip,
          NULLIF(TRIM(payload->>'Patient Name'), '') as name,
          NULLIF(TRIM(payload->>'Sex'), '') as sex,
          NULLIF(TRIM(payload->>'Breed'), '') as breed,
          NULLIF(TRIM(payload->>'Color'), '') as color
        FROM trapper.staged_records
        WHERE source_system = 'clinichq'
          AND source_table = 'cat_info'
          AND payload->>'Microchip Number' IS NOT NULL
          AND TRIM(payload->>'Microchip Number') != ''
          AND LENGTH(TRIM(payload->>'Microchip Number')) >= 9
        ORDER BY payload->>'Microchip Number', created_at DESC
      ),
      created_cats AS (
        SELECT cd.*, trapper.find_or_create_cat_by_microchip(
          cd.microchip, cd.name, cd.sex, cd.breed, NULL, cd.color, NULL, NULL, 'clinichq'
        ) as cat_id
        FROM cat_data cd WHERE cd.microchip IS NOT NULL
      )
      SELECT COUNT(*) as cnt FROM created_cats WHERE cat_id IS NOT NULL
    `);
    results.cats_created_or_matched = parseInt(catsCreated.rows[0]?.cnt || '0');

    // Update sex
    const sexUpdates = await query(`
      UPDATE trapper.sot_cats c
      SET sex = sr.payload->>'Sex'
      FROM trapper.staged_records sr
      JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      WHERE ci.cat_id = c.cat_id
        AND sr.source_system = 'clinichq' AND sr.source_table = 'cat_info'
        AND sr.payload->>'Sex' IS NOT NULL AND sr.payload->>'Sex' != ''
        AND LOWER(c.sex) IS DISTINCT FROM LOWER(sr.payload->>'Sex')
    `);
    results.sex_updates = sexUpdates.rowCount || 0;

    // Link orphaned appointments
    const appointmentsLinked = await query(`
      UPDATE trapper.sot_appointments a
      SET cat_id = trapper.get_canonical_cat_id(ci.cat_id)
      FROM trapper.staged_records sr
      JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      WHERE a.source_record_id = sr.source_row_id
        AND sr.source_system = 'clinichq' AND sr.source_table = 'appointment_info'
        AND a.cat_id IS NULL
        AND sr.payload->>'Microchip Number' IS NOT NULL
    `);
    results.orphaned_appointments_linked = appointmentsLinked.rowCount || 0;
  }

  if (sourceTable === 'owner_info') {
    // Create people
    const peopleCreated = await query(`
      WITH owner_data AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''), trapper.norm_phone_us(COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone'))))
          payload->>'Owner First Name' as first_name,
          payload->>'Owner Last Name' as last_name,
          NULLIF(LOWER(TRIM(payload->>'Owner Email')), '') as email,
          trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone')) as phone,
          NULLIF(TRIM(payload->>'Owner Address'), '') as address
        FROM trapper.staged_records
        WHERE source_system = 'clinichq' AND source_table = 'owner_info'
          AND ((payload->>'Owner Email' IS NOT NULL AND TRIM(payload->>'Owner Email') != '')
            OR (payload->>'Owner Phone' IS NOT NULL AND TRIM(payload->>'Owner Phone') != '')
            OR (payload->>'Owner Cell Phone' IS NOT NULL AND TRIM(payload->>'Owner Cell Phone') != ''))
          AND (payload->>'Owner First Name' IS NOT NULL AND TRIM(payload->>'Owner First Name') != '')
        ORDER BY COALESCE(NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''), trapper.norm_phone_us(COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone'))),
                 (payload->>'Date')::date DESC NULLS LAST
      ),
      created_people AS (
        SELECT od.*, trapper.find_or_create_person(od.email, od.phone, od.first_name, od.last_name, od.address, 'clinichq') as person_id
        FROM owner_data od WHERE od.first_name IS NOT NULL
      )
      SELECT COUNT(*) as cnt FROM created_people WHERE person_id IS NOT NULL
    `);
    results.people_created_or_matched = parseInt(peopleCreated.rows[0]?.cnt || '0');

    // Create places
    const placesCreated = await query(`
      WITH owner_addresses AS (
        SELECT DISTINCT ON (TRIM(payload->>'Owner Address'))
          TRIM(payload->>'Owner Address') as address
        FROM trapper.staged_records
        WHERE source_system = 'clinichq' AND source_table = 'owner_info'
          AND payload->>'Owner Address' IS NOT NULL
          AND TRIM(payload->>'Owner Address') != ''
          AND LENGTH(TRIM(payload->>'Owner Address')) > 10
        ORDER BY TRIM(payload->>'Owner Address'), (payload->>'Date')::date DESC NULLS LAST
      ),
      created_places AS (
        SELECT oa.*, trapper.find_or_create_place_deduped(oa.address, NULL, NULL, NULL, 'clinichq') as place_id
        FROM owner_addresses oa
      )
      SELECT COUNT(*) as cnt FROM created_places WHERE place_id IS NOT NULL
    `);
    results.places_created_or_matched = parseInt(placesCreated.rows[0]?.cnt || '0');

    // Link people to places (using safe_norm functions to exclude blocked identifiers)
    const personPlaceLinks = await query(`
      INSERT INTO trapper.person_place_relationships (person_id, place_id, role, confidence, source_system, source_table)
      SELECT DISTINCT pi.person_id, p.place_id, 'resident'::trapper.person_place_role, 0.7, 'clinichq', 'owner_info'
      FROM trapper.staged_records sr
      JOIN trapper.person_identifiers pi ON (
        -- Use safe_norm functions that return NULL for blocked identifiers (FFSC office phone, org emails, etc.)
        (pi.id_type = 'email' AND pi.id_value_norm = trapper.safe_norm_email(sr.payload->>'Owner Email'))
        OR (pi.id_type = 'phone' AND pi.id_value_norm = trapper.safe_norm_phone(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')))
      )
      JOIN trapper.places p ON p.normalized_address = trapper.normalize_address(sr.payload->>'Owner Address')
        AND p.merged_into_place_id IS NULL
      WHERE sr.source_system = 'clinichq' AND sr.source_table = 'owner_info'
        AND sr.payload->>'Owner Address' IS NOT NULL AND TRIM(sr.payload->>'Owner Address') != ''
        AND NOT EXISTS (SELECT 1 FROM trapper.person_place_relationships ppr WHERE ppr.person_id = pi.person_id AND ppr.place_id = p.place_id)
      ON CONFLICT DO NOTHING
    `);
    results.person_place_links = personPlaceLinks.rowCount || 0;

    // Link people to appointments (using safe_norm to exclude blocked identifiers)
    const personLinks = await query(`
      UPDATE trapper.sot_appointments a
      SET person_id = pi.person_id
      FROM trapper.staged_records sr
      JOIN trapper.person_identifiers pi ON (
        (pi.id_type = 'email' AND pi.id_value_norm = trapper.safe_norm_email(sr.payload->>'Owner Email'))
        OR (pi.id_type = 'phone' AND pi.id_value_norm = trapper.safe_norm_phone(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')))
      )
      WHERE sr.source_system = 'clinichq' AND sr.source_table = 'owner_info'
        AND a.appointment_number = sr.payload->>'Number'
        AND a.person_id IS NULL
    `);
    results.appointments_linked_to_people = personLinks.rowCount || 0;
  }

  if (sourceTable === 'appointment_info') {
    // Create appointments
    const newAppointments = await query(`
      INSERT INTO trapper.sot_appointments (
        cat_id, appointment_date, appointment_number, service_type,
        is_spay, is_neuter, vet_name, technician, temperature, medical_notes,
        is_lactating, is_pregnant, is_in_heat,
        data_source, source_system, source_record_id, source_row_hash
      )
      SELECT
        trapper.get_canonical_cat_id(c.cat_id),
        TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'),
        sr.payload->>'Number',
        COALESCE(sr.payload->>'All Services', sr.payload->>'Service / Subsidy'),
        sr.payload->>'Spay' = 'Yes',
        sr.payload->>'Neuter' = 'Yes',
        sr.payload->>'Vet Name',
        sr.payload->>'Technician',
        CASE WHEN sr.payload->>'Temperature' ~ '^[0-9]+\\.?[0-9]*$'
             THEN (sr.payload->>'Temperature')::NUMERIC(4,1) ELSE NULL END,
        sr.payload->>'Internal Medical Notes',
        sr.payload->>'Lactating' = 'Yes' OR sr.payload->>'Lactating_2' = 'Yes',
        sr.payload->>'Pregnant' = 'Yes',
        sr.payload->>'In Heat' = 'Yes',
        'clinichq', 'clinichq', sr.source_row_id, sr.row_hash
      FROM trapper.staged_records sr
      LEFT JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      LEFT JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
      WHERE sr.source_system = 'clinichq' AND sr.source_table = 'appointment_info'
        AND sr.payload->>'Date' IS NOT NULL AND sr.payload->>'Date' != ''
        AND NOT EXISTS (
          SELECT 1 FROM trapper.sot_appointments a
          WHERE a.appointment_number = sr.payload->>'Number'
            AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
        )
      ON CONFLICT DO NOTHING
    `);
    results.new_appointments = newAppointments.rowCount || 0;

    // Create spay procedures
    const newSpays = await query(`
      INSERT INTO trapper.cat_procedures (
        cat_id, appointment_id, procedure_type, procedure_date, status,
        performed_by, technician, is_spay, is_neuter, source_system, source_record_id
      )
      SELECT a.cat_id, a.appointment_id, 'spay', a.appointment_date,
        'completed'::trapper.procedure_status, a.vet_name, a.technician, TRUE, FALSE, 'clinichq', a.appointment_number
      FROM trapper.sot_appointments a
      WHERE a.cat_id IS NOT NULL AND a.service_type ILIKE '%spay%'
        AND NOT EXISTS (SELECT 1 FROM trapper.cat_procedures cp WHERE cp.appointment_id = a.appointment_id AND cp.is_spay = TRUE)
      ON CONFLICT DO NOTHING
    `);
    results.new_spays = newSpays.rowCount || 0;

    // Create neuter procedures
    const newNeuters = await query(`
      INSERT INTO trapper.cat_procedures (
        cat_id, appointment_id, procedure_type, procedure_date, status,
        performed_by, technician, is_spay, is_neuter, source_system, source_record_id
      )
      SELECT a.cat_id, a.appointment_id, 'neuter', a.appointment_date,
        'completed'::trapper.procedure_status, a.vet_name, a.technician, FALSE, TRUE, 'clinichq', a.appointment_number
      FROM trapper.sot_appointments a
      WHERE a.cat_id IS NOT NULL AND a.service_type ILIKE '%neuter%'
        AND NOT EXISTS (SELECT 1 FROM trapper.cat_procedures cp WHERE cp.appointment_id = a.appointment_id AND cp.is_neuter = TRUE)
      ON CONFLICT DO NOTHING
    `);
    results.new_neuters = newNeuters.rowCount || 0;

    // Fix procedures based on cat sex
    await query(`
      UPDATE trapper.cat_procedures cp SET procedure_type = 'neuter', is_spay = FALSE, is_neuter = TRUE
      FROM trapper.sot_cats c WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE AND LOWER(c.sex) = 'male'
    `);
    await query(`
      UPDATE trapper.cat_procedures cp SET procedure_type = 'spay', is_spay = TRUE, is_neuter = FALSE
      FROM trapper.sot_cats c WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE AND LOWER(c.sex) = 'female'
    `);

    // Update altered_status
    await query(`UPDATE trapper.sot_cats c SET altered_status = 'spayed'
      WHERE c.altered_status IS DISTINCT FROM 'spayed'
        AND EXISTS (SELECT 1 FROM trapper.cat_procedures cp WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE)`);
    await query(`UPDATE trapper.sot_cats c SET altered_status = 'neutered'
      WHERE c.altered_status IS DISTINCT FROM 'neutered'
        AND EXISTS (SELECT 1 FROM trapper.cat_procedures cp WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE)`);

    // Link cats to places
    const linkedViaAppts = await query(`
      INSERT INTO trapper.cat_place_relationships (cat_id, place_id, relationship_type, confidence, source_system, source_table)
      SELECT DISTINCT a.cat_id, ppr.place_id, 'appointment_site', 'high', 'auto_link', 'ingest_script'
      FROM trapper.sot_appointments a
      JOIN trapper.person_place_relationships ppr ON ppr.person_id = a.person_id
      WHERE a.cat_id IS NOT NULL AND ppr.place_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = a.cat_id AND cpr.place_id = ppr.place_id)
      ON CONFLICT DO NOTHING
    `);
    results.linked_cats_via_appointments = linkedViaAppts.rowCount || 0;
  }

  return results;
}

async function main() {
  console.log('Re-ingesting ClinicHQ files...\n');

  for (const file of files) {
    console.log('='.repeat(60));
    console.log(`Processing: ${file.path.split('/').pop()}`);
    console.log(`Type: ${file.type}`);

    const buffer = readFileSync(file.path);
    const rows = parseFile(buffer);
    console.log(`Rows in file: ${rows.length}`);

    // Stage records
    const stageResults = await stageRecords(rows, file.type);
    console.log(`Staged: ${stageResults.inserted} inserted, ${stageResults.updated} updated, ${stageResults.skipped} skipped`);

    // Run post-processing
    const postResults = await runPostProcessing(file.type);
    console.log('Post-processing:', JSON.stringify(postResults, null, 2));
    console.log('');
  }

  // Final verification
  console.log('='.repeat(60));
  console.log('Verification: Checking Biggie...');
  const biggie = await query(`
    SELECT c.cat_id, c.display_name, c.sex, c.altered_status,
           a.appointment_date, a.service_type, a.is_neuter,
           cp.procedure_type, cp.is_neuter as proc_is_neuter
    FROM trapper.sot_cats c
    LEFT JOIN trapper.sot_appointments a ON a.cat_id = c.cat_id
    LEFT JOIN trapper.cat_procedures cp ON cp.cat_id = c.cat_id
    LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
    WHERE ci.id_value = '981020053891405'
    ORDER BY a.appointment_date
  `);
  console.log('Biggie data:');
  biggie.rows.forEach(r => {
    console.log(`  ${r.appointment_date}: ${r.service_type?.substring(0, 50)}... | altered: ${r.altered_status} | procedure: ${r.procedure_type}`);
  });

  await pool.end();
  console.log('\nDone!');
}

main().catch(console.error);
