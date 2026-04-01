/**
 * Direct V2 Import - bypasses API to avoid timeout
 * Processes ClinicHQ exports directly against the database
 */

require('dotenv').config({ path: '.env.local' });
const XLSX = require('xlsx');
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

// Stats
let stats = {
  total: 0,
  catsCreated: 0,
  catsMatched: 0,
  personsCreated: 0,
  personsMatched: 0,
  placesCreated: 0,
  placesMatched: 0,
  pseudoProfiles: 0,
  appointmentsCreated: 0,
  appointmentsUpdated: 0,
  errors: 0,
  pendingMicrochipCount: 0,
};

// Helper functions
function computeRowHash(payload) {
  const sortedJson = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('md5').update(sortedJson).digest('hex');
}

function getString(row, ...keys) {
  for (const key of keys) {
    const value = row[key];
    if (value && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function normalizeEmail(email) {
  if (!email) return null;
  return email.toLowerCase().trim() || null;
}

function parseXlsxFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const rawData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: true,
  });

  if (rawData.length === 0) return [];

  const rawHeaders = rawData[0];
  const headers = rawHeaders.map((h, i) => h ? String(h).trim() : `_col_${i + 1}`);

  const microchipColIndex = headers.findIndex(h =>
    h === 'Microchip' || h === 'Microchip Number' || h === 'Chip' || h === 'Microchip #'
  );

  const rows = [];
  for (let i = 1; i < rawData.length; i++) {
    const rowArray = rawData[i];
    const rowObj = {};
    let hasData = false;

    for (let j = 0; j < headers.length; j++) {
      let value = j < rowArray.length ? rowArray[j] : '';

      if (j === microchipColIndex && typeof value === 'number') {
        value = value.toFixed(0);
      } else if (typeof value === 'string') {
        value = value.trim();
      } else if (value instanceof Date) {
        value = value.toISOString();
      }

      rowObj[headers[j]] = value;
      if (value !== '' && value !== null && value !== undefined) hasData = true;
    }

    if (hasData) rows.push(rowObj);
  }

  return rows;
}

function getMicrochipFromRow(row) {
  let chip = getString(row, 'Microchip', 'Microchip Number', 'Chip', 'Microchip #');
  if (!chip) {
    const rawChip = row['Microchip Number'] ?? row['Microchip'];
    if (typeof rawChip === 'number') {
      chip = rawChip.toFixed(0);
    }
  }
  if (!chip || chip.length < 9) return null;

  if (chip.includes('E') || chip.includes('e')) {
    try {
      const num = parseFloat(chip);
      if (!isNaN(num)) {
        chip = num.toFixed(0);
      }
    } catch {
      // Keep original
    }
  }

  return chip;
}

function extractMicrochipFromAnimalName(row) {
  const animalName = getString(row, 'Animal Name', 'Cat Name', 'Name');
  if (!animalName) return null;

  const match = animalName.match(/\b(9\d{14})\b/);
  if (match) return match[1];

  const shortMatch = animalName.match(/\b(9\d{8,9})\b/);
  if (shortMatch) return shortMatch[1];

  return null;
}

function getAppointmentNumberFromRow(row) {
  return getString(row, 'Number', 'Appointment Number', 'Appt Number', 'Appt #', 'ID');
}

function getDateFromRow(row) {
  const dateStr = getString(
    row,
    'Date', 'Appointment Date', 'Service Date', 'Visit Date', 'Clinic Date',
    'Appt Date', 'AppointmentDate', 'VisitDate', 'ServiceDate', 'ClinicDate',
    'date', 'appointment_date', 'visit_date'
  );
  if (!dateStr) return null;

  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch {
    // Fall through
  }
  return dateStr;
}

