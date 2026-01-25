#!/usr/bin/env node

/**
 * cleanup_junk_person_records.mjs
 *
 * AI-powered data cleanup job that processes junk person records from ClinicHQ:
 * - Identifies addresses being used as person names → Converts to places
 * - Identifies organizations → Creates org profiles with researched info
 * - Merges duplicate records
 * - Links cats from appointments to the correct places
 *
 * Usage:
 *   node scripts/jobs/cleanup_junk_person_records.mjs --dry-run
 *   node scripts/jobs/cleanup_junk_person_records.mjs --limit 10
 *   node scripts/jobs/cleanup_junk_person_records.mjs --type organization
 *   node scripts/jobs/cleanup_junk_person_records.mjs --type address
 */

import pg from "pg";
import Anthropic from "@anthropic-ai/sdk";

const { Pool } = pg;

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find(a => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1]) : 50;
const typeArg = args.find(a => a.startsWith("--type="));
const typeFilter = typeArg ? typeArg.split("=")[1] : null;
const verbose = args.includes("--verbose") || args.includes("-v");

// Initialize clients
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const anthropic = new Anthropic();

// Known organization patterns for Sonoma County
const KNOWN_ORGS = {
  "scas": {
    canonical_name: "Sonoma County Animal Services",
    short_name: "SCAS",
    type: "government",
    address: "1247 Century Ct, Santa Rosa, CA 95403",
    phone: "707-565-7100",
    website: "https://sonomacounty.ca.gov/animal-services"
  },
  "ffsc": {
    canonical_name: "Forgotten Felines of Sonoma County",
    short_name: "FFSC",
    type: "nonprofit",
    address: "545 Sebastopol Ave, Santa Rosa, CA 95401",
    phone: "707-576-7999",
    website: "https://forgottenfelines.org"
  }
};

/**
 * Strip FFSC/SCAS suffix from name - these suffixes indicate who BROUGHT the cat,
 * not what the entity IS. "Comstock Middle School FFSC" means FFSC brought a cat
 * from Comstock Middle School, not that it IS FFSC.
 */
function stripBroughtBySuffix(name) {
  // Remove trailing FFSC/SCAS (case insensitive)
  const cleaned = name.replace(/\s+(ffsc|scas)$/i, '').trim();
  const hadSuffix = cleaned !== name;
  return { cleaned, hadSuffix, broughtBy: hadSuffix ? (name.match(/\s+(ffsc|scas)$/i)?.[1]?.toUpperCase() || null) : null };
}

/**
 * Check if a name represents an apartment complex (should be a place, not org)
 */
function isApartmentComplex(name) {
  const apartmentPatterns = [
    /\b(apartments?|apt\.?s?|village|terrace|manor|court|gardens?|heights|towers?|plaza|residences?)\b/i,
    /\b(senior|living|housing)\s+(center|community|complex)\b/i
  ];
  return apartmentPatterns.some(p => p.test(name));
}

/**
 * Check if name is EXACTLY one of the known orgs (not just contains their acronym)
 */
function isExactKnownOrg(name) {
  const nameLower = name.toLowerCase().trim();
  // Only match if the name IS the org, not just contains the suffix
  const exactMatches = [
    'scas', 'sonoma county animal services',
    'ffsc', 'forgotten felines', 'forgotten felines of sonoma county'
  ];
  return exactMatches.some(m => nameLower === m || nameLower.startsWith(m + ' '));
}

/**
 * Classify a display name with additional context from raw data
 */
async function classifyNameWithContext(displayName, rawContext, appointmentContext) {
  // Extract useful info from context
  const rawAddresses = rawContext?.filter(r => r?.owner_address)?.map(r => r.owner_address) || [];
  const ownershipTypes = rawContext?.filter(r => r?.ownership)?.map(r => r.ownership) || [];
  const clientTypes = rawContext?.filter(r => r?.client_type)?.map(r => r.client_type) || [];

  // If the display name matches an owner_address exactly, it's definitely an address
  for (const addr of rawAddresses) {
    if (addr && displayName.toLowerCase().includes(addr.toLowerCase().split(',')[0])) {
      return { type: "address", confidence: 0.95, reason: "matches raw owner_address", raw_address: addr };
    }
  }

  // If ownership type is "Community Cat" or similar, likely a location
  const isCommunityCat = ownershipTypes.some(o => o?.toLowerCase().includes('community') || o?.toLowerCase().includes('feral'));
  if (isCommunityCat && displayName.match(/^\d/)) {
    return { type: "address", confidence: 0.9, reason: "community cat with address-like name" };
  }

  // Fall back to pattern-based classification
  return classifyName(displayName);
}

