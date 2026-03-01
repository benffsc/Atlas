const XLSX = require('xlsx');
const fs = require('fs');

const buffer = fs.readFileSync('/Users/benmisdiaz/Downloads/report_84fbfd9d-7e22-4361-89dd-45f62f56a2e4.xlsx');
const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

// Find rows without microchip AND without appointment number
const missing = rows.filter(r => {
  const chip = r['Microchip Number'] || r['Microchip #'] || r['MicrochipNumber'];
  const appt = r['Number'] || r['Appointment Number'] || r['Appt #'];
  return !chip && !appt;
});

console.log('Rows without microchip AND appointment number:', missing.length);
console.log('\nSample of these rows:');
missing.slice(0, 10).forEach((r, i) => {
  console.log('\n--- Row', i+1, '---');
  console.log('Date:', r['Date']);
  console.log('Animal Name:', r['Animal Name']);
  console.log('Owner First:', r['Owner First Name']);
  console.log('Owner Last:', r['Owner Last Name']);
  console.log('Vet:', r['Vet Name']);
});
