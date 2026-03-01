const XLSX = require('xlsx');
const fs = require('fs');

const partial = '98102005383'; // First 11 digits

const files = [
  '/Users/benmisdiaz/Downloads/report_84fbfd9d-7e22-4361-89dd-45f62f56a2e4.xlsx',
  '/Users/benmisdiaz/Downloads/report_26d21555-a11f-4442-ae94-77c20a0d90fd.xlsx'
];

console.log('Searching for chips starting with:', partial);

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  
  const buffer = fs.readFileSync(file);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  
  console.log('\n' + file.split('/').pop() + ':');
  
  for (const row of rows) {
    const mc = (row['Microchip Number'] || row['Microchip #'] || '').toString();
    if (mc.startsWith(partial)) {
      const owner = (row['Owner First Name'] || '') + ' ' + (row['Owner Last Name'] || '');
      const date = row['Date'];
      const name = row['Animal Name'];
      console.log('  ' + mc + ' - ' + name + ' (' + owner.trim() + ') - ' + date);
    }
  }
}