/**
 * Classify a display name as address, apartment_complex, organization, or person
 */
async function classifyName(displayName) {
  // IMPORTANT: Strip FFSC/SCAS suffix first - these indicate who BROUGHT the cat,
  // not what the entity IS. "Comstock Middle School FFSC" is a SCHOOL, not FFSC.
  const { cleaned: nameToClassify, hadSuffix, broughtBy } = stripBroughtBySuffix(displayName);

  // Check if this IS exactly FFSC or SCAS (not just has suffix)
  if (isExactKnownOrg(displayName)) {
    return { type: "organization", confidence: 0.95, reason: "exact known org match" };
  }

  // Quick pattern matching
  const addressPatterns = [
    /^\d+\s+/,  // Starts with number
    /\b(road|lane|ave|avenue|street|st|blvd|boulevard|dr|drive|way|rd|ct|court|cir|circle|pl|place|ln)\b/i,
    /\b(block of)\b/i
  ];

  // Apartment complexes should be PLACES, not organizations
  const apartmentPatterns = [
    /\b(apartments?|apt\.?s?|village|terrace|manor|gardens?|heights|towers?|plaza|residences?)\b/i,
    /\b(senior|living|housing)\s+(center|community|complex)\b/i
  ];

  // Organization patterns (WITHOUT ffsc/scas - those are suffixes, not indicators)
  const orgPatterns = [
    /\b(school|middle school|high school|elementary|academy)\b/i,
    /\b(church|hospital|clinic|shelter)\b/i,
    /\b(corp|inc|llc|company)\b/i,
    /\b(park|rec|recreation)\b/i,
    /\b(ranch|farm)\b/i,
    /\b(center|centre)\b/i,
    /\brescue\b/i,
    /\bforgotten felines\b/i,
    /\banimal services\b/i
  ];

  // Check for address patterns first (highest priority)
  for (const pattern of addressPatterns) {
    if (pattern.test(nameToClassify)) {
      return {
        type: "address",
        confidence: 0.9,
        reason: hadSuffix ? `address pattern (brought by ${broughtBy})` : "matches address pattern",
        broughtBy
      };
    }
  }

  // Check for apartment complexes - these are PLACES, not organizations
  for (const pattern of apartmentPatterns) {
    if (pattern.test(nameToClassify)) {
      return {
        type: "apartment_complex",
        confidence: 0.9,
        reason: hadSuffix ? `apartment complex (brought by ${broughtBy})` : "matches apartment pattern",
        broughtBy
      };
    }
  }

  // Check for organization patterns
  for (const pattern of orgPatterns) {
    if (pattern.test(nameToClassify)) {
      return {
        type: "organization",
        confidence: 0.9,
        reason: hadSuffix ? `org pattern (brought by ${broughtBy})` : "matches org pattern",
        broughtBy
      };
    }
  }

  // Use AI for ambiguous cases
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [{
      role: "user",
      content: `Classify this name that appears in a TNR (trap-neuter-return) cat clinic database as either:
- "address": A street address or location
- "organization": A business, school, government agency, nonprofit, or other organization
- "person": An actual person's name

Name: "${displayName}"

Respond with ONLY a JSON object like: {"type": "address|organization|person", "confidence": 0.0-1.0, "reason": "brief explanation"}

Context: This is from Sonoma County, California. Common orgs include SCAS (Sonoma County Animal Services), FFSC (Forgotten Felines of Sonoma County).`
    }]
  });

  try {
    const text = response.content[0].text.trim();
    // Extract JSON from response
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse AI response:", e.message);
  }

  return { type: "unknown", confidence: 0.5, reason: "could not classify" };
}

