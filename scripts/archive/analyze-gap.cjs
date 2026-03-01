const XLSX = require('xlsx');
const fs = require('fs');

function parseXlsx(path) {
  const buffer = fs.readFileSync(path);
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
}

function getKey(row) {
  const date = row['Date'];
  if (!date) return null;
  const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : String(date).split('T')[0];

  const chip = row['Microchip Number'] || row['Microchip #'];
  if (chip) return `${chip}|${dateStr}`;

  const appt = row['Number'] || row['Appointment Number'];
  if (appt) return `appt:${appt}|${dateStr}`;

  return null;
}

const catInfo = parseXlsx('/Users/benmisdiaz/Downloads/report_84fbfd9d-7e22-4361-89dd-45f62f56a2e4.xlsx');
const ownerInfo = parseXlsx('/Users/benmisdiaz/Downloads/report_26d21555-a11f-4442-ae94-77c20a0d90fd.xlsx');

console.log('cat_info rows:', catInfo.length);
console.log('owner_info rows:', ownerInfo.length);

// Build key sets
const catKeys = new Set();
const ownerKeys = new Set();

catInfo.forEach(r => {
  const key = getKey(r);
  if (key) catKeys.add(key);
});

ownerInfo.forEach(r => {
  const key = getKey(r);
  if (key) ownerKeys.add(key);
});

console.log('\nUnique cat_info keys:', catKeys.size);
console.log('Unique owner_info keys:', ownerKeys.size);

// Find keys in cat but not in owner (and vice versa)
const catOnly = [...catKeys].filter(k => !ownerKeys.has(k));
const ownerOnly = [...ownerKeys].filter(k => !catKeys.has(k));

console.log('\nKeys in cat_info but not owner_info:', catOnly.length);
console.log('Keys in owner_info but not cat_info:', ownerOnly.length);

// The unique visits would be the union
const allKeys = new Set([...catKeys, ...ownerKeys]);
console.log('Union of all keys:', allKeys.size);

// Show some cat-only keys
console.log('\nSample cat-only keys (first 5):');
catOnly.slice(0, 5).forEach(k => console.log(' ', k));

// Check for duplicate keys within cat_info
const catKeyCount = {};
catInfo.forEach(r => {
  const key = getKey(r);
  if (key) {
    catKeyCount[key] = (catKeyCount[key] || 0) + 1;
  }
});
const duplicates = Object.entries(catKeyCount).filter(([k, v]) => v > 1);
console.log('\nDuplicate keys in cat_info:', duplicates.length);
if (duplicates.length > 0) {
  console.log('Sample duplicates:');
  duplicates.slice(0, 5).forEach(([k, v]) => console.log(' ', k, ':', v, 'occurrences'));
}