function mergeFilesByVisit(catInfoRows, ownerInfoRows, appointmentInfoRows) {
  const visitsByKey = new Map();
  let totalServiceItems = 0;
  let droppedRows = 0;

  const getVisitKey = (row) => {
    const date = getDateFromRow(row);
    if (!date) {
      droppedRows++;
      return null;
    }

    let chip = getMicrochipFromRow(row);
    if (!chip) chip = extractMicrochipFromAnimalName(row);

    if (chip) {
      return { key: `${chip}|${date}`, microchip: chip };
    }

    const apptNumber = getAppointmentNumberFromRow(row);
    if (apptNumber) {
      return { key: `appt:${apptNumber}|${date}`, microchip: `PENDING_${apptNumber}` };
    }

    droppedRows++;
    return null;
  };

  for (const row of catInfoRows) {
    const result = getVisitKey(row);
    if (result) {
      const { key, microchip } = result;
      const date = getDateFromRow(row);
      if (!visitsByKey.has(key)) {
        visitsByKey.set(key, { microchip, date, serviceItems: [], appointmentRows: [] });
      }
      visitsByKey.get(key).catInfo = row;
    }
  }

  for (const row of ownerInfoRows) {
    const result = getVisitKey(row);
    if (result) {
      const { key, microchip } = result;
      const date = getDateFromRow(row);
      if (!visitsByKey.has(key)) {
        visitsByKey.set(key, { microchip, date, serviceItems: [], appointmentRows: [] });
      }
      visitsByKey.get(key).ownerInfo = row;
    }
  }

  // appointment_service rows: rows WITH Appt# are parent appointments,
  // following rows WITHOUT Appt# are child service items for that appointment
  let currentVisitKey = null;
  for (const row of appointmentInfoRows) {
    const apptNumber = getAppointmentNumberFromRow(row);
    const serviceItem = getString(row, 'Service / Subsidy', 'Service Item', 'Procedure', 'Service', 'Item', 'Description');

    if (apptNumber) {
      // This is a parent appointment row - get its key
      const result = getVisitKey(row);
      if (result) {
        totalServiceItems++;
        const { key, microchip } = result;
        const date = getDateFromRow(row);
        currentVisitKey = key;

        if (!visitsByKey.has(key)) {
          visitsByKey.set(key, { microchip, date, serviceItems: [], appointmentRows: [] });
        }
        const visit = visitsByKey.get(key);
        visit.appointmentRows.push(row);

        if (serviceItem) {
          visit.serviceItems.push(serviceItem);
        }
      }
    } else if (serviceItem && currentVisitKey && visitsByKey.has(currentVisitKey)) {
      // This is a child service row - attach to current appointment
      totalServiceItems++;
      const visit = visitsByKey.get(currentVisitKey);
      visit.serviceItems.push(serviceItem);
    }
    // Rows with neither apptNumber nor serviceItem are truly empty - skip
  }

  // Sort by date ascending (oldest first) to fill gaps in 2014-2015 quickly
  const visits = Array.from(visitsByKey.values()).sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateA - dateB;  // Ascending - oldest first
  });

  return {
    visits,
    totalServiceItems,
    uniqueVisits: visits.length,
    droppedRows,
  };
}