/**
 * Research an organization using web search
 */
async function researchOrganization(name, existingInfo = {}) {
  // Strip FFSC/SCAS suffix - we're researching the LOCATION, not the suffix
  const { cleaned: nameToResearch, hadSuffix, broughtBy } = stripBroughtBySuffix(name);

  // ONLY check known orgs if name IS exactly one of them (not just contains suffix)
  if (isExactKnownOrg(name)) {
    const nameLower = name.toLowerCase();
    for (const [key, info] of Object.entries(KNOWN_ORGS)) {
      if (nameLower === key || nameLower.startsWith(info.canonical_name.toLowerCase()) ||
          nameLower === info.short_name.toLowerCase()) {
      return { ...info, source: "known_database" };
    }
  }

  // Use AI to research with web search capability
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `Research this organization/location in Sonoma County, California:

Name: "${name}"

Provide information in this JSON format:
{
  "canonical_name": "Full official name",
  "short_name": "Abbreviation if any",
  "type": "business|nonprofit|government|school|park|apartment_complex|other",
  "address": "Full street address if known",
  "city": "City name",
  "phone": "Phone number if known",
  "website": "Website if known",
  "description": "Brief description of what this organization does",
  "confidence": 0.0-1.0,
  "needs_verification": true/false
}

If you're not sure about specific details, set needs_verification to true.
If this appears to just be an address (not an organization), return: {"type": "address_only", "address": "the address"}
Respond with ONLY the JSON object.`
    }]
  });

  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return { ...JSON.parse(jsonMatch[0]), source: "ai_research" };
    }
  } catch (e) {
    console.error("Failed to parse org research:", e.message);
  }

  return {
    canonical_name: name,
    type: "unknown",
    needs_verification: true,
    source: "failed_research"
  };
}

/**
 * Parse an address string into components
 */
async function parseAddress(addressStr) {
  // Clean up the address
  let cleaned = addressStr
    .replace(/\s+ffsc\s*$/i, "")
    .replace(/\s+scas\s*$/i, "")
    .replace(/\s+forgotten felines.*$/i, "")
    .trim();

  // Add CA if no state specified
  if (!cleaned.match(/,?\s*(ca|california)\s*\d{0,5}$/i)) {
    cleaned += ", CA";
  }

  // Use AI to normalize the address
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [{
      role: "user",
      content: `Parse this Sonoma County address into components:

Address: "${cleaned}"

Return JSON only:
{
  "formatted_address": "Full formatted address with city, state, zip",
  "street": "Street address",
  "city": "City name (default to Santa Rosa if unclear)",
  "state": "CA",
  "zip": "ZIP code if known, null otherwise",
  "confidence": 0.0-1.0
}`
    }]
  });

  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse address:", e.message);
  }

  return {
    formatted_address: cleaned,
    city: "Santa Rosa",
    state: "CA",
    confidence: 0.5
  };
}

/**
 * Get raw ClinicHQ data for context
 */
async function getRawContextForPerson(personId) {
  // Get appointments linked to this person
  const appts = await pool.query(`
    SELECT
      a.appointment_id,
      a.appointment_number,
      a.appointment_date,
      a.owner_email,
      a.owner_phone,
      a.service_type,
      a.medical_notes,
      c.display_name as cat_name,
      ci.id_value as microchip
    FROM trapper.sot_appointments a
    LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
    LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
    WHERE a.trapper_person_id = $1 OR a.person_id = $1
    ORDER BY a.appointment_date DESC
    LIMIT 10
  `, [personId]);

  // Get raw staged records if available
  const staged = await pool.query(`
    SELECT
      payload,
      source_table,
      created_at
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
    AND (
      payload->>'Owner First Name' || ' ' || payload->>'Owner Last Name' ILIKE $1
      OR payload->>'Owner Address' ILIKE $1
    )
    ORDER BY created_at DESC
    LIMIT 5
  `, [`%${personId}%`]);

  return {
    appointments: appts.rows,
    staged_records: staged.rows
  };
}

/**
 * Get all junk person records to process with context
 */
