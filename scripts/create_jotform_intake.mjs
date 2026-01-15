#!/usr/bin/env node
/**
 * Create FFSC Intake Form in Jotform
 *
 * This creates a public-facing intake form that matches our Atlas intake flow.
 * Data flows: Jotform → Airtable → Atlas
 */

// Get API key from command line arg or environment
const JOTFORM_API_KEY = process.argv[2] || process.env.JOTFORM_API_KEY;

if (!JOTFORM_API_KEY) {
  console.error("Usage: node create_jotform_intake.mjs <api_key>");
  console.error("Or set JOTFORM_API_KEY environment variable");
  process.exit(1);
}

const API_BASE = "https://api.jotform.com";

async function jotformRequest(endpoint, method = "GET", data = null) {
  const url = `${API_BASE}${endpoint}?apiKey=${JOTFORM_API_KEY}`;

  const options = {
    method,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  };

  if (data && method !== "GET") {
    options.body = new URLSearchParams(data).toString();
  }

  const response = await fetch(url, options);
  const result = await response.json();

  if (result.responseCode !== 200) {
    throw new Error(`Jotform API error: ${result.message}`);
  }

  return result.content;
}

async function createForm() {
  console.log("Creating FFSC Intake Form...\n");

  // Create the form with questions
  const formData = {
    // Form properties
    "properties[title]": "FFSC Cat Help Request",
    "properties[height]": "600",
    "properties[activeRedirect]": "thanktext",
    "properties[thanktext]": "Thank you for contacting Forgotten Felines! We will review your request and get back to you soon.",
    "properties[injectCSS]": "",

    // === PAGE 1: Call Type ===
    "questions[1][type]": "control_head",
    "questions[1][text]": "How Can We Help?",
    "questions[1][order]": "1",

    "questions[2][type]": "control_radio",
    "questions[2][text]": "What best describes your situation?",
    "questions[2][name]": "callType",
    "questions[2][order]": "2",
    "questions[2][required]": "Yes",
    "questions[2][options]": "Pet Spay/Neuter - My cat needs to be fixed|Wellness Check - Already fixed cat needs medical care|Single Stray - One unfamiliar cat showed up|Colony/TNR - Multiple outdoor cats need help|Kitten Situation - Found kittens|Medical Concern - Cat appears injured or sick",
    "questions[2][special]": "None",

    // === PAGE 2: Contact Info ===
    "questions[10][type]": "control_pagebreak",
    "questions[10][text]": "Contact Information",
    "questions[10][order]": "10",

    "questions[11][type]": "control_head",
    "questions[11][text]": "Your Contact Information",
    "questions[11][order]": "11",

    "questions[12][type]": "control_fullname",
    "questions[12][text]": "Your Name",
    "questions[12][name]": "yourName",
    "questions[12][order]": "12",
    "questions[12][required]": "Yes",

    "questions[13][type]": "control_email",
    "questions[13][text]": "Email Address",
    "questions[13][name]": "email",
    "questions[13][order]": "13",
    "questions[13][required]": "Yes",
    "questions[13][validation]": "Email",

    "questions[14][type]": "control_phone",
    "questions[14][text]": "Phone Number",
    "questions[14][name]": "phone",
    "questions[14][order]": "14",
    "questions[14][required]": "No",

    "questions[15][type]": "control_radio",
    "questions[15][text]": "Are you reporting on behalf of someone else?",
    "questions[15][name]": "isThirdParty",
    "questions[15][order]": "15",
    "questions[15][required]": "Yes",
    "questions[15][options]": "No, this is my own situation|Yes, I'm reporting for someone else",

    "questions[16][type]": "control_dropdown",
    "questions[16][text]": "Your relationship to the situation",
    "questions[16][name]": "thirdPartyRelationship",
    "questions[16][order]": "16",
    "questions[16][required]": "No",
    "questions[16][options]": "Neighbor|Family Member|Concerned Citizen|FFSC Volunteer|Other",

    "questions[17][type]": "control_textbox",
    "questions[17][text]": "Property Owner Name (if known)",
    "questions[17][name]": "propertyOwnerName",
    "questions[17][order]": "17",
    "questions[17][required]": "No",

    "questions[18][type]": "control_phone",
    "questions[18][text]": "Property Owner Phone (if known)",
    "questions[18][name]": "propertyOwnerPhone",
    "questions[18][order]": "18",
    "questions[18][required]": "No",

    // === PAGE 3: Cat Location ===
    "questions[20][type]": "control_pagebreak",
    "questions[20][text]": "Cat Location",
    "questions[20][order]": "20",

    "questions[21][type]": "control_head",
    "questions[21][text]": "Where are the cats?",
    "questions[21][order]": "21",

    "questions[22][type]": "control_address",
    "questions[22][text]": "Street Address where cats are located",
    "questions[22][name]": "catsAddress",
    "questions[22][order]": "22",
    "questions[22][required]": "Yes",

    "questions[23][type]": "control_dropdown",
    "questions[23][text]": "County",
    "questions[23][name]": "county",
    "questions[23][order]": "23",
    "questions[23][required]": "Yes",
    "questions[23][options]": "Sonoma|Marin|Napa|Mendocino|Lake|Other",

    // === PAGE 4: Cat Details ===
    "questions[30][type]": "control_pagebreak",
    "questions[30][text]": "Cat Details",
    "questions[30][order]": "30",

    "questions[31][type]": "control_head",
    "questions[31][text]": "Tell us about the cat(s)",
    "questions[31][order]": "31",

    // For owned pets
    "questions[32][type]": "control_textbox",
    "questions[32][text]": "Cat's Name (if known)",
    "questions[32][name]": "catName",
    "questions[32][order]": "32",
    "questions[32][required]": "No",

    "questions[33][type]": "control_textarea",
    "questions[33][text]": "Cat Description (color, markings, etc.)",
    "questions[33][name]": "catDescription",
    "questions[33][order]": "33",
    "questions[33][required]": "No",

    // Cat count
    "questions[34][type]": "control_textbox",
    "questions[34][text]": "How many cats?",
    "questions[34][name]": "catCount",
    "questions[34][order]": "34",
    "questions[34][required]": "No",
    "questions[34][hint]": "Enter a number or range like '5-10'",

    // Colony-specific: Peak count (Beacon critical)
    "questions[35][type]": "control_number",
    "questions[35][text]": "Most cats seen at once (in last week)?",
    "questions[35][name]": "peakCount",
    "questions[35][order]": "35",
    "questions[35][required]": "No",
    "questions[35][hint]": "This helps us estimate colony size - count the maximum you've seen at one time recently",

    // Colony-specific: Eartip count (Beacon critical)
    "questions[36][type]": "control_number",
    "questions[36][text]": "How many already have ear tips?",
    "questions[36][name]": "eartipCount",
    "questions[36][order]": "36",
    "questions[36][required]": "No",
    "questions[36][hint]": "Ear-tipped cats have been fixed. Count how many have a flat tip on one ear.",

    // Handleability (Beacon critical)
    "questions[37][type]": "control_radio",
    "questions[37][text]": "Can the cat(s) be handled?",
    "questions[37][name]": "handleability",
    "questions[37][order]": "37",
    "questions[37][required]": "No",
    "questions[37][options]": "Friendly - can use a carrier|Shy but handleable|Feral - will need a trap|Some are friendly, some feral|All are feral (need traps)|Unknown / Haven't tried",

    // Fixed status
    "questions[38][type]": "control_radio",
    "questions[38][text]": "Are any of the cats already fixed?",
    "questions[38][name]": "fixedStatus",
    "questions[38][order]": "38",
    "questions[38][required]": "No",
    "questions[38][options]": "None are fixed|Some are fixed|Most are fixed|All are fixed|Unknown",

    // Feeding situation
    "questions[39][type]": "control_dropdown",
    "questions[39][text]": "Feeding situation",
    "questions[39][name]": "feedingSituation",
    "questions[39][order]": "39",
    "questions[39][required]": "No",
    "questions[39][options]": "I feed them daily|I feed them sometimes|Someone else feeds them|No regular feeding|Unknown",

    // === PAGE 5: Kittens ===
    "questions[40][type]": "control_pagebreak",
    "questions[40][text]": "Kitten Information",
    "questions[40][order]": "40",

    "questions[41][type]": "control_head",
    "questions[41][text]": "About the Kittens",
    "questions[41][order]": "41",

    "questions[42][type]": "control_radio",
    "questions[42][text]": "Are there kittens present?",
    "questions[42][name]": "hasKittens",
    "questions[42][order]": "42",
    "questions[42][required]": "No",
    "questions[42][options]": "Yes|No|Unsure",

    "questions[43][type]": "control_number",
    "questions[43][text]": "How many kittens?",
    "questions[43][name]": "kittenCount",
    "questions[43][order]": "43",
    "questions[43][required]": "No",

    "questions[44][type]": "control_dropdown",
    "questions[44][text]": "Estimated kitten age",
    "questions[44][name]": "kittenAge",
    "questions[44][order]": "44",
    "questions[44][required]": "No",
    "questions[44][options]": "Under 4 weeks (eyes closed or just opened)|4-8 weeks (weaning)|8-12 weeks|Over 12 weeks|Unknown",

    "questions[45][type]": "control_dropdown",
    "questions[45][text]": "Kitten behavior",
    "questions[45][name]": "kittenSocialization",
    "questions[45][order]": "45",
    "questions[45][required]": "No",
    "questions[45][options]": "Friendly / Easy to handle|Shy but handleable|Feral / Difficult to handle|Unknown",

    "questions[46][type]": "control_radio",
    "questions[46][text]": "Is the mother cat present?",
    "questions[46][name]": "momPresent",
    "questions[46][order]": "46",
    "questions[46][required]": "No",
    "questions[46][options]": "Yes|No|Unsure",

    // === PAGE 6: Medical & Emergency ===
    "questions[50][type]": "control_pagebreak",
    "questions[50][text]": "Medical Information",
    "questions[50][order]": "50",

    "questions[51][type]": "control_head",
    "questions[51][text]": "Medical Concerns",
    "questions[51][order]": "51",

    "questions[52][type]": "control_radio",
    "questions[52][text]": "Does the cat appear injured or sick?",
    "questions[52][name]": "hasMedicalConcerns",
    "questions[52][order]": "52",
    "questions[52][required]": "No",
    "questions[52][options]": "Yes|No",

    "questions[53][type]": "control_textarea",
    "questions[53][text]": "Describe the medical concerns",
    "questions[53][name]": "medicalDescription",
    "questions[53][order]": "53",
    "questions[53][required]": "No",

    "questions[54][type]": "control_radio",
    "questions[54][text]": "Is this an emergency situation?",
    "questions[54][name]": "isEmergency",
    "questions[54][order]": "54",
    "questions[54][required]": "No",
    "questions[54][options]": "Yes - Urgent|No - Can wait for normal processing",
    "questions[54][description]": "Note: FFSC is a spay/neuter clinic, not a 24-hour emergency hospital. For life-threatening emergencies, please contact Pet Care Veterinary Hospital at (707) 579-3900.",

    // === PAGE 7: Property Access ===
    "questions[60][type]": "control_pagebreak",
    "questions[60][text]": "Property Access",
    "questions[60][order]": "60",

    "questions[61][type]": "control_head",
    "questions[61][text]": "Property Access",
    "questions[61][order]": "61",

    "questions[62][type]": "control_radio",
    "questions[62][text]": "Are you the property owner?",
    "questions[62][name]": "isPropertyOwner",
    "questions[62][order]": "62",
    "questions[62][required]": "No",
    "questions[62][options]": "Yes|No|Unsure",

    "questions[63][type]": "control_radio",
    "questions[63][text]": "Do you have access to the property where the cats are?",
    "questions[63][name]": "hasPropertyAccess",
    "questions[63][order]": "63",
    "questions[63][required]": "No",
    "questions[63][options]": "Yes|No|Need permission first",

    // === PAGE 8: Additional Info ===
    "questions[70][type]": "control_pagebreak",
    "questions[70][text]": "Additional Information",
    "questions[70][order]": "70",

    "questions[71][type]": "control_head",
    "questions[71][text]": "Almost Done!",
    "questions[71][order]": "71",

    "questions[72][type]": "control_textarea",
    "questions[72][text]": "Additional notes or details",
    "questions[72][name]": "notes",
    "questions[72][order]": "72",
    "questions[72][required]": "No",
    "questions[72][hint]": "Anything else we should know about the situation?",

    "questions[73][type]": "control_dropdown",
    "questions[73][text]": "How did you hear about FFSC?",
    "questions[73][name]": "referralSource",
    "questions[73][order]": "73",
    "questions[73][required]": "No",
    "questions[73][options]": "Internet Search|Social Media|Friend/Family|Local Shelter|Veterinarian|Repeat Visitor|Other",

    // Submit button
    "questions[99][type]": "control_button",
    "questions[99][text]": "Submit Request",
    "questions[99][order]": "99",
    "questions[99][buttonAlign]": "auto",
  };

  try {
    const form = await jotformRequest("/user/forms", "POST", formData);
    console.log("Form created successfully!");
    console.log(`Form ID: ${form.id}`);
    console.log(`Form URL: https://form.jotform.com/${form.id}`);
    console.log(`Edit URL: https://www.jotform.com/build/${form.id}`);

    return form;
  } catch (err) {
    console.error("Failed to create form:", err.message);
    throw err;
  }
}

async function main() {
  console.log("=== FFSC Jotform Intake Form Creator ===\n");

  try {
    const form = await createForm();

    console.log("\n=== Next Steps ===");
    console.log("1. Open the form in Jotform to review and customize styling");
    console.log("2. Set up conditional logic for call-type branching");
    console.log("3. Connect to Airtable integration:");
    console.log("   - Base ID: appwFuRddph1krmcd");
    console.log("   - Table: Public Intake Submissions");
    console.log("4. Map fields to Airtable columns");
    console.log("5. Set 'Sync Status' default to 'pending'");

    return form;
  } catch (err) {
    console.error("\nFailed:", err.message);
    process.exit(1);
  }
}

main();
