import { readFileSync } from 'fs';
import { Blob } from 'buffer';

async function runImport() {
  const formData = new FormData();

  const catInfo = readFileSync('/Users/benmisdiaz/Downloads/report_2fdf1ebf-5724-432c-8ba3-6225b6bd356e.xlsx');
  const ownerInfo = readFileSync('/Users/benmisdiaz/Downloads/report_b57be615-1432-4e77-ae1c-1d7437734358.xlsx');
  const apptInfo = readFileSync('/Users/benmisdiaz/Downloads/report_4740640d-575f-4988-ab46-4101a14288e7.xlsx');

  formData.append('cat_info', new Blob([catInfo]), 'cat_info.xlsx');
  formData.append('owner_info', new Blob([ownerInfo]), 'owner_info.xlsx');
  formData.append('appointment_info', new Blob([apptInfo]), 'appointment_info.xlsx');
  formData.append('dryRun', 'false');
  // No stream mode

  console.log('Starting import (non-streaming mode)...');
  console.log('Files:');
  console.log('  cat_info: 23,316 rows');
  console.log('  owner_info: 23,316 rows');
  console.log('  appointment_info: 197,223 rows');
  console.log('');
  console.log('This may take several minutes...');

  const startTime = Date.now();

  try {
    const response = await fetch('http://localhost:3000/api/v2/ingest/clinichq', {
      method: 'POST',
      body: formData,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nStatus: ${response.status} (${elapsed}s)`);

    if (!response.ok) {
      const text = await response.text();
      console.error('Error:', text);
      return;
    }

    const result = await response.json();
    console.log('\n=== Import Complete ===');
    console.log(`Message: ${result.message}`);
    console.log(`Time: ${result.elapsedMs}ms`);
    console.log('\nStats:');
    console.log(`  Unique cats: ${result.stats?.total || 'N/A'}`);
    console.log(`  Unique appointments: ${result.stats?.uniqueAppointments || 'N/A'}`);
    console.log(`  Cats created: ${result.stats?.catsCreated || 0}`);
    console.log(`  Cats matched: ${result.stats?.catsMatched || 0}`);
    console.log(`  People created: ${result.stats?.personsCreated || 0}`);
    console.log(`  People matched: ${result.stats?.personsMatched || 0}`);
    console.log(`  Places created: ${result.stats?.placesCreated || 0}`);
    console.log(`  Places matched: ${result.stats?.placesMatched || 0}`);
    console.log(`  Dropped rows: ${result.stats?.droppedRows || 0}`);
    console.log(`  Pending microchip: ${result.stats?.pendingMicrochipCount || 0}`);
    console.log(`  Errors: ${result.stats?.errors || 0}`);

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`Request error after ${elapsed}s:`, error.message);
  }
}

runImport();
