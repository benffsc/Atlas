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
  formData.append('stream', 'true');

  console.log('Starting import...');
  console.log('Files:');
  console.log('  cat_info: report_2fdf1ebf... (23,316 rows)');
  console.log('  owner_info: report_b57be615... (23,316 rows)');
  console.log('  appointment_info: report_4740640d... (197,223 rows)');
  console.log('');

  try {
    const response = await fetch('http://localhost:3000/api/v2/ingest/clinichq', {
      method: 'POST',
      body: formData,
    });

    console.log(`Status: ${response.status}`);

    if (!response.ok) {
      const text = await response.text();
      console.error('Error:', text);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'progress') {
              process.stdout.write(`\r${data.message} | Cats: ${data.stats?.catsCreated || 0}/${data.stats?.catsMatched || 0} | People: ${data.stats?.personsCreated || 0}/${data.stats?.personsMatched || 0}   `);
            } else if (data.type === 'complete') {
              console.log('\n\n=== Import Complete ===');
              console.log(`Time: ${data.elapsedMs}ms`);
              console.log(`Message: ${data.message}`);
              console.log('\nStats:');
              console.log(JSON.stringify(data.stats, null, 2));
            } else if (data.type === 'error') {
              console.error('\nError:', data.error);
            }
          } catch (e) {
            // Not JSON, skip
          }
        }
      }
    }

    console.log('\nDone');
  } catch (error) {
    console.error('Request error:', error.message);
  }
}

runImport();
