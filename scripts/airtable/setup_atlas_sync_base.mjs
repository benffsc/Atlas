#!/usr/bin/env node
/**
 * Setup Atlas Sync Airtable Base
 *
 * This script creates the standardized intake table structure in the Atlas Sync base.
 * Run once to set up the schema, then use for Jotform → Airtable → Atlas pipeline.
 *
 * Usage:
 *   AIRTABLE_PAT=patXXX node scripts/airtable/setup_atlas_sync_base.mjs
 *
 * Base ID: appwFuRddph1krmcd (Atlas Sync)
 */

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const ATLAS_SYNC_BASE_ID = 'appwFuRddph1krmcd';

// Table schema for Standardized Intake
const INTAKE_TABLE_SCHEMA = {
  name: 'Standardized Intake',
  description: 'Intake submissions from Jotform and other sources for Atlas sync',
  fields: [
    // === CONTACT INFORMATION ===
    { name: 'First Name', type: 'singleLineText' },
    { name: 'Last Name', type: 'singleLineText' },
    { name: 'Email', type: 'email' },
    { name: 'Phone', type: 'phoneNumber' },
    { name: 'Requester Address', type: 'singleLineText' },
    { name: 'Requester City', type: 'singleLineText' },
    { name: 'Requester ZIP', type: 'singleLineText' },

    // === THIRD-PARTY REPORT ===
    { name: 'Is Third Party Report', type: 'checkbox' },
    {
      name: 'Third Party Relationship',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'volunteer' },
          { name: 'neighbor' },
          { name: 'family_member' },
          { name: 'concerned_citizen' },
          { name: 'rescue_worker' },
          { name: 'other' }
        ]
      }
    },
    { name: 'Property Owner Name', type: 'singleLineText' },
    { name: 'Property Owner Phone', type: 'phoneNumber' },
    { name: 'Property Owner Email', type: 'email' },

    // === LOCATION ===
    { name: 'Cats Address', type: 'singleLineText' },
    { name: 'Cats City', type: 'singleLineText' },
    { name: 'Cats ZIP', type: 'singleLineText' },
    {
      name: 'County',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'Sonoma' },
          { name: 'Marin' },
          { name: 'Napa' },
          { name: 'Mendocino' },
          { name: 'Lake' },
          { name: 'other' }
        ]
      }
    },
    { name: 'Address Notes', type: 'multilineText', description: 'For weird addresses that don\'t fit standard format' },

    // === CAT INFORMATION ===
    {
      name: 'Ownership Status',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'unknown_stray' },
          { name: 'community_colony' },
          { name: 'my_cat' },
          { name: 'neighbors_cat' },
          { name: 'unsure' }
        ]
      }
    },
    { name: 'Cat Count Estimate', type: 'number', options: { precision: 0 } },
    { name: 'Cat Count Text', type: 'singleLineText', description: 'Free text if count is uncertain' },
    { name: 'Peak Count', type: 'number', options: { precision: 0 } },
    { name: 'Eartip Count Observed', type: 'number', options: { precision: 0 } },
    {
      name: 'Fixed Status',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'none_fixed' },
          { name: 'some_fixed' },
          { name: 'most_fixed' },
          { name: 'all_fixed' },
          { name: 'unknown' }
        ]
      }
    },
    {
      name: 'Awareness Duration',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'just_started' },
          { name: 'few_weeks' },
          { name: 'few_months' },
          { name: 'over_a_year' }
        ]
      }
    },

    // === KITTEN INFORMATION ===
    { name: 'Has Kittens', type: 'checkbox' },
    { name: 'Kitten Count', type: 'number', options: { precision: 0 } },
    {
      name: 'Kitten Age Estimate',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'newborn' },
          { name: 'eyes_open' },
          { name: 'weaned' },
          { name: 'unknown' }
        ]
      }
    },
    { name: 'Kitten Age Weeks', type: 'number', options: { precision: 0 } },
    { name: 'Kitten Mixed Ages', type: 'checkbox' },
    { name: 'Kitten Mixed Ages Description', type: 'multilineText' },
    {
      name: 'Kitten Behavior',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'friendly' },
          { name: 'shy' },
          { name: 'feral' },
          { name: 'unknown' }
        ]
      }
    },
    {
      name: 'Kitten Contained',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'yes_indoors' },
          { name: 'yes_outdoors' },
          { name: 'no' },
          { name: 'unknown' }
        ]
      }
    },
    { name: 'Mom Present', type: 'singleLineText' },
    { name: 'Mom Fixed', type: 'singleLineText' },
    { name: 'Can Bring In', type: 'singleLineText' },
    { name: 'Kitten Notes', type: 'multilineText' },

    // === FEEDING BEHAVIOR ===
    { name: 'Feeds Cat', type: 'checkbox' },
    {
      name: 'Feeding Frequency',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'daily' },
          { name: 'few_times_week' },
          { name: 'occasionally' },
          { name: 'rarely' }
        ]
      }
    },
    {
      name: 'Feeding Duration',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'just_started' },
          { name: 'few_weeks' },
          { name: 'few_months' },
          { name: 'over_a_year' }
        ]
      }
    },
    {
      name: 'Cat Comes Inside',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'yes_regularly' },
          { name: 'sometimes' },
          { name: 'never' }
        ]
      }
    },

    // === SITUATION ===
    { name: 'Is Emergency', type: 'checkbox' },
    { name: 'Emergency Acknowledged', type: 'checkbox' },
    { name: 'Has Medical Concerns', type: 'checkbox' },
    { name: 'Medical Description', type: 'multilineText' },
    { name: 'Cats Being Fed', type: 'checkbox' },
    { name: 'Feeder Info', type: 'singleLineText' },
    { name: 'Has Property Access', type: 'checkbox' },
    { name: 'Access Notes', type: 'multilineText' },
    { name: 'Is Property Owner', type: 'checkbox' },
    { name: 'Situation Description', type: 'multilineText' },
    {
      name: 'Referral Source',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'website' },
          { name: 'facebook' },
          { name: 'word_of_mouth' },
          { name: 'vet_referral' },
          { name: 'returning_client' },
          { name: 'other' }
        ]
      }
    },

    // === ATTACHMENTS ===
    { name: 'Photos', type: 'multipleAttachments' },

    // === SOURCE METADATA ===
    { name: 'Submitted At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } },
    {
      name: 'Source',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'jotform_website' },
          { name: 'jotform_clinic_survey' },
          { name: 'jotform_trapping' },
          { name: 'manual_entry' },
          { name: 'legacy_import' }
        ]
      }
    },
    { name: 'Jotform Submission ID', type: 'singleLineText' },
    { name: 'Spam Score', type: 'number', options: { precision: 2 } },
    { name: 'IP Address', type: 'singleLineText' },
    { name: 'User Agent', type: 'singleLineText' },

    // === SYNC STATUS ===
    {
      name: 'Sync Status',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'pending', color: 'yellowLight2' },
          { name: 'synced', color: 'greenLight2' },
          { name: 'error', color: 'redLight2' },
          { name: 'review_needed', color: 'orangeLight2' }
        ]
      }
    },
    { name: 'Atlas Submission ID', type: 'singleLineText', description: 'UUID from Atlas after sync' },
    { name: 'Atlas Person ID', type: 'singleLineText', description: 'Matched or created person in Atlas' },
    { name: 'Atlas Place ID', type: 'singleLineText', description: 'Matched or created place in Atlas' },
    { name: 'Last Synced At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } },
    { name: 'Sync Error', type: 'multilineText', description: 'Error message if sync failed' },

    // === VALIDATION ===
    { name: 'Phone Valid', type: 'checkbox' },
    { name: 'Email Valid', type: 'checkbox' },
    { name: 'Address Geocoded', type: 'checkbox' },
    { name: 'Geocode Confidence', type: 'singleLineText' },
    { name: 'Needs Review', type: 'checkbox' },
    { name: 'Review Notes', type: 'multilineText' }
  ]
};

