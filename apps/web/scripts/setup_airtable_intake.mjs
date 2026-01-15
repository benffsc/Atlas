#!/usr/bin/env node
/**
 * Setup Airtable Intake Submissions Table
 *
 * This script creates the table structure in Airtable for receiving
 * Jotform public submissions. Data flows: Jotform → Airtable → Atlas
 *
 * Key fields are optimized for Beacon colony analytics:
 * - Call type routing
 * - Handleability assessment
 * - Colony size indicators
 * - Medical/emergency flags
 */

import Airtable from "airtable";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env from project root
dotenv.config({ path: join(__dirname, "../../../.env") });

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
  console.error("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID in .env");
  process.exit(1);
}

Airtable.configure({ apiKey: AIRTABLE_PAT });
const base = Airtable.base(AIRTABLE_BASE_ID);

/**
 * Table Schema for Public Intake Submissions
 *
 * This matches the Jotform fields and Atlas intake API expectations.
 */
const TABLE_SCHEMA = {
  name: "Public Intake Submissions",
  description: "Submissions from Jotform public intake form - synced to Atlas",
  fields: [
    // === SYNC STATUS ===
    { name: "Sync Status", type: "singleSelect", options: { choices: [
      { name: "pending", color: "yellowBright" },
      { name: "synced", color: "greenBright" },
      { name: "error", color: "redBright" },
      { name: "skipped", color: "grayBright" },
    ]}},
    { name: "Sync Error", type: "singleLineText" },
    { name: "Atlas Submission ID", type: "singleLineText" },
    { name: "Synced At", type: "dateTime" },

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
    { name: "Is Third Party Report", type: "checkbox" },
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
    { name: "Cat Description", type: "singleLineText" },
    { name: "Cat Count", type: "number", options: { precision: 0 }},
    { name: "Cat Count Text", type: "singleLineText" },  // For "5-10" or "too many"

    // === COLONY DATA (Critical for Beacon) ===
    { name: "Peak Count", type: "number", options: { precision: 0 }},
    { name: "Eartip Count", type: "number", options: { precision: 0 }},
    { name: "Feeding Situation", type: "singleSelect", options: { choices: [
      { name: "caller_feeds_daily" },
      { name: "caller_feeds_sometimes" },
      { name: "someone_else_feeds" },
      { name: "no_feeding" },
      { name: "unknown" },
    ]}},

    // === HANDLEABILITY (Critical for Beacon) ===
    { name: "Handleability", type: "singleSelect", options: { choices: [
      { name: "friendly_carrier", color: "greenBright" },
      { name: "shy_handleable", color: "yellowBright" },
      { name: "feral_trap", color: "orangeBright" },
      { name: "unknown", color: "grayBright" },
      { name: "some_friendly", color: "tealBright" },  // Colony
      { name: "all_feral", color: "redBright" },  // Colony
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
    { name: "Has Kittens", type: "checkbox" },
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
    { name: "Has Medical Concerns", type: "checkbox" },
    { name: "Medical Description", type: "multilineText" },
    { name: "Is Emergency", type: "checkbox" },

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
    { name: "Submitted At", type: "dateTime" },
  ],
};

async function setupTable() {
  console.log("Setting up Airtable table for public intake submissions...");
  console.log(`Base ID: ${AIRTABLE_BASE_ID}`);

  // Note: Airtable REST API doesn't support creating tables programmatically
  // We'll document the schema for manual creation or use Airtable UI

  console.log("\n=== TABLE SCHEMA ===\n");
  console.log(`Table Name: ${TABLE_SCHEMA.name}`);
  console.log(`Description: ${TABLE_SCHEMA.description}`);
  console.log("\nFields:");

  for (const field of TABLE_SCHEMA.fields) {
    console.log(`\n  ${field.name}`);
    console.log(`    Type: ${field.type}`);
    if (field.options?.choices) {
      console.log(`    Options: ${field.options.choices.map(c => c.name).join(", ")}`);
    }
  }

  console.log("\n=== SETUP INSTRUCTIONS ===\n");
  console.log("1. Go to Airtable and open your base");
  console.log("2. Create a new table named 'Public Intake Submissions'");
  console.log("3. Add the fields listed above with their types");
  console.log("4. In Jotform, set up a webhook to push to this table");
  console.log("5. The Atlas sync job will pull from this table");

  console.log("\n=== JOTFORM INTEGRATION ===\n");
  console.log("Use Jotform's native Airtable integration:");
  console.log("1. In your Jotform, go to Settings → Integrations → Airtable");
  console.log("2. Connect to your Airtable account");
  console.log("3. Select this base and 'Public Intake Submissions' table");
  console.log("4. Map Jotform fields to Airtable columns");
  console.log("5. Set 'Sync Status' default to 'pending'");

  // Try to create a test record to verify connection
  try {
    console.log("\n=== TESTING CONNECTION ===\n");
    const tables = await base.tables();
    console.log("Connected to base. Available tables:");
    for (const table of tables) {
      console.log(`  - ${table.name}`);
    }
  } catch (err) {
    console.log("Could not list tables (this is normal for new/empty bases)");
    console.log("Error:", err.message);
  }
}

setupTable().catch(console.error);