async function processVisit(client, visit) {
  const catInfo = visit.catInfo || {};
  const ownerInfo = visit.ownerInfo || {};

  const catName = getString(catInfo, 'Cat Name', 'Animal Name', 'Name');
  const catSex = getString(catInfo, 'Sex', 'Gender');
  const catBreed = getString(catInfo, 'Breed');
  const clinichqAnimalId = getString(catInfo, 'Number');
  const primaryColor = getString(catInfo, 'Primary Color', 'Color', 'Colour', 'Coat Color');

  const rawOwnership = getString(ownerInfo, 'Ownership');
  let ownershipType = null;
  if (rawOwnership) {
    switch (rawOwnership) {
      case 'Community Cat (Feral)': ownershipType = 'feral'; break;
      case 'Community Cat (Friendly)': ownershipType = 'community'; break;
      case 'Owned': ownershipType = 'owned'; break;
      case 'Foster': ownershipType = 'foster'; break;
      default: ownershipType = 'unknown'; break;
    }
  }

  // Create cat
  const isPendingMicrochip = visit.microchip.startsWith('PENDING_');
  const actualMicrochip = isPendingMicrochip ? null : visit.microchip;

  if (isPendingMicrochip) stats.pendingMicrochipCount++;

  let catId = null;

  if (actualMicrochip) {
    const result = await client.query(`
      SELECT sot.find_or_create_cat_by_microchip(
        p_microchip := $1,
        p_name := $2,
        p_sex := $3,
        p_breed := $4,
        p_altered_status := NULL,
        p_color := $5,
        p_source_system := 'clinichq',
        p_clinichq_animal_id := $6,
        p_ownership_type := $7
      ) as cat_id
    `, [actualMicrochip, catName || null, catSex || null, catBreed || null, primaryColor || null, clinichqAnimalId || null, ownershipType || null]);
    catId = result.rows[0]?.cat_id;
  } else if (clinichqAnimalId) {
    const result = await client.query(`
      SELECT sot.find_or_create_cat_by_clinichq_id(
        p_clinichq_animal_id := $1,
        p_name := $2,
        p_sex := $3,
        p_breed := $4,
        p_altered_status := NULL,
        p_color := $5,
        p_source_system := 'clinichq',
        p_ownership_type := $6
      ) as cat_id
    `, [clinichqAnimalId, catName || null, catSex || null, catBreed || null, primaryColor || null, ownershipType || null]);
    catId = result.rows[0]?.cat_id;
  }

  if (catId) {
    const isNew = await client.query(`
      SELECT created_at > NOW() - INTERVAL '1 second' as is_new
      FROM sot.cats WHERE cat_id = $1
    `, [catId]);

    if (isNew.rows[0]?.is_new) {
      stats.catsCreated++;
    } else {
      stats.catsMatched++;
    }
  }

  // Process owner
  const mergedData = { ...catInfo, ...ownerInfo };
  const ownerFirstName = getString(mergedData, 'Owner First Name', 'First Name');
  const ownerLastName = getString(mergedData, 'Owner Last Name', 'Last Name');
  const ownerEmail = normalizeEmail(getString(mergedData, 'Owner Email', 'Email'));
  const ownerPhone = normalizePhone(getString(mergedData, 'Owner Phone', 'Phone', 'Owner Cell Phone', 'Cell Phone'));
  const ownerAddress = getString(mergedData, 'Owner Address', 'Address', 'Street');

  let personId = null;
  let placeId = null;

  // Classify owner
  const displayName = [ownerFirstName, ownerLastName].filter(Boolean).join(' ').trim();

  let shouldBePerson = false;
  if (displayName && (ownerEmail || ownerPhone)) {
    const classResult = await client.query(`
      SELECT sot.should_be_person($1, $2, $3, $4) as should_create
    `, [ownerFirstName || null, ownerLastName || null, ownerEmail || null, ownerPhone || null]);
    shouldBePerson = classResult.rows[0]?.should_create || false;
  }

  // Wrap person/place creation in try/catch so appointment still gets created on error
  try {
    if (shouldBePerson) {
      const result = await client.query(`
        SELECT sot.find_or_create_person(
          p_email := $1,
          p_phone := $2,
          p_first_name := $3,
          p_last_name := $4,
          p_address := $5,
          p_source_system := 'clinichq'
        ) as person_id
      `, [ownerEmail, ownerPhone, ownerFirstName || null, ownerLastName || null, ownerAddress || null]);

      personId = result.rows[0]?.person_id;

      if (personId) {
        const isNew = await client.query(`
          SELECT created_at > NOW() - INTERVAL '2 seconds' as is_new
          FROM sot.people WHERE person_id = $1
        `, [personId]);

        if (isNew.rows[0]?.is_new) {
          stats.personsCreated++;
        } else {
          stats.personsMatched++;
        }

        // Create place
        if (ownerAddress) {
          const placeResult = await client.query(`
            SELECT sot.find_or_create_place_deduped(
              p_formatted_address := $1,
              p_display_name := NULL,
              p_lat := NULL,
              p_lng := NULL,
              p_source_system := 'clinichq'
            ) as place_id
          `, [ownerAddress]);

          placeId = placeResult.rows[0]?.place_id;

          if (placeId) {
            const isNewPlace = await client.query(`
              SELECT created_at > NOW() - INTERVAL '1 second' as is_new
              FROM sot.places WHERE place_id = $1
            `, [placeId]);

            if (isNewPlace.rows[0]?.is_new) {
              stats.placesCreated++;
            } else {
              stats.placesMatched++;
            }

            // Link person to place
            await client.query(`
              SELECT sot.link_person_to_place(
                p_person_id := $1,
                p_place_id := $2,
                p_relationship_type := 'resident',
                p_evidence_type := 'appointment',
                p_source_system := 'clinichq',
                p_confidence := 0.7
              )
            `, [personId, placeId]);
          }
        }
      }
    } else if (displayName) {
      stats.pseudoProfiles++;
    }
  } catch (personErr) {
    // Log person linking error but continue to create appointment
    stats.personLinkErrors = (stats.personLinkErrors || 0) + 1;
    // Don't throw - appointment will still be created with null person_id
  }

  // Create appointment
  const appointmentKey = actualMicrochip || clinichqAnimalId || visit.microchip;
  const appointmentId = `${visit.date}_${appointmentKey}`;

  // Store in source layer
  const sourceRecordId = clinichqAnimalId || visit.microchip;
  if (visit.catInfo) {
    const hash = computeRowHash(visit.catInfo);
    await client.query(`
      INSERT INTO source.clinichq_raw (record_type, source_record_id, payload, row_hash)
      VALUES ('cat', $1, $2, $3)
      ON CONFLICT (record_type, source_record_id, row_hash) DO NOTHING
    `, [sourceRecordId, JSON.stringify(visit.catInfo), hash]);
  }
  if (visit.ownerInfo) {
    const hash = computeRowHash(visit.ownerInfo);
    await client.query(`
      INSERT INTO source.clinichq_raw (record_type, source_record_id, payload, row_hash)
      VALUES ('owner', $1, $2, $3)
      ON CONFLICT (record_type, source_record_id, row_hash) DO NOTHING
    `, [sourceRecordId, JSON.stringify(visit.ownerInfo), hash]);
  }

  // Create ops appointment
  const apptResult = await client.query(`
    INSERT INTO ops.appointments (
      clinichq_appointment_id, appointment_date,
      owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
      owner_raw_payload, cat_id, person_id, inferred_place_id, resolution_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (clinichq_appointment_id) DO UPDATE SET
      owner_first_name = COALESCE(EXCLUDED.owner_first_name, ops.appointments.owner_first_name),
      owner_last_name = COALESCE(EXCLUDED.owner_last_name, ops.appointments.owner_last_name),
      owner_email = COALESCE(EXCLUDED.owner_email, ops.appointments.owner_email),
      owner_phone = COALESCE(EXCLUDED.owner_phone, ops.appointments.owner_phone),
      owner_address = COALESCE(EXCLUDED.owner_address, ops.appointments.owner_address),
      owner_raw_payload = COALESCE(EXCLUDED.owner_raw_payload, ops.appointments.owner_raw_payload),
      cat_id = COALESCE(EXCLUDED.cat_id, ops.appointments.cat_id),
      person_id = COALESCE(EXCLUDED.person_id, ops.appointments.person_id),
      inferred_place_id = COALESCE(EXCLUDED.inferred_place_id, ops.appointments.inferred_place_id),
      updated_at = NOW()
    RETURNING (xmax = 0) as is_insert
  `, [
    appointmentId,
    visit.date,
    ownerFirstName || null,
    ownerLastName || null,
    ownerEmail || null,
    ownerPhone || null,
    ownerAddress || null,
    JSON.stringify({ ...mergedData, serviceItems: visit.serviceItems }),
    catId || null,
    personId,
    placeId,
    personId ? 'auto_linked' : (shouldBePerson ? 'pending' : 'pseudo_profile'),
  ]);

  if (apptResult.rows[0]?.is_insert) {
    stats.appointmentsCreated++;
  } else {
    stats.appointmentsUpdated++;
  }
}

