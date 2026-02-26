#!/usr/bin/env node
/**
 * Direct import script for fixed ClinicHQ export files
 * Ingests the corrected exports that fix DATA_GAP_037 (missing service lines)
 * Uses batch inserts for performance
 */

import XLSX from 'xlsx';
import { createHash } from 'crypto';
import pg from 'pg';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const FILES = [
  {
    path: '/Users/benmisdiaz/Downloads/report_813a3141-4283-4500-998c-d960731af104.xlsx',
    sourceTable: 'appointment_info',
    type: 'appointment_service'
  },
  {
    path: '/Users/benmisdiaz/Downloads/report_0812cabb-96da-4067-be4f-b7e45518bb9d.xlsx',
    sourceTable: 'cat_info',
    type: 'cat'
  },
  {
    path: '/Users/benmisdiaz/Downloads/report_6607bc12-175a-40fd-a7b2-a745a5c87d41.xlsx',
    sourceTable: 'owner_info',
    type: 'owner'
  }
];

function hashRow(row) {
  return createHash('md5').update(JSON.stringify(row)).digest('hex');
}

async function importFile(fileConfig) {
  const { path: filePath, sourceTable, type } = fileConfig;
  console.log(`\n=== Importing ${sourceTable} from ${filePath} ===`);

  // Read and parse Excel file
  const buffer = readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  let rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  console.log(`Parsed ${rows.length} rows`);

  // Get ID field based on source table
  const idFields = {
    appointment_info: 'Number',
    cat_info: 'Microchip Number',
    owner_info: 'Number'
  };
  const idField = idFields[sourceTable] || 'Number';

  // Forward-fill the ID field for appointment_info (ClinicHQ exports with merged cells)
  if (sourceTable === 'appointment_info') {
    let lastNumber = '';
    for (const row of rows) {
      if (row[idField] && String(row[idField]).trim()) {
        lastNumber = String(row[idField]);
      } else {
        row[idField] = lastNumber;
      }
    }
    console.log(`Forward-filled ${idField} for continuation rows`);
  }

  // Prepare all rows for batch insert
  const values = [];
  for (const row of rows) {
    const sourceRecordId = String(row[idField] || row['Number'] || '');
    const rowHash = hashRow(row);
    values.push({ type, sourceRecordId, rowHash, payload: row });
  }

  // Batch insert using unnest
  const BATCH_SIZE = 500;
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);

    const types = batch.map(v => v.type);
    const ids = batch.map(v => v.sourceRecordId);
    const hashes = batch.map(v => v.rowHash);
    const payloads = batch.map(v => JSON.stringify(v.payload));

    try {
      const result = await pool.query(`
        INSERT INTO source.clinichq_raw (record_type, source_record_id, row_hash, payload, fetched_at)
        SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::jsonb[],
                             ARRAY_FILL(NOW(), ARRAY[${batch.length}])::timestamptz[])
        ON CONFLICT (record_type, source_record_id, row_hash) DO NOTHING
      `, [types, ids, hashes, payloads]);

      inserted += result.rowCount;
      skipped += batch.length - result.rowCount;

      process.stdout.write(`\rProcessed ${Math.min(i + BATCH_SIZE, values.length)}/${values.length}...`);
    } catch (err) {
      console.error(`\nBatch error:`, err.message);
    }
  }

  console.log(`\nResults: ${inserted} inserted, ${skipped} skipped (already exists)`);
  return { inserted, skipped };
}

async function verifyImport() {
  console.log('\n=== Verification ===');

  // Check service lines per appointment for Jan 12+
  const result = await pool.query(`
    SELECT
      DATE_TRUNC('week', (payload->>'Date')::date) as week,
      COUNT(DISTINCT payload->>'Number') as appointments,
      COUNT(*) as service_rows,
      ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT payload->>'Number'), 0), 1) as services_per_appt,
      COUNT(*) FILTER (WHERE payload->>'Service / Subsidy' ILIKE '%ear tip%') as ear_tips,
      COUNT(*) FILTER (WHERE payload->>'Service / Subsidy' ILIKE '%microchip%') as microchips
    FROM source.clinichq_raw
    WHERE (payload->>'Date')::date >= '2026-01-12'
      AND record_type = 'appointment_service'
    GROUP BY 1
    ORDER BY 1
  `);

  console.log('\nWeekly stats after import:');
  console.log('Week       | Appts | Rows | Svcs/Appt | EarTips | Chips');
  console.log('-'.repeat(60));
  for (const row of result.rows) {
    const week = row.week.toISOString().slice(0, 10);
    console.log(
      `${week} | ${String(row.appointments).padStart(5)} | ${String(row.service_rows).padStart(4)} | ${String(row.services_per_appt).padStart(9)} | ${String(row.ear_tips).padStart(7)} | ${String(row.microchips).padStart(5)}`
    );
  }
}

async function main() {
  console.log('ClinicHQ Fixed Export Importer');
  console.log('==============================');
  console.log('Fixing DATA_GAP_037: Service lines missing since Jan 12, 2026\n');

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const file of FILES) {
    const result = await importFile(file);
    totalInserted += result.inserted;
    totalSkipped += result.skipped;
  }

  console.log('\n=== Summary ===');
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped: ${totalSkipped}`);

  await verifyImport();

  await pool.end();
  console.log('\nDone!');
}

main().catch(console.error);
