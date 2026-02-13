#!/usr/bin/env node
/**
 * Airtable Public Intake Sync
 *
 * Syncs submissions from Jotform → Airtable → Atlas
 * This runs via Vercel cron job every 30 minutes.
 *
 * Data flow:
 * 1. Public fills out Jotform
 * 2. Jotform pushes to Airtable "Public Intake Submissions" table
 * 3. This script pulls pending records and POSTs to Atlas intake API
 * 4. Updates Airtable with sync status
 *
 * Jotform field names (as sent to Airtable):
 * - "What best describes your situation?" → callType
 * - "Your Name" → yourName (with First/Last subfields)
 * - etc.
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
dotenv.config({ path: join(__dirname, "../../.env") });

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_ATLAS_SYNC_BASE_ID || "appwFuRddph1krmcd";
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_PUBLIC_INTAKE_TABLE_ID || "tblGQDVELZBhnxvUm";
const ATLAS_API_URL = process.env.ATLAS_API_URL || "http://localhost:3000";

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
  console.error("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID");
  process.exit(1);
}

const AIRTABLE_API = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;

// Field name mapping: Jotform question text → Airtable column name
// Update this if Jotform field names differ from Airtable columns
const FIELD_MAP = {
  // These are the expected Airtable column names based on Jotform questions
  // Jotform uses question text as field name when pushing to Airtable
  callType: ["callType", "Call Type", "What best describes your situation?"],
  firstName: ["First Name", "yourName - First", "First"],
  lastName: ["Last Name", "yourName - Last", "Last"],
  email: ["Email", "Email Address", "email"],
  phone: ["Phone", "Phone Number", "phone"],

  // Requester's own address (new fields)
  requesterAddress: ["Requester Address", "requesterAddress", "Your Street Address"],
  requesterCity: ["Requester City", "requesterCity", "Your City"],
  requesterZip: ["Requester ZIP", "requesterZip", "Your ZIP Code"],

  // Third-party
  isThirdParty: ["Is Third Party", "isThirdParty", "Are you reporting on behalf of someone else?"],
  thirdPartyRelationship: ["Third Party Relationship", "thirdPartyRelationship", "Your relationship to the situation"],
  propertyOwnerName: ["Property Owner Name", "propertyOwnerName"],
  propertyOwnerPhone: ["Property Owner Phone", "propertyOwnerPhone"],
  propertyOwnerEmail: ["Property Owner Email", "propertyOwnerEmail"],

  // Cat location
  catsAddress: ["Cats Address", "Street Address", "catsAddress", "Street Address where cats are located"],
  catsCity: ["Cats City", "catsCity", "City where cats are located", "City"],
  catsZip: ["Cats ZIP", "catsZip", "ZIP Code"],
  county: ["County", "county"],

  // Cat details
  catName: ["Cat Name", "catName", "Cat's Name (if known)"],
  catDescription: ["Cat Description", "catDescription", "Cat Description (color, markings, etc.)"],
  catCount: ["Cat Count", "catCount", "How many cats?"],
  peakCount: ["Peak Count", "peakCount", "Most cats seen at once (in last week)?"],
  eartipCount: ["Eartip Count", "eartipCount", "How many already have ear tips?"],
  handleability: ["Handleability", "handleability", "Can the cat(s) be handled?"],
  fixedStatus: ["Fixed Status", "fixedStatus", "Are any of the cats already fixed?"],
  feedingSituation: ["Feeding Situation", "feedingSituation", "Feeding situation"],

  // Kittens
  hasKittens: ["Has Kittens", "hasKittens", "Are there kittens present?"],
  kittenCount: ["Kitten Count", "kittenCount", "How many kittens?"],
  kittenAge: ["Kitten Age", "kittenAge", "Estimated kitten age"],
  kittenSocialization: ["Kitten Socialization", "kittenSocialization", "Kitten behavior"],
  momPresent: ["Mom Present", "momPresent", "Is the mother cat present?"],

  // Medical
  hasMedicalConcerns: ["Has Medical Concerns", "hasMedicalConcerns", "Does the cat appear injured or sick?"],
  medicalDescription: ["Medical Description", "medicalDescription", "Describe the medical concerns"],
  isEmergency: ["Is Emergency", "isEmergency", "Is this an emergency situation?"],
  emergencyAcknowledged: ["Emergency Acknowledged", "emergencyAcknowledged"],

  // Property
  isPropertyOwner: ["Is Property Owner", "isPropertyOwner", "Are you the property owner?"],
  hasPropertyAccess: ["Has Property Access", "hasPropertyAccess", "Do you have access to the property where the cats are?"],

  // Notes
  notes: ["Notes", "notes", "Additional notes or details"],
  referralSource: ["Referral Source", "referralSource", "How did you hear about FFSC?"],

  // Jotform tracking
  jotformSubmissionId: ["Jotform Submission ID", "jotformSubmissionId", "Submission ID"],
  submittedAt: ["Submitted At", "submittedAt", "Submission Date"],
};

// Helper to get field value by trying multiple possible column names
function getField(fields, key) {
  const possibleNames = FIELD_MAP[key] || [key];
  for (const name of possibleNames) {
    if (fields[name] !== undefined && fields[name] !== null && fields[name] !== "") {
      return fields[name];
    }
  }
  return undefined;
}

async function fetchPendingRecords() {
  const url = `${AIRTABLE_API}?filterByFormula={Sync Status}='pending'&maxRecords=50`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
  });

  if (!response.ok) {
    throw new Error(`Airtable fetch failed: ${response.status}`);
  }

  const data = await response.json();
  return data.records || [];
}

async function syncToAtlas(record) {
  const fields = record.fields;

  // Extract name - Jotform may send as "yourName - First" / "yourName - Last" or separate fields
  let firstName = getField(fields, "firstName");
  let lastName = getField(fields, "lastName");

  // If names not found, try the combined "Your Name" field
  if (!firstName && fields["Your Name"]) {
    const parts = fields["Your Name"].split(" ");
    firstName = parts[0];
    lastName = parts.slice(1).join(" ");
  }

  // Map Airtable fields to Atlas intake API format
  const jotformId = getField(fields, "jotformSubmissionId");
  const payload = {
    source: "web",
    source_system: "jotform_airtable",  // Jotform submissions via Airtable
    source_raw_id: jotformId || undefined,  // Jotform Submission ID for deduplication

    // Contact
    first_name: firstName || "",
    last_name: lastName || "",
    email: getField(fields, "email") || undefined,
    phone: getField(fields, "phone") || undefined,

    // Requester's own address - parse from various formats
    requester_address: parseAddress(getField(fields, "requesterAddress")) || undefined,
    requester_city: getField(fields, "requesterCity") || undefined,
    requester_zip: getField(fields, "requesterZip") || undefined,

    // Third-party
    is_third_party_report: isYes(getField(fields, "isThirdParty")),
    third_party_relationship: getField(fields, "thirdPartyRelationship") || undefined,
    property_owner_name: getField(fields, "propertyOwnerName") || undefined,
    property_owner_phone: getField(fields, "propertyOwnerPhone") || undefined,
    property_owner_email: getField(fields, "propertyOwnerEmail") || undefined,

    // Location - parse address from various formats
    cats_address: parseAddress(getField(fields, "catsAddress")) || "",
    cats_city: getField(fields, "catsCity") || undefined,
    cats_zip: getField(fields, "catsZip") || undefined,
    county: getField(fields, "county") || undefined,

    // Derive ownership_status from Call Type
    ownership_status: mapCallTypeToOwnership(getField(fields, "callType")),
    cat_count_estimate: parseNumber(getField(fields, "catCount")),
    cat_count_text: getField(fields, "catCount") || undefined,
    peak_count: parseNumber(getField(fields, "peakCount")),
    eartip_count_observed: parseNumber(getField(fields, "eartipCount")),
    fixed_status: mapFixedStatus(getField(fields, "fixedStatus")),
    handleability: mapHandleability(getField(fields, "handleability")),

    // Feeding
    feeding_situation: getField(fields, "feedingSituation") || undefined,

    // Kittens
    has_kittens: isYes(getField(fields, "hasKittens")),
    kitten_count: parseNumber(getField(fields, "kittenCount")),
    kitten_age_estimate: getField(fields, "kittenAge") || undefined,
    kitten_behavior: getField(fields, "kittenSocialization") || undefined,
    mom_present: getField(fields, "momPresent") || undefined,

    // Medical
    has_medical_concerns: isYes(getField(fields, "hasMedicalConcerns")),
    medical_description: getField(fields, "medicalDescription") || undefined,
    is_emergency: isYes(getField(fields, "isEmergency")),
    emergency_acknowledged: isYes(getField(fields, "emergencyAcknowledged")),

    // Property
    is_property_owner: isYes(getField(fields, "isPropertyOwner")),
    has_property_access: isYes(getField(fields, "hasPropertyAccess")) || getField(fields, "hasPropertyAccess") === "Need permission first",

    // Notes
    situation_description: buildSituationDescription(fields),
    referral_source: getField(fields, "referralSource") || undefined,
  };

  const response = await fetch(`${ATLAS_API_URL}/api/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Atlas sync failed");
  }

  return result;
}

function isYes(value) {
  if (!value) return false;
  const v = String(value).toLowerCase();
  return v === "yes" || v === "true" || v.startsWith("yes");
}

function parseNumber(value) {
  if (!value) return undefined;
  const num = parseInt(String(value).replace(/[^\d]/g, ""), 10);
  return isNaN(num) ? undefined : num;
}

function mapCallTypeToOwnership(callType) {
  if (!callType) return "unknown_stray";
  const ct = String(callType).toLowerCase();
  if (ct.includes("pet") || ct.includes("my cat")) return "my_cat";
  if (ct.includes("colony") || ct.includes("tnr")) return "community_colony";
  return "unknown_stray";
}

function mapFixedStatus(status) {
  if (!status) return "unknown";
  const s = String(status).toLowerCase();
  if (s.includes("none")) return "none_fixed";
  if (s.includes("some")) return "some_fixed";
  if (s.includes("most")) return "most_fixed";
  if (s.includes("all")) return "all_fixed";
  return "unknown";
}

function mapHandleability(handle) {
  if (!handle) return undefined;
  const h = String(handle).toLowerCase();
  if (h.includes("friendly") && h.includes("carrier")) return "friendly_carrier";
  if (h.includes("shy")) return "shy_handleable";
  if (h.includes("feral") || h.includes("trap")) return "feral_trap";
  if (h.includes("some") && h.includes("friendly")) return "some_friendly";
  if (h.includes("all") && h.includes("feral")) return "all_feral";
  return "unknown";
}

/**
 * Parse address from various formats including Google Maps widget multiline output
 *
 * Handles formats like:
 * - "123 Main St, Santa Rosa, CA 95401" (normal)
 * - "Street name: Main St\nHouse number: 123\nCity: Santa Rosa\nState: CA\nPostal code: 95401" (widget)
 */
