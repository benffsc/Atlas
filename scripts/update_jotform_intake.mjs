#!/usr/bin/env node
/**
 * Update FFSC Intake Form in Jotform
 *
 * Adds missing fields to the existing form:
 * - Requester's own address
 * - Property owner email
 * - Emergency acknowledgment
 * - Separate city/zip for cat location
 */

const FORM_ID = "260143732665153";
const JOTFORM_API_KEY = process.argv[2] || process.env.JOTFORM_API_KEY;

if (!JOTFORM_API_KEY) {
  console.error("Usage: node update_jotform_intake.mjs <api_key>");
  console.error("Or set JOTFORM_API_KEY environment variable");
  process.exit(1);
}

const API_BASE = "https://api.jotform.com";

async function addQuestion(questionData) {
  const url = `${API_BASE}/form/${FORM_ID}/questions?apiKey=${JOTFORM_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(questionData).toString(),
  });

  const result = await response.json();

  if (result.responseCode !== 200) {
    throw new Error(`Jotform API error: ${result.message}`);
  }

  return result.content;
}

async function addMissingFields() {
  console.log(`Updating form ${FORM_ID}...\n`);

  const fieldsToAdd = [
    // Requester's address header
    {
      "question[type]": "control_text",
      "question[text]": "<strong>Your Address</strong> (if different from cat location)",
      "question[order]": "19",
      "question[name]": "requesterAddressHeader",
    },
    // Requester street
    {
      "question[type]": "control_textbox",
      "question[text]": "Your Street Address",
      "question[name]": "requesterAddress",
      "question[order]": "191",
      "question[required]": "No",
    },
    // Requester city
    {
      "question[type]": "control_textbox",
      "question[text]": "Your City",
      "question[name]": "requesterCity",
      "question[order]": "192",
      "question[required]": "No",
    },
    // Requester zip
    {
      "question[type]": "control_textbox",
      "question[text]": "Your ZIP Code",
      "question[name]": "requesterZip",
      "question[order]": "193",
      "question[required]": "No",
    },
    // Property owner email
    {
      "question[type]": "control_email",
      "question[text]": "Property Owner Email (if known)",
      "question[name]": "propertyOwnerEmail",
      "question[order]": "181",
      "question[required]": "No",
    },
    // Cat location city
    {
      "question[type]": "control_textbox",
      "question[text]": "City where cats are located",
      "question[name]": "catsCity",
      "question[order]": "221",
      "question[required]": "No",
    },
    // Cat location zip
    {
      "question[type]": "control_textbox",
      "question[text]": "ZIP Code",
      "question[name]": "catsZip",
      "question[order]": "222",
      "question[required]": "No",
    },
    // Emergency acknowledgment
    {
      "question[type]": "control_checkbox",
      "question[text]": "Emergency Acknowledgment (required if urgent)",
      "question[name]": "emergencyAcknowledged",
      "question[order]": "55",
      "question[required]": "No",
      "question[options]": "I understand FFSC is a spay/neuter clinic NOT a 24-hour emergency hospital. For life-threatening emergencies I will contact Pet Care Veterinary Hospital at (707) 579-3900.",
    },
    // Same as my address checkbox
    {
      "question[type]": "control_checkbox",
      "question[text]": "Cat location same as my address?",
      "question[name]": "sameAsRequester",
      "question[order]": "201",
      "question[required]": "No",
      "question[options]": "Yes - the cats are at my address",
    },
  ];

  for (const field of fieldsToAdd) {
    try {
      await addQuestion(field);
      console.log(`✓ Added: ${field["question[name]"]}`);
    } catch (err) {
      console.error(`✗ Failed to add ${field["question[name]"]}: ${err.message}`);
    }
  }
}

async function main() {
  console.log("=== FFSC Jotform Intake Form Updater ===\n");

  try {
    await addMissingFields();

    console.log(`\n=== Done ===`);
    console.log(`Form URL: https://form.jotform.com/${FORM_ID}`);
    console.log(`Edit URL: https://www.jotform.com/build/${FORM_ID}`);

    console.log("\n=== Next Steps ===");
    console.log("1. Open form builder to arrange field positions");
    console.log("2. Set up conditional logic (see instructions below)");
    console.log("3. Connect to Airtable integration");

  } catch (err) {
    console.error("\nFailed:", err.message);
    process.exit(1);
  }
}

main();
