require('dotenv').config({ path: '.env.local' });
const XLSX = require('xlsx');
const fs = require('fs');

function parseXlsx(path) {
  const buffer = fs.readFileSync(path);
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
}

const apptPath = '/Users/benmisdiaz/Downloads/report_4740640d-575f-4988-ab46-4101a14288e7.xlsx';
const rows = parseXlsx(apptPath);

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

const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

console.log('Export file date range:');
console.log('  Earliest:', minDate.toISOString().slice(0,10));
console.log('  Latest:', maxDate.toISOString().slice(0,10));
console.log('  Total rows:', rows.length);

const byYear = {};
dates.forEach(d => {
  const year = d.getFullYear();
  byYear[year] = (byYear[year] || 0) + 1;
});

console.log('\nRows by year in export:');
Object.keys(byYear).sort().forEach(y => {
  console.log('  ' + y + ': ' + byYear[y]);
});
