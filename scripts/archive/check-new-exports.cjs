require('dotenv').config({ path: '.env.local' });
const XLSX = require('xlsx');
const fs = require('fs');

function parseXlsx(path) {
  const buffer = fs.readFileSync(path);
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
}

const files = [
  { name: 'appointment_service', path: '/Users/benmisdiaz/Downloads/report_5814679a-ca2b-4da7-aa36-6c78a5555338.xlsx' },
  { name: 'cat_info', path: '/Users/benmisdiaz/Downloads/report_84fbfd9d-7e22-4361-89dd-45f62f56a2e4.xlsx' },
  { name: 'owner_info', path: '/Users/benmisdiaz/Downloads/report_26d21555-a11f-4442-ae94-77c20a0d90fd.xlsx' },
];

files.forEach(f => {
  console.log(`\n=== ${f.name} ===`);
  const rows = parseXlsx(f.path);
  console.log('Total rows:', rows.length);

  // Sample first row to see columns
  if (rows.length > 0) {
    console.log('Columns:', Object.keys(rows[0]).join(', '));
  }

  // Find dates
  const dates = [];
  rows.forEach(r => {
    const d = r['Date'] || r['Appointment Date'] || r['Service Date'];
    if (d) {
      const parsed = d instanceof Date ? d : new Date(d);
      if (parsed && !isNaN(parsed.getTime())) {
        dates.push(parsed);
      }
    }
  });

  if (dates.length > 0) {
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    console.log('Date range:', minDate.toISOString().slice(0,10), 'to', maxDate.toISOString().slice(0,10));

    // Count by year
    const byYear = {};
    dates.forEach(d => {
      const year = d.getFullYear();
      byYear[year] = (byYear[year] || 0) + 1;
    });
    console.log('By year:');
    Object.keys(byYear).sort().forEach(y => {
      console.log('  ' + y + ': ' + byYear[y]);
    });
  }
});
