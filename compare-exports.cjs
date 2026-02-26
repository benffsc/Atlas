/**
 * ClinicHQ Export Comparison Tool
 *
 * Compare two exports to see what changed (microchips added, data corrected, etc.)
 *
 * Usage: node compare-exports.cjs <old-export.xlsx> <new-export.xlsx>
 */

const XLSX = require('xlsx');
const fs = require('fs');

const OLD_FILE = process.argv[2];
const NEW_FILE = process.argv[3];

if (!OLD_FILE || !NEW_FILE) {
  console.log('Usage: node compare-exports.cjs <old-export.xlsx> <new-export.xlsx>');
  console.log('');
  console.log('Example:');
  console.log('  node compare-exports.cjs report_january.xlsx report_february.xlsx');
  process.exit(1);
}

function loadExport(file) {
  if (!fs.existsSync(file)) {
    console.error('File not found:', file);
    process.exit(1);
  }
  const buffer = fs.readFileSync(file);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
}

function getKey(row) {
  // Use appointment number as primary key, fallback to animal name + date
  const apptNum = (row['Appointment Number'] || row['Number'] || row['Appt Number'] || '').toString().trim();
  if (apptNum) return `appt:${apptNum}`;

  const name = (row['Animal Name'] || row['Name'] || '').toString().trim();
  const date = (row['Date'] || row['Appointment Date'] || '').toString().trim();
  return `name-date:${name}:${date}`;
}

function getMicrochip(row) {
  return (row['Microchip Number'] || row['Microchip #'] || '').toString().trim() || null;
}

function getCatName(row) {
  return (row['Animal Name'] || row['Name'] || '').toString().trim();
}

function getOwner(row) {
  const first = (row['Owner First Name'] || '').toString().trim();
  const last = (row['Owner Last Name'] || '').toString().trim();
  return `${first} ${last}`.trim();
}

console.log('='.repeat(70));
console.log('ClinicHQ Export Comparison');
console.log('='.repeat(70));
console.log('Old:', OLD_FILE.split('/').pop());
console.log('New:', NEW_FILE.split('/').pop());
console.log('');

const oldRows = loadExport(OLD_FILE);
const newRows = loadExport(NEW_FILE);

console.log(`Old export: ${oldRows.length} rows`);
console.log(`New export: ${newRows.length} rows`);
console.log('');

// Index old rows by key
const oldByKey = new Map();
for (const row of oldRows) {
  const key = getKey(row);
  oldByKey.set(key, row);
}

// Compare
const changes = {
  microchipsAdded: [],
  microchipsChanged: [],
  namesChanged: [],
  ownersChanged: [],
  newRecords: []
};

for (const newRow of newRows) {
  const key = getKey(newRow);
  const oldRow = oldByKey.get(key);

  if (!oldRow) {
    // New record
    changes.newRecords.push({
      key,
      name: getCatName(newRow),
      microchip: getMicrochip(newRow),
      owner: getOwner(newRow),
      date: (newRow['Date'] || newRow['Appointment Date'] || '').toString()
    });
    continue;
  }

  // Compare microchip
  const oldChip = getMicrochip(oldRow);
  const newChip = getMicrochip(newRow);

  if (!oldChip && newChip) {
    changes.microchipsAdded.push({
      key,
      name: getCatName(newRow),
      microchip: newChip,
      owner: getOwner(newRow),
      date: (newRow['Date'] || newRow['Appointment Date'] || '').toString()
    });
  } else if (oldChip && newChip && oldChip !== newChip) {
    changes.microchipsChanged.push({
      key,
      name: getCatName(newRow),
      oldChip,
      newChip,
      owner: getOwner(newRow)
    });
  }

  // Compare name
  const oldName = getCatName(oldRow);
  const newName = getCatName(newRow);
  if (oldName && newName && oldName.toLowerCase() !== newName.toLowerCase()) {
    changes.namesChanged.push({
      key,
      oldName,
      newName,
      owner: getOwner(newRow)
    });
  }

  // Compare owner
  const oldOwner = getOwner(oldRow);
  const newOwner = getOwner(newRow);
  if (oldOwner !== newOwner && newOwner) {
    changes.ownersChanged.push({
      key,
      name: getCatName(newRow),
      oldOwner: oldOwner || '(none)',
      newOwner
    });
  }
}

// Print results
if (changes.microchipsAdded.length > 0) {
  console.log('='.repeat(70));
  console.log(`MICROCHIPS ADDED (${changes.microchipsAdded.length})`);
  console.log('='.repeat(70));
  for (const c of changes.microchipsAdded) {
    console.log(`  ${c.name} (${c.owner}) - ${c.date}`);
    console.log(`    → Chip: ${c.microchip}`);
  }
  console.log('');
}

if (changes.microchipsChanged.length > 0) {
  console.log('='.repeat(70));
  console.log(`MICROCHIPS CHANGED (${changes.microchipsChanged.length})`);
  console.log('='.repeat(70));
  for (const c of changes.microchipsChanged) {
    console.log(`  ${c.name} (${c.owner})`);
    console.log(`    Old: ${c.oldChip}`);
    console.log(`    New: ${c.newChip}`);
  }
  console.log('');
}

if (changes.namesChanged.length > 0) {
  console.log('='.repeat(70));
  console.log(`NAMES CHANGED (${changes.namesChanged.length})`);
  console.log('='.repeat(70));
  for (const c of changes.namesChanged) {
    console.log(`  "${c.oldName}" → "${c.newName}" (${c.owner})`);
  }
  console.log('');
}

if (changes.ownersChanged.length > 0) {
  console.log('='.repeat(70));
  console.log(`OWNERS CHANGED (${changes.ownersChanged.length})`);
  console.log('='.repeat(70));
  for (const c of changes.ownersChanged) {
    console.log(`  ${c.name}: "${c.oldOwner}" → "${c.newOwner}"`);
  }
  console.log('');
}

if (changes.newRecords.length > 0) {
  console.log('='.repeat(70));
  console.log(`NEW RECORDS (${changes.newRecords.length})`);
  console.log('='.repeat(70));
  for (const c of changes.newRecords.slice(0, 20)) {
    console.log(`  ${c.name} (${c.owner}) - ${c.date} - ${c.microchip || 'no chip'}`);
  }
  if (changes.newRecords.length > 20) {
    console.log(`  ... and ${changes.newRecords.length - 20} more`);
  }
  console.log('');
}

// Summary
const totalChanges = changes.microchipsAdded.length + changes.microchipsChanged.length +
                     changes.namesChanged.length + changes.ownersChanged.length;

console.log('='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));
console.log(`Microchips added:   ${changes.microchipsAdded.length}`);
console.log(`Microchips changed: ${changes.microchipsChanged.length}`);
console.log(`Names changed:      ${changes.namesChanged.length}`);
console.log(`Owners changed:     ${changes.ownersChanged.length}`);
console.log(`New records:        ${changes.newRecords.length}`);
console.log(`Total updates:      ${totalChanges}`);

if (totalChanges > 0) {
  console.log('');
  console.log('To apply these updates to the database, run:');
  console.log(`  node sync-clinichq-updates.cjs "${NEW_FILE}" --dry-run`);
  console.log('Then without --dry-run to apply.');
}
