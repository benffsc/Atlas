#!/usr/bin/env node
/**
 * Sync Intake Schema to Airtable
 *
 * This script reads the intake-schema.ts and syncs new fields to Airtable.
 * Run this after adding new questions to the intake form.
 *
 * Usage:
 *   node scripts/sync_airtable_schema.mjs
 *   node scripts/sync_airtable_schema.mjs --dry-run  (preview changes)
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env from project root
dotenv.config({ path: join(__dirname, "../../../.env") });

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_ATLAS_SYNC_BASE_ID || "appwFuRddph1krmcd";
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_PUBLIC_INTAKE_TABLE_ID || "tblGQDVELZBhnxvUm";

if (!AIRTABLE_PAT) {
  console.error("Missing AIRTABLE_PAT in .env");
  process.exit(1);
}

const isDryRun = process.argv.includes("--dry-run");

/**
 * Get current fields from Airtable table
 */
async function getCurrentFields() {
  const url = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch table metadata: ${response.status}`);
  }

  const data = await response.json();
  const table = data.tables.find(t => t.id === AIRTABLE_TABLE_ID);

  if (!table) {
    throw new Error(`Table ${AIRTABLE_TABLE_ID} not found in base ${AIRTABLE_BASE_ID}`);
  }

  return table.fields.map(f => f.name);
}

/**
 * Add a new field to the Airtable table
 */
async function addField(fieldSpec) {
  const url = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables/${AIRTABLE_TABLE_ID}/fields`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fieldSpec),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create field ${fieldSpec.name}: ${response.status} - ${text}`);
  }

  return await response.json();
}

/**
 * Define the fields that should exist in Airtable
 * Add new questions here when adding to the intake form
 */
const DESIRED_FIELDS = [
  // === SYNC STATUS ===
  { name: "Sync Status", type: "singleSelect", options: { choices: [
    { name: "pending", color: "yellowBright" },
    { name: "synced", color: "greenBright" },
    { name: "error", color: "redBright" },
    { name: "skipped", color: "grayBright" },
  ]}},
  { name: "Sync Error", type: "singleLineText" },
  { name: "Atlas Submission ID", type: "singleLineText" },
  { name: "Synced At", type: "dateTime", options: { timeFormat: { name: "12hour" } } },

  // === CALL TYPE ROUTING ===
  { name: "Call Type", type: "singleSelect", options: { choices: [
    { name: "pet_spay_neuter", color: "blueBright" },
    { name: "wellness_check", color: "purpleBright" },
    { name: "single_stray", color: "tealBright" },
    { name: "colony_tnr", color: "orangeBright" },
    { name: "kitten_rescue", color: "pinkBright" },
    { name: "medical_concern", color: "redBright" },
  ]}},

  // === CONTACT INFO ===
  { name: "First Name", type: "singleLineText" },
  { name: "Last Name", type: "singleLineText" },
  { name: "Email", type: "email" },
  { name: "Phone", type: "phoneNumber" },

  // === THIRD PARTY ===
  { name: "Is Third Party Report", type: "checkbox", options: { color: "yellowBright", icon: "check" } },
  { name: "Third Party Relationship", type: "singleSelect", options: { choices: [
    { name: "neighbor" },
    { name: "family_member" },
    { name: "concerned_citizen" },
    { name: "volunteer" },
    { name: "other" },
  ]}},
  { name: "Property Owner Name", type: "singleLineText" },
  { name: "Property Owner Phone", type: "phoneNumber" },

  // === LOCATION ===
  { name: "Street Address", type: "singleLineText" },
  { name: "City", type: "singleLineText" },
  { name: "ZIP", type: "singleLineText" },
  { name: "County", type: "singleSelect", options: { choices: [
    { name: "Sonoma", color: "greenBright" },
    { name: "Marin", color: "blueBright" },
    { name: "Napa", color: "purpleBright" },
    { name: "Mendocino", color: "tealBright" },
    { name: "Lake", color: "orangeBright" },
    { name: "other", color: "grayBright" },
  ]}},

  // === CAT DETAILS ===
  { name: "Cat Name", type: "singleLineText" },
  { name: "Cat Description", type: "multilineText" },
  { name: "Cat Count", type: "number", options: { precision: 0 }},
  { name: "Cat Count Text", type: "singleLineText" },

  // === COLONY DATA (Beacon Critical) ===
  { name: "Peak Count", type: "number", options: { precision: 0 }},
  { name: "Eartip Count", type: "number", options: { precision: 0 }},
  { name: "Feeding Situation", type: "singleSelect", options: { choices: [
    { name: "caller_feeds_daily" },
    { name: "caller_feeds_sometimes" },
    { name: "someone_else_feeds" },
    { name: "no_feeding" },
    { name: "unknown" },
  ]}},

  // === HANDLEABILITY (Beacon Critical) ===
  { name: "Handleability", type: "singleSelect", options: { choices: [
    { name: "friendly_carrier", color: "greenBright" },
    { name: "shy_handleable", color: "yellowBright" },
    { name: "feral_trap", color: "orangeBright" },
    { name: "unknown", color: "grayBright" },
    { name: "some_friendly", color: "tealBright" },
    { name: "all_feral", color: "redBright" },
  ]}},

  // === FIXED STATUS ===
  { name: "Fixed Status", type: "singleSelect", options: { choices: [
    { name: "none_fixed" },
    { name: "some_fixed" },
    { name: "most_fixed" },
    { name: "all_fixed" },
    { name: "unknown" },
  ]}},

  // === KITTENS ===
  { name: "Has Kittens", type: "checkbox", options: { color: "yellowBright", icon: "check" } },
  { name: "Kitten Count", type: "number", options: { precision: 0 }},
  { name: "Kitten Age", type: "singleSelect", options: { choices: [
    { name: "under_4_weeks" },
    { name: "4_to_8_weeks" },
    { name: "8_to_12_weeks" },
    { name: "over_12_weeks" },
    { name: "unknown" },
  ]}},
  { name: "Kitten Socialization", type: "singleSelect", options: { choices: [
    { name: "friendly" },
    { name: "shy_handleable" },
    { name: "feral" },
    { name: "unknown" },
  ]}},
  { name: "Mom Present", type: "singleSelect", options: { choices: [
    { name: "yes" },
    { name: "no" },
    { name: "unsure" },
  ]}},

  // === MEDICAL ===
  { name: "Has Medical Concerns", type: "checkbox", options: { color: "redBright", icon: "check" } },
  { name: "Medical Description", type: "multilineText" },
  { name: "Is Emergency", type: "checkbox", options: { color: "redBright", icon: "check" } },

  // === PROPERTY ACCESS ===
  { name: "Is Property Owner", type: "singleSelect", options: { choices: [
    { name: "yes" },
    { name: "no" },
    { name: "unsure" },
  ]}},
  { name: "Has Property Access", type: "singleSelect", options: { choices: [
    { name: "yes" },
    { name: "no" },
    { name: "need_permission" },
  ]}},

  // === NOTES ===
  { name: "Notes", type: "multilineText" },
  { name: "Referral Source", type: "singleSelect", options: { choices: [
    { name: "search" },
    { name: "social" },
    { name: "friend" },
    { name: "shelter" },
    { name: "vet" },
    { name: "repeat" },
    { name: "other" },
  ]}},

  // === JOTFORM METADATA ===
  { name: "Jotform Submission ID", type: "singleLineText" },
  { name: "Submitted At", type: "dateTime", options: { timeFormat: { name: "12hour" } } },

  // =============================================
  // ADD NEW CUSTOM FIELDS BELOW THIS LINE
  // =============================================
  // Example:
  // { name: "Custom Question", type: "singleLineText" },
  // { name: "Custom Select", type: "singleSelect", options: { choices: [
  //   { name: "option1" },
  //   { name: "option2" },
  // ]}},
];

async function main() {
  console.log("=== Airtable Schema Sync ===");
  console.log(`Base ID: ${AIRTABLE_BASE_ID}`);
  console.log(`Table ID: ${AIRTABLE_TABLE_ID}`);
  if (isDryRun) {
    console.log("DRY RUN - no changes will be made\n");
  }
  console.log("");

  try {
    // Get current fields from Airtable
    console.log("Fetching current table fields...");
    const existingFields = await getCurrentFields();
    console.log(`Found ${existingFields.length} existing fields\n`);

    // Find missing fields
    const desiredFieldNames = DESIRED_FIELDS.map(f => f.name);
    const missingFields = DESIRED_FIELDS.filter(f => !existingFields.includes(f.name));

    if (missingFields.length === 0) {
      console.log("All fields are in sync! Nothing to add.\n");

      // Show fields that exist in Airtable but not in our schema (info only)
      const extraFields = existingFields.filter(f => !desiredFieldNames.includes(f));
      if (extraFields.length > 0) {
        console.log("Note: The following fields exist in Airtable but are not in the schema:");
        extraFields.forEach(f => console.log(`  - ${f}`));
        console.log("(These won't be removed - add them to the schema if you want to track them)\n");
      }
      return;
    }

    console.log(`Found ${missingFields.length} fields to add:`);
    missingFields.forEach(f => console.log(`  + ${f.name} (${f.type})`));
    console.log("");

    if (isDryRun) {
      console.log("Dry run complete. Run without --dry-run to apply changes.");
      return;
    }

    // Add missing fields
    console.log("Adding fields to Airtable...\n");
    let added = 0;
    let failed = 0;

    for (const field of missingFields) {
      try {
        await addField(field);
        console.log(`  ✓ Added: ${field.name}`);
        added++;
      } catch (err) {
        console.error(`  ✗ Failed: ${field.name} - ${err.message}`);
        failed++;
      }
    }

    console.log("\n=== Summary ===");
    console.log(`Added: ${added}`);
    console.log(`Failed: ${failed}`);

    if (added > 0) {
      console.log("\nNext steps:");
      console.log("1. Update Jotform to include the new fields");
      console.log("2. Map the Jotform fields to the new Airtable columns");
      console.log("3. Update the Atlas sync script if needed");
    }

  } catch (err) {
    console.error("Sync failed:", err.message);
    process.exit(1);
  }
}

main();