function parseAddress(rawAddress) {
  if (!rawAddress) return null;

  // Check if it's the multiline Google Maps widget format
  if (rawAddress.includes("Street name:") || rawAddress.includes("House number:")) {
    const parts = {};
    const lines = rawAddress.split(/[\n\r]+/);

    for (const line of lines) {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        const key = match[1].trim().toLowerCase();
        const value = match[2].trim();
        if (key.includes("street")) parts.street = value;
        else if (key.includes("house") || key.includes("number")) parts.number = value;
        else if (key.includes("city")) parts.city = value;
        else if (key.includes("state")) parts.state = value;
        else if (key.includes("postal") || key.includes("zip")) parts.zip = value;
      }
    }

    // Build formatted address
    const streetPart = parts.number && parts.street
      ? `${parts.number} ${parts.street}`
      : (parts.street || parts.number || '');

    const addressParts = [streetPart, parts.city, parts.state, parts.zip].filter(Boolean);

    if (parts.city && parts.state) {
      return `${streetPart}, ${parts.city}, ${parts.state} ${parts.zip || ''}`.trim();
    }
    return addressParts.join(', ');
  }

  // Already a normal address string
  return rawAddress.trim();
}

function buildSituationDescription(fields) {
  const parts = [];

  const callType = getField(fields, "callType");
  if (callType) parts.push(`Call type: ${callType}`);

  const catName = getField(fields, "catName");
  if (catName) parts.push(`Cat name: ${catName}`);

  const catDesc = getField(fields, "catDescription");
  if (catDesc) parts.push(`Description: ${catDesc}`);

  const feeding = getField(fields, "feedingSituation");
  if (feeding) parts.push(`Feeding: ${feeding}`);

  const notes = getField(fields, "notes");
  if (notes) parts.push(notes);

  return parts.join("\n");
}

