#!/usr/bin/env node
/**
 * Utility script to check attribute status
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envContent = fs.readFileSync(path.join(__dirname, '../../.env'), 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  if (line.startsWith('#') || !line.includes('=')) return;
  const [key, ...valueParts] = line.split('=');
  let value = valueParts.join('=').trim();
  if ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))) {
    value = value.slice(1, -1);
  }
  envVars[key.trim()] = value;
});

const { Pool } = pg;
const pool = new Pool({ connectionString: envVars.DATABASE_URL });

async function main() {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM trapper.google_map_entries) as total_entries,
        (SELECT COUNT(*) FROM trapper.google_map_entries WHERE ai_classified_at IS NOT NULL) as classified,
        (SELECT COUNT(*) FROM trapper.google_map_entries WHERE linked_place_id IS NOT NULL OR linked_person_id IS NOT NULL) as linked,
        (SELECT COUNT(*) FROM trapper.entity_attributes WHERE source_system = 'google_maps') as gmap_attrs,
        (SELECT COUNT(*) FROM trapper.entity_attributes WHERE superseded_at IS NULL) as active_attrs
    `);
    console.log('Google Maps Status:', result.rows[0]);

    const attrCounts = await pool.query(`
      SELECT entity_type, COUNT(*) as count
      FROM trapper.entity_attributes
      WHERE superseded_at IS NULL
      GROUP BY entity_type
      ORDER BY count DESC
    `);
    console.log('\nActive Attributes by Entity:');
    attrCounts.rows.forEach(r => console.log('  ' + r.entity_type + ': ' + r.count));

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