async function getJunkRecords(limit, typeFilter) {
  let typeCondition = "";
  if (typeFilter === "address") {
    typeCondition = `AND (display_name ~ '^\\d' OR display_name ~* '(road|lane|ave|street|st|blvd|dr|way|rd|ct|cir|pl)(\\s|$)')`;
  } else if (typeFilter === "organization") {
    typeCondition = `AND display_name ~* '(ffsc|scas|school|church|hospital|clinic|shelter|services|county|city|corp|inc|llc|park|rec|villa|ranch|farm)'`;
  }

  const query = `
    SELECT
      display_name,
      array_agg(person_id ORDER BY p.created_at) as person_ids,
      COUNT(*) as count,
      -- Get context from appointments
      (
        SELECT json_agg(json_build_object(
          'appointment_number', a.appointment_number,
          'date', a.appointment_date,
          'cat_name', c.display_name,
          'owner_email', a.owner_email,
          'owner_phone', a.owner_phone,
          'address', pl.formatted_address
        ) ORDER BY a.appointment_date DESC)
        FROM trapper.sot_appointments a
        LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
        LEFT JOIN trapper.places pl ON pl.place_id = a.place_id
        WHERE a.trapper_person_id = ANY(array_agg(p.person_id))
           OR a.person_id = ANY(array_agg(p.person_id))
        LIMIT 5
      ) as appointment_context,
      -- Check if any raw records have more info
      (
        SELECT json_agg(DISTINCT jsonb_build_object(
          'owner_address', payload->>'Owner Address',
          'owner_email', payload->>'Owner Email',
          'owner_phone', COALESCE(payload->>'Owner Phone', payload->>'Owner Cell Phone'),
          'client_type', payload->>'ClientType',
          'ownership', payload->>'Ownership'
        ))
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'clinichq'
        AND (
          TRIM(COALESCE(sr.payload->>'Owner First Name', '') || ' ' || COALESCE(sr.payload->>'Owner Last Name', '')) = p.display_name
          OR sr.payload->>'Owner Address' ILIKE '%' || p.display_name || '%'
        )
        LIMIT 5
      ) as raw_context
    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NULL
    AND p.data_source = 'clinichq'
    AND p.primary_email IS NULL
    AND p.primary_phone IS NULL
    ${typeCondition}
    GROUP BY display_name
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT $1
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

/**
 * Create or find a place for an address
 */
async function findOrCreatePlace(addressInfo) {
  // First check if place exists
  const existing = await pool.query(`
    SELECT place_id, formatted_address
    FROM trapper.places
    WHERE normalized_address = trapper.normalize_address($1)
    AND merged_into_place_id IS NULL
    LIMIT 1
  `, [addressInfo.formatted_address]);

  if (existing.rows.length > 0) {
    return { place_id: existing.rows[0].place_id, created: false };
  }

  // Create new place
  const result = await pool.query(`
    SELECT trapper.find_or_create_place_deduped(
      $1, NULL, NULL, NULL, 'clinichq'
    ) as place_id
  `, [addressInfo.formatted_address]);

  return { place_id: result.rows[0].place_id, created: true };
}

/**
 * Create or update an organization profile
 */
async function createOrganization(orgInfo, personIds) {
  // Check if org already exists in known_organizations (actual table structure)
  const existing = await pool.query(`
    SELECT org_id, linked_place_id
    FROM trapper.known_organizations
    WHERE org_name ILIKE $1
       OR org_name_pattern ILIKE $2
    LIMIT 1
  `, [orgInfo.canonical_name, `%${orgInfo.short_name || orgInfo.canonical_name}%`]);

  if (existing.rows.length > 0) {
    return { org_id: existing.rows[0].org_id, created: false };
  }

  // Create place first if we have an address
  let linkedPlaceId = null;
  if (orgInfo.address) {
    const placeResult = await findOrCreatePlace({ formatted_address: orgInfo.address });
    linkedPlaceId = placeResult.place_id;
  }

  // Create the known_organization entry (using actual table structure)
  const orgResult = await pool.query(`
    INSERT INTO trapper.known_organizations (
      org_name,
      org_name_pattern,
      org_type,
      linked_place_id,
      notes
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING org_id
  `, [
    orgInfo.canonical_name,
    orgInfo.short_name ? `%${orgInfo.short_name}%` : null,
    orgInfo.type || 'other',
    linkedPlaceId,
    JSON.stringify({
      phone: orgInfo.phone,
      website: orgInfo.website,
      description: orgInfo.description,
      source: orgInfo.source,
      needs_verification: orgInfo.needs_verification
    })
  ]);

  return { org_id: orgResult.rows[0].org_id, linked_place_id: linkedPlaceId, created: true };
}

/**
 * Merge duplicate person records into a canonical one
 */
async function mergeDuplicates(personIds, canonicalId) {
  for (const personId of personIds) {
    if (personId === canonicalId) continue;

    // Update the person to be merged
    await pool.query(`
      UPDATE trapper.sot_people
      SET merged_into_person_id = $1,
          merged_at = NOW(),
          merge_reason = 'clinichq_junk_cleanup'
      WHERE person_id = $2
    `, [canonicalId, personId]);

    // Re-link any appointments
    await pool.query(`
      UPDATE trapper.sot_appointments
      SET trapper_person_id = $1
      WHERE trapper_person_id = $2
    `, [canonicalId, personId]);
  }

  return personIds.length - 1; // Number merged
}

/**
 * Process a single junk record
 */
async function processRecord(record, dryRun) {
  const { display_name, person_ids, count, appointment_context, raw_context } = record;

  console.log(`\nProcessing: "${display_name}" (${count} duplicates)`);

  // Show raw context if available
  if (verbose && raw_context?.length > 0) {
    console.log("  Raw Context:");
    for (const ctx of raw_context.slice(0, 2)) {
      if (ctx.owner_address) console.log(`    Address: ${ctx.owner_address}`);
      if (ctx.owner_email) console.log(`    Email: ${ctx.owner_email}`);
      if (ctx.ownership) console.log(`    Ownership: ${ctx.ownership}`);
    }
  }

  // Show appointment context
  if (verbose && appointment_context?.length > 0) {
    console.log(`  Appointments: ${appointment_context.length} linked`);
    const firstAppt = appointment_context[0];
    if (firstAppt?.cat_name) console.log(`    Cat: ${firstAppt.cat_name}`);
    if (firstAppt?.address) console.log(`    Appt Address: ${firstAppt.address}`);
  }

  // Classify the name with additional context
  const classification = await classifyNameWithContext(display_name, raw_context, appointment_context);
  console.log(`  Classification: ${classification.type} (${(classification.confidence * 100).toFixed(0)}% - ${classification.reason})`);

  if (dryRun) {
    console.log("  [DRY RUN] Would process this record");
    return { type: classification.type, processed: false, dry_run: true };
  }

  const result = {
    display_name,
    classification,
    actions: []
  };

  if (classification.type === "address") {
    // Get the best available address - prefer raw context or appointment data over display_name
    let bestAddress = display_name;

    // Check if classification has raw_address from context matching
    if (classification.raw_address) {
      bestAddress = classification.raw_address;
    }
    // Check raw context for full addresses
    else if (raw_context?.length > 0) {
      const rawAddr = raw_context.find(r => r?.owner_address)?.owner_address;
      if (rawAddr) bestAddress = rawAddr;
    }
    // Check appointment context for address
    else if (appointment_context?.length > 0) {
      const apptAddr = appointment_context.find(a => a?.address)?.address;
      if (apptAddr) bestAddress = apptAddr;
    }

    // Parse and create place
    const addressInfo = await parseAddress(bestAddress);
    console.log(`  Address: ${addressInfo.formatted_address}`);

    const placeResult = await findOrCreatePlace(addressInfo);
    console.log(`  Place: ${placeResult.place_id} (${placeResult.created ? 'created' : 'existing'})`);

    result.place_id = placeResult.place_id;
    result.actions.push(placeResult.created ? 'place_created' : 'place_found');

    // Merge duplicates into a single "location" person record
    // Keep one person record to maintain appointment links
    const keepPersonId = person_ids[0];
    const mergeCount = await mergeDuplicates(person_ids, keepPersonId);
    console.log(`  Merged ${mergeCount} duplicate records`);
    result.actions.push(`merged_${mergeCount}_duplicates`);

    // Mark as clinic_location account (pseudo-profile for future cat linking)
    await pool.query(`
      UPDATE trapper.sot_people
      SET account_type = 'clinic_location',
          account_type_reason = 'AI cleanup: address used as clinic owner name',
          data_quality = 'cleaned'
      WHERE person_id = $1
    `, [keepPersonId]);

    // Link person to place via person_place_relationships
    await pool.query(`
      INSERT INTO trapper.person_place_relationships (person_id, place_id, role, source_system, note, confidence)
      VALUES ($1, $2, 'contact', 'clinichq', 'Clinic appointment location account', 0.9)
      ON CONFLICT (person_id, place_id, role) DO NOTHING
    `, [keepPersonId, placeResult.place_id]);

    result.actions.push('marked_as_clinic_location');
    result.actions.push('linked_to_place');

  } else if (classification.type === "organization") {
    // Research and create organization
    const orgInfo = await researchOrganization(display_name);
    console.log(`  Org: ${orgInfo.canonical_name} (${orgInfo.type})`);
    if (orgInfo.address) console.log(`  Address: ${orgInfo.address}`);

    const orgResult = await createOrganization(orgInfo, person_ids);
    console.log(`  Org ID: ${orgResult.org_id} (${orgResult.created ? 'created' : 'existing'})`);

    result.org_id = orgResult.org_id;
    result.actions.push(orgResult.created ? 'org_created' : 'org_found');

    // Keep one person record as representative, mark as organization account
    const keepPersonId = person_ids[0];

    // Mark as organization account (pseudo-profile for clinic records)
    await pool.query(`
      UPDATE trapper.sot_people
      SET account_type = 'organization',
          account_type_reason = 'AI cleanup: organization name used in clinic records',
          display_name = $2,
          data_quality = 'cleaned'
      WHERE person_id = $1
    `, [keepPersonId, orgInfo.canonical_name]);

    // Link to place if we have one via person_place_relationships
    if (orgResult.linked_place_id) {
      await pool.query(`
        INSERT INTO trapper.person_place_relationships (person_id, place_id, role, source_system, note, confidence)
        VALUES ($1, $2, 'contact', 'clinichq', 'Organization location from clinic records', 0.9)
        ON CONFLICT (person_id, place_id, role) DO NOTHING
      `, [keepPersonId, orgResult.linked_place_id]);
    }

    // Merge duplicates
    const mergeCount = await mergeDuplicates(person_ids, keepPersonId);
    console.log(`  Merged ${mergeCount} duplicate records`);
    result.actions.push(`merged_${mergeCount}_duplicates`);

  } else {
    console.log("  Skipping - could not determine type");
    result.actions.push('skipped_unknown_type');
  }

  return result;
}

/**
 * Main execution
 */
async function main() {
  console.log("=".repeat(60));
  console.log("ClinicHQ Junk Person Record Cleanup");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Limit: ${limit}`);
  if (typeFilter) console.log(`Type filter: ${typeFilter}`);
  console.log("");

  try {
    // Get records to process
    const records = await getJunkRecords(limit, typeFilter);
    console.log(`Found ${records.length} unique junk names to process`);

    const results = {
      processed: 0,
      addresses: 0,
      organizations: 0,
      skipped: 0,
      errors: []
    };

    for (const record of records) {
      try {
        const result = await processRecord(record, dryRun);
        results.processed++;

        if (result.classification?.type === "address") results.addresses++;
        else if (result.classification?.type === "organization") results.organizations++;
        else results.skipped++;

      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        results.errors.push({ name: record.display_name, error: err.message });
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("Summary");
    console.log("=".repeat(60));
    console.log(`Processed: ${results.processed}`);
    console.log(`Addresses: ${results.addresses}`);
    console.log(`Organizations: ${results.organizations}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      console.log("\nErrors:");
      for (const e of results.errors) {
        console.log(`  - ${e.name}: ${e.error}`);
      }
    }

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