async function updateAirtableStatus(recordId, status, atlasId = null, error = null) {
  const fields = {
    "Sync Status": status,
    "Synced At": status === "synced" ? new Date().toISOString() : null,
  };

  if (atlasId) {
    fields["Atlas Submission ID"] = atlasId;
  }
  if (error) {
    fields["Sync Error"] = error.substring(0, 255);
  }

  await fetch(`${AIRTABLE_API}/${recordId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
}

async function main() {
  console.log("=== Airtable Public Intake Sync ===");
  console.log(`Time: ${new Date().toISOString()}`);

  try {
    const records = await fetchPendingRecords();
    console.log(`Found ${records.length} pending records`);

    let synced = 0;
    let failed = 0;

    for (const record of records) {
      const firstName = getField(record.fields, "firstName") || "";
      const lastName = getField(record.fields, "lastName") || "";
      const name = `${firstName} ${lastName}`.trim() || "(no name)";
      console.log(`\nSyncing: ${name} (${record.id})`);

      try {
        // Skip if missing required fields
        if (!firstName && !lastName) {
          // Try combined name field
          if (!record.fields["Your Name"]) {
            console.log("  Skipped: Missing name");
            await updateAirtableStatus(record.id, "skipped", null, "Missing first/last name");
            continue;
          }
        }

        const email = getField(record.fields, "email");
        const phone = getField(record.fields, "phone");
        if (!email && !phone) {
          console.log("  Skipped: Missing contact info");
          await updateAirtableStatus(record.id, "skipped", null, "Missing email and phone");
          continue;
        }

        const address = getField(record.fields, "catsAddress");
        if (!address) {
          console.log("  Skipped: Missing address");
          await updateAirtableStatus(record.id, "skipped", null, "Missing street address");
          continue;
        }

        const result = await syncToAtlas(record);
        console.log(`  Synced! Atlas ID: ${result.submission_id}`);
        await updateAirtableStatus(record.id, "synced", result.submission_id);
        synced++;
      } catch (err) {
        console.error(`  Error: ${err.message}`);
        await updateAirtableStatus(record.id, "error", null, err.message);
        failed++;
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Synced: ${synced}`);
    console.log(`Failed: ${failed}`);
    console.log(`Skipped: ${records.length - synced - failed}`);

    return { synced, failed, total: records.length };
  } catch (err) {
    console.error("Sync failed:", err);
    process.exit(1);
  }
}

// Run if called directly
main();