async function main() {
  console.log('=== V2 Direct Import ===\n');

  console.log('Parsing files...');
  // Complete historical exports (2013-2026)
  const catInfoRows = parseXlsxFile('/Users/benmisdiaz/Downloads/report_84fbfd9d-7e22-4361-89dd-45f62f56a2e4.xlsx');
  const ownerInfoRows = parseXlsxFile('/Users/benmisdiaz/Downloads/report_26d21555-a11f-4442-ae94-77c20a0d90fd.xlsx');
  const appointmentInfoRows = parseXlsxFile('/Users/benmisdiaz/Downloads/report_5814679a-ca2b-4da7-aa36-6c78a5555338.xlsx');

  console.log(`  cat_info: ${catInfoRows.length} rows`);
  console.log(`  owner_info: ${ownerInfoRows.length} rows`);
  console.log(`  appointment_service: ${appointmentInfoRows.length} rows`);

  console.log('\nMerging by visit...');
  const { visits, totalServiceItems, uniqueVisits, droppedRows } = mergeFilesByVisit(
    catInfoRows,
    ownerInfoRows,
    appointmentInfoRows
  );

  console.log(`  Unique visits: ${uniqueVisits}`);
  console.log(`  Total service items: ${totalServiceItems}`);
  console.log(`  Dropped rows: ${droppedRows}`);

  stats.total = visits.length;

  console.log('\nProcessing visits...');
  const startTime = Date.now();

  const client = await pool.connect();
  try {
    for (let i = 0; i < visits.length; i++) {
      try {
        await processVisit(client, visits[i]);
      } catch (err) {
        console.error(`Error at visit ${i + 1} (${visits[i].microchip}):`, err.message);
        stats.errors++;
      }

      if ((i + 1) % 1000 === 0 || i === visits.length - 1) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = ((i + 1) / parseFloat(elapsed)).toFixed(1);
        console.log(`  Progress: ${i + 1}/${visits.length} (${rate} visits/sec, ${elapsed}s elapsed)`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n=== Import Complete ===');
  console.log(`Time: ${elapsed}s`);
  console.log(`Visits processed: ${stats.total}`);
  console.log(`Appointments created: ${stats.appointmentsCreated}`);
  console.log(`Appointments updated: ${stats.appointmentsUpdated}`);
  console.log(`Cats created: ${stats.catsCreated}, matched: ${stats.catsMatched}`);
  console.log(`People created: ${stats.personsCreated}, matched: ${stats.personsMatched}`);
  console.log(`Places created: ${stats.placesCreated}, matched: ${stats.placesMatched}`);
  console.log(`Pseudo-profiles: ${stats.pseudoProfiles}`);
  console.log(`Pending microchip: ${stats.pendingMicrochipCount}`);
  console.log(`Person link errors (appt still created): ${stats.personLinkErrors || 0}`);
  console.log(`Fatal errors: ${stats.errors}`);
}

main().catch(console.error);
