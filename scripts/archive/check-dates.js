const XLSX = require('xlsx');
const catWb = XLSX.readFile('/Users/benmisdiaz/Downloads/report_2fdf1ebf-5724-432c-8ba3-6225b6bd356e.xlsx');
const catInfoRows = XLSX.utils.sheet_to_json(catWb.Sheets[catWb.SheetNames[0]]);

// Check date formats
console.log('=== Sample Date Values (last 20 rows) ===');
catInfoRows.slice(-20).forEach((r, i) => {
  console.log(`Row ${catInfoRows.length - 20 + i}: Date=${r['Date']}, Type=${typeof r['Date']}`);
});

// Filter for 2026
const rows2026 = catInfoRows.filter(r => {
  const date = r['Date'];
  if (!date) return false;
  if (date instanceof Date) {
    return date.getFullYear() === 2026;
  }
  const str = String(date);
  return str.includes('2026') || str.includes('/26');
});

console.log('\n=== 2026 Data ===');
console.log('Total 2026 rows:', rows2026.length);

// Group by date
const byDate = {};
rows2026.forEach(r => {
  const d = r['Date'];
  const key = d instanceof Date ? d.toISOString().split('T')[0] : String(d);
  byDate[key] = (byDate[key] || 0) + 1;
});

console.log('\nBy date:');
Object.entries(byDate).sort().forEach(([k, v]) => console.log(`  ${k}: ${v} rows`));

// Check specific Feb dates
console.log('\n=== Feb 2026 Clinic Days ===');
const febDates = ['2/2/2026', '2/4/2026', '2/9/2026', '2/11/2026', '2/16/2026'];
febDates.forEach(d => {
  const count = catInfoRows.filter(r => String(r['Date']) === d).length;
  const withChip = catInfoRows.filter(r => String(r['Date']) === d && r['Microchip Number'] && String(r['Microchip Number']).length >= 9).length;
  const withoutChip = catInfoRows.filter(r => String(r['Date']) === d && (!r['Microchip Number'] || String(r['Microchip Number']).length < 9)).length;
  console.log(`${d}: ${count} total (${withChip} with chip, ${withoutChip} without - now saved)`);
});