async function airtableFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.airtable.com/v0${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  return res.json();
}

async function createTable(baseId, tableSchema) {
  console.log(`Creating table: ${tableSchema.name}`);

  const result = await airtableFetch(`/meta/bases/${baseId}/tables`, {
    method: 'POST',
    body: JSON.stringify(tableSchema)
  });

  if (result.error) {
    console.error('Error creating table:', result.error);
    return null;
  }

  console.log(`Table created with ID: ${result.id}`);
  return result;
}

async function main() {
  if (!AIRTABLE_PAT) {
    console.error('Error: AIRTABLE_PAT not set');
    console.error('Usage: AIRTABLE_PAT=patXXX node scripts/airtable/setup_atlas_sync_base.mjs');
    process.exit(1);
  }

  console.log('Setting up Atlas Sync base...\n');
  console.log(`Base ID: ${ATLAS_SYNC_BASE_ID}`);

  // Check current tables
  const tables = await airtableFetch(`/meta/bases/${ATLAS_SYNC_BASE_ID}/tables`);
  console.log(`\nExisting tables: ${tables.tables?.map(t => t.name).join(', ') || 'none'}`);

  // Check if Standardized Intake already exists
  const existingTable = tables.tables?.find(t => t.name === 'Standardized Intake');
  if (existingTable) {
    console.log('\nStandardized Intake table already exists!');
    console.log(`Table ID: ${existingTable.id}`);
    console.log(`Fields: ${existingTable.fields?.length}`);
    return;
  }

  // Create the table
  console.log('\nCreating Standardized Intake table...');
  const result = await createTable(ATLAS_SYNC_BASE_ID, INTAKE_TABLE_SCHEMA);

  if (result) {
    console.log('\n✅ Table created successfully!');
    console.log(`Table ID: ${result.id}`);
    console.log(`Fields created: ${result.fields?.length}`);
  } else {
    console.error('\n❌ Failed to create table');
    process.exit(1);
  }
}

main().catch(console.error);
