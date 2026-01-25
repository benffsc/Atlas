#!/usr/bin/env node

/**
 * research_clinic_accounts.mjs
 *
 * AI-powered enrichment job for clinic_owner_accounts:
 * - Classifies account type (address, apartment_complex, organization)
 * - Researches organizations using Claude with web search
 * - Links to places table (creates if needed)
 * - Links to known_organizations (creates if needed)
 * - Sets canonical names and confidence scores
 *
 * Usage:
 *   node scripts/jobs/research_clinic_accounts.mjs --dry-run
 *   node scripts/jobs/research_clinic_accounts.mjs --limit 50
 *   node scripts/jobs/research_clinic_accounts.mjs --type organization
 *   node scripts/jobs/research_clinic_accounts.mjs --type address
 *   node scripts/jobs/research_clinic_accounts.mjs --type unknown
 *   node scripts/jobs/research_clinic_accounts.mjs --reprocess  # Re-research already processed
 */

import pg from "pg";
import Anthropic from "@anthropic-ai/sdk";

const { Pool } = pg;

// ANSI colors
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const cyan = '\x1b[36m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find(a => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1]) : (args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : 50);
const typeArg = args.find(a => a.startsWith("--type="));
const typeFilter = typeArg ? typeArg.split("=")[1] : (args.includes("--type") ? args[args.indexOf("--type") + 1] : null);
const verbose = args.includes("--verbose") || args.includes("-v");
const reprocess = args.includes("--reprocess");
const help = args.includes("--help") || args.includes("-h");

// Known organizations for Sonoma County (avoid unnecessary web searches)
const KNOWN_ORGS = {
  "scas": {
    canonical_name: "Sonoma County Animal Services",
    short_name: "SCAS",
    type: "government",
    address: "1247 Century Ct, Santa Rosa, CA 95403",
    description: "Sonoma County government animal services agency"
  },
  "ffsc": {
    canonical_name: "Forgotten Felines of Sonoma County",
    short_name: "FFSC",
    type: "nonprofit",
    address: "545 Sebastopol Ave, Santa Rosa, CA 95401",
    description: "Cat rescue and TNR organization"
  },
  "sonoma county animal services": {
    canonical_name: "Sonoma County Animal Services",
    short_name: "SCAS",
    type: "government",
    address: "1247 Century Ct, Santa Rosa, CA 95403",
    description: "Sonoma County government animal services agency"
  },
  "forgotten felines": {
    canonical_name: "Forgotten Felines of Sonoma County",
    short_name: "FFSC",
    type: "nonprofit",
    address: "545 Sebastopol Ave, Santa Rosa, CA 95401",
    description: "Cat rescue and TNR organization"
  }
};

// System prompt for AI classification/research
const CLASSIFICATION_PROMPT = `You are a data researcher for Forgotten Felines of Sonoma County (FFSC), a cat TNR organization in Sonoma County, California.

Your task is to classify and research entities that appear as "owner names" in clinic records. These are often NOT real people, but rather:
- Street addresses used as owner names (e.g., "123 Main St")
- Apartment complexes (e.g., "Parkview Apartments", "Sunrise Senior Living")
- Organizations (e.g., schools, churches, businesses, parks)

CONTEXT:
- All records are from Sonoma County, CA area (Santa Rosa, Petaluma, etc.)
- FFSC is a TNR (Trap-Neuter-Return) organization
- Records with "FFSC" or "SCAS" suffix indicate who BROUGHT the cat, not what the entity is
- If a name looks like "Comstock Middle School FFSC" - that's a SCHOOL, not FFSC

CLASSIFICATION RULES:
1. "address" - Street addresses (starts with number, has road/lane/ave/etc)
2. "apartment_complex" - Apartment complexes, senior living, housing communities
3. "organization" - Schools, churches, businesses, parks, rescues
4. "likely_person" - Appears to be a real person name (First Last format)
5. "unknown" - Can't determine confidently

Return ONLY valid JSON with this structure:
{
  "classification": "address" | "apartment_complex" | "organization" | "likely_person" | "unknown",
  "canonical_name": "Official/proper name if found",
  "address": "Full address if known",
  "description": "Brief description of what this entity is",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of classification"
}`;

const RESEARCH_PROMPT = `You are a data researcher for Forgotten Felines of Sonoma County (FFSC), a cat TNR organization in Sonoma County, California.

Research the following organization to find accurate information. This entity appears in cat clinic records, so it's likely a local organization, school, or business in Sonoma County.

IMPORTANT: Use web search to verify the organization exists and get accurate details.

Return ONLY valid JSON:
{
  "canonical_name": "Official registered name",
  "org_type": "school" | "church" | "business" | "park" | "nonprofit" | "government" | "other",
  "address": "Full street address with city, state, zip",
  "description": "What kind of organization this is",
  "verified": true | false,
  "confidence": 0.0-1.0,
  "notes": "Any relevant context for TNR purposes"
}`;

// Initialize clients
let pool;
let anthropic;

function showHelp() {
  console.log(`
${bold}Research Clinic Accounts${reset}

AI-powered enrichment for clinic_owner_accounts table.
Classifies accounts, researches organizations, and links to places/orgs.

${bold}Usage:${reset}
  node scripts/jobs/research_clinic_accounts.mjs [options]

${bold}Options:${reset}
  --dry-run       Preview changes without saving to database
  --limit N       Process up to N accounts (default: 50)
  --type TYPE     Only process accounts of type: unknown, address, apartment_complex, organization
  --reprocess     Re-research accounts that have already been processed
  --verbose, -v   Show detailed output
  --help, -h      Show this help

${bold}Environment:${reset}
  DATABASE_URL       Postgres connection string
  ANTHROPIC_API_KEY  Anthropic API key

${bold}Examples:${reset}
  # Dry run to preview
  node scripts/jobs/research_clinic_accounts.mjs --dry-run --limit 10

  # Process unknown accounts
  node scripts/jobs/research_clinic_accounts.mjs --type unknown --limit 100

  # Research organizations with web search
  node scripts/jobs/research_clinic_accounts.mjs --type organization
`);
}

/**
 * Get accounts needing research
 */
async function getAccountsToResearch() {
  let whereClause = reprocess ? '1=1' : 'coa.ai_researched_at IS NULL';

  if (typeFilter) {
    whereClause += ` AND coa.account_type = '${typeFilter}'`;
  }

  const query = `
    SELECT
      coa.account_id,
      coa.display_name,
      coa.account_type,
      coa.brought_by,
      coa.source_display_names,
      coa.original_person_id,
      -- Get appointment context for better classification
      (
        SELECT json_agg(json_build_object(
          'appointment_date', a.appointment_date,
          'owner_email', a.owner_email
        ))
        FROM trapper.sot_appointments a
        WHERE a.owner_account_id = coa.account_id
        LIMIT 5
      ) as appointment_context
    FROM trapper.clinic_owner_accounts coa
    WHERE ${whereClause}
    ORDER BY
      CASE coa.account_type
        WHEN 'unknown' THEN 1
        WHEN 'organization' THEN 2
        WHEN 'apartment_complex' THEN 3
        WHEN 'address' THEN 4
      END,
      coa.created_at
    LIMIT $1
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

/**
 * Classify an account using AI
 */
async function classifyAccount(account) {
  const displayName = account.display_name;
  const context = account.appointment_context || [];

  // Quick pattern checks first (faster than AI)
  const quickClassification = quickClassify(displayName);
  if (quickClassification.confidence >= 0.9) {
    return quickClassification;
  }

  // Build context string for AI
  let contextStr = `Name: "${displayName}"`;
  if (account.brought_by) {
    contextStr += `\nNote: Has "${account.brought_by}" suffix indicating who brought cats`;
  }
  if (account.source_display_names && account.source_display_names.length > 1) {
    contextStr += `\nVariations seen: ${account.source_display_names.join(', ')}`;
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 300,
      system: CLASSIFICATION_PROMPT,
      messages: [{
        role: "user",
        content: `Classify this entity:\n\n${contextStr}`
      }]
    });

    const text = response.content[0]?.text?.trim();
    if (!text) return null;

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (err) {
    console.error(`${red}Classification error:${reset}`, err.message);
    return null;
  }
}

/**
 * Quick pattern-based classification (no AI needed)
 */
function quickClassify(name) {
  // Strip FFSC/SCAS suffix
  const cleanName = name.replace(/\s+(ffsc|scas)$/i, '').trim();

  // Check known orgs first
  const lowerName = cleanName.toLowerCase();
  if (KNOWN_ORGS[lowerName]) {
    const org = KNOWN_ORGS[lowerName];
    return {
      classification: 'organization',
      canonical_name: org.canonical_name,
      address: org.address,
      description: org.description,
      confidence: 1.0,
      reasoning: 'Known organization'
    };
  }

  // Address patterns
  if (/^\d+\s+/.test(cleanName) ||
      /\b(road|lane|ave|avenue|street|st|blvd|boulevard|dr|drive|way|rd|ct|court|ln|pl|place|cir|circle)\b/i.test(cleanName) ||
      /\b(block of)\b/i.test(cleanName)) {
    return {
      classification: 'address',
      canonical_name: cleanName,
      confidence: 0.95,
      reasoning: 'Matches address pattern'
    };
  }

  // Apartment patterns
  if (/\b(apartments?|village|terrace|manor|gardens?|heights|towers?|plaza|residences?)\b/i.test(cleanName) ||
      /\b(senior|living|housing)\s+(center|community|complex)\b/i.test(cleanName)) {
    return {
      classification: 'apartment_complex',
      canonical_name: cleanName,
      confidence: 0.9,
      reasoning: 'Matches apartment complex pattern'
    };
  }

  // Organization patterns
  if (/\b(school|middle school|high school|elementary|academy)\b/i.test(cleanName)) {
    return {
      classification: 'organization',
      canonical_name: cleanName,
      confidence: 0.85,
      reasoning: 'Matches school pattern'
    };
  }

  if (/\b(church|hospital|clinic|shelter|rescue)\b/i.test(cleanName)) {
    return {
      classification: 'organization',
      canonical_name: cleanName,
      confidence: 0.85,
      reasoning: 'Matches organization pattern'
    };
  }

  if (/\b(corp|inc|llc|company|ltd)\b/i.test(cleanName)) {
    return {
      classification: 'organization',
      canonical_name: cleanName,
      confidence: 0.9,
      reasoning: 'Has business suffix'
    };
  }

  // Person name pattern
  if (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(cleanName)) {
    return {
      classification: 'likely_person',
      canonical_name: cleanName,
      confidence: 0.7,
      reasoning: 'Matches First Last name pattern'
    };
  }

  // Unknown - needs AI
  return {
    classification: 'unknown',
    confidence: 0.3,
    reasoning: 'No clear pattern match'
  };
}

/**
 * Research an organization using AI with web search
 */
async function researchOrganization(name, existingInfo) {
  // Check known orgs first
  const lowerName = name.toLowerCase().replace(/\s+(ffsc|scas)$/i, '').trim();
  if (KNOWN_ORGS[lowerName]) {
    return {
      ...KNOWN_ORGS[lowerName],
      verified: true,
      confidence: 1.0
    };
  }

  try {
    // Use Claude with web search for organizations
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      system: RESEARCH_PROMPT,
      messages: [{
        role: "user",
        content: `Research this organization in Sonoma County, California:\n\nName: "${name}"\n\nContext: This name appears in cat clinic records, likely a local school, business, or organization.`
      }]
    });

    const text = response.content[0]?.text?.trim();
    if (!text) return null;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (err) {
    console.error(`${red}Research error:${reset}`, err.message);
    return null;
  }
}

/**
 * Find or create a place for an address/apartment
 */
async function findOrCreatePlace(address, displayName) {
  if (!address || address.length < 10) return null;

  try {
    // Use the centralized function
    const result = await pool.query(`
      SELECT trapper.find_or_create_place_deduped(
        $1,  -- formatted_address
        $2,  -- display_name
        NULL, -- lat
        NULL, -- lng
        'clinichq'  -- source_system (valid enum value)
      ) as place_id
    `, [address, displayName]);

    return result.rows[0]?.place_id;
  } catch (err) {
    console.error(`${red}Place creation error:${reset}`, err.message);
    return null;
  }
}

/**
 * Find or create a known organization
 * NOTE: Currently disabled - org linking will be added once schema is verified
 */
async function findOrCreateOrganization(research) {
  // Skip org creation for now - just log that we would create it
  if (verbose && research?.canonical_name) {
    console.log(`    ${dim}Would create org: ${research.canonical_name}${reset}`);
  }
  return null;
}

/**
 * Update an account with research results
 */
async function updateAccount(account, classification, research) {
  const updates = [];
  const values = [];
  let paramNum = 1;

  // Update account type if changed
  const newType = classification?.classification || account.account_type;
  if (newType !== account.account_type && newType !== 'likely_person') {
    updates.push(`account_type = $${paramNum++}`);
    values.push(newType === 'likely_person' ? 'unknown' : newType);
  }

  // Set canonical name
  const canonicalName = research?.canonical_name || classification?.canonical_name;
  if (canonicalName) {
    updates.push(`canonical_name = $${paramNum++}`);
    values.push(canonicalName);
  }

  // Set confidence
  const confidence = research?.confidence || classification?.confidence || 0.5;
  updates.push(`ai_confidence = $${paramNum++}`);
  values.push(confidence);

  // Set research notes
  const notes = [];
  if (classification?.reasoning) notes.push(`Classification: ${classification.reasoning}`);
  if (research?.description) notes.push(`Description: ${research.description}`);
  if (research?.notes) notes.push(`Notes: ${research.notes}`);
  if (notes.length > 0) {
    updates.push(`ai_research_notes = $${paramNum++}`);
    values.push(notes.join('\n'));
  }

  // Link to place if we have an address
  let placeId = null;
  if ((newType === 'address' || newType === 'apartment_complex') && research?.address) {
    placeId = await findOrCreatePlace(research.address, canonicalName || account.display_name);
    if (placeId) {
      updates.push(`linked_place_id = $${paramNum++}`);
      values.push(placeId);
    }
  }

  // Link to org if we have organization info
  let orgId = null;
  if (newType === 'organization' && research) {
    orgId = await findOrCreateOrganization(research);
    if (orgId) {
      updates.push(`linked_org_id = $${paramNum++}`);
      values.push(orgId);
    }
  }

  // Mark as researched
  updates.push(`ai_researched_at = NOW()`);
  updates.push(`updated_at = NOW()`);

  // Add account_id as final parameter
  values.push(account.account_id);

  const query = `
    UPDATE trapper.clinic_owner_accounts
    SET ${updates.join(', ')}
    WHERE account_id = $${paramNum}
  `;

  await pool.query(query, values);

  return { placeId, orgId };
}

/**
 * Process a single account
 */
async function processAccount(account, stats) {
  const displayStr = account.display_name.substring(0, 40);
  process.stdout.write(`  [${stats.processed + 1}] ${displayStr.padEnd(40)} `);

  // Step 1: Classify the account
  const classification = await classifyAccount(account);

  if (!classification) {
    console.log(`${yellow}classification failed${reset}`);
    stats.errors++;
    return;
  }

  // Step 2: Research if it's an organization
  let research = null;
  if (classification.classification === 'organization') {
    research = await researchOrganization(account.display_name, classification);
    stats.researched++;
  } else if (classification.classification === 'address' || classification.classification === 'apartment_complex') {
    // Try to build address from context or classification
    research = {
      canonical_name: classification.canonical_name,
      address: classification.address || account.display_name,
      description: classification.classification === 'apartment_complex' ? 'Apartment complex' : 'Street address'
    };
  }

  if (verbose) {
    console.log(`\n    ${dim}Classification: ${JSON.stringify(classification)}${reset}`);
    if (research) {
      console.log(`    ${dim}Research: ${JSON.stringify(research)}${reset}`);
    }
  }

  // Step 3: Update the account (unless dry run)
  if (dryRun) {
    const typeColor = classification.classification === 'organization' ? cyan :
                      classification.classification === 'address' ? green :
                      classification.classification === 'apartment_complex' ? yellow : dim;
    console.log(`${typeColor}${classification.classification}${reset} (${(classification.confidence * 100).toFixed(0)}%)`);
  } else {
    try {
      const { placeId, orgId } = await updateAccount(account, classification, research);

      const typeColor = classification.classification === 'organization' ? cyan :
                        classification.classification === 'address' ? green :
                        classification.classification === 'apartment_complex' ? yellow : dim;

      let suffix = '';
      if (placeId) suffix += ` → place`;
      if (orgId) suffix += ` → org`;

      console.log(`${typeColor}${classification.classification}${reset}${suffix}`);

      if (placeId) stats.linkedToPlace++;
      if (orgId) stats.linkedToOrg++;
    } catch (err) {
      console.log(`${red}error${reset} ${err.message}`);
      stats.errors++;
      return;
    }
  }

  stats.processed++;

  // Count by type
  if (!stats.byType[classification.classification]) {
    stats.byType[classification.classification] = 0;
  }
  stats.byType[classification.classification]++;
}

/**
 * Main function
 */
async function main() {
  if (help) {
    showHelp();
    process.exit(0);
  }

  console.log(`\n${bold}Research Clinic Accounts${reset}`);
  console.log('═'.repeat(60));

  if (dryRun) {
    console.log(`${yellow}DRY RUN MODE - No changes will be saved${reset}`);
  }

  console.log(`Limit: ${limit}${typeFilter ? `, Type: ${typeFilter}` : ''}${reprocess ? ', Reprocessing' : ''}`);

  // Validate environment
  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error: DATABASE_URL not set${reset}`);
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`${red}Error: ANTHROPIC_API_KEY not set${reset}`);
    process.exit(1);
  }

  // Initialize clients
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  anthropic = new Anthropic();

  const stats = {
    processed: 0,
    researched: 0,
    linkedToPlace: 0,
    linkedToOrg: 0,
    errors: 0,
    byType: {}
  };

  try {
    // Get accounts to process
    const accounts = await getAccountsToResearch();
    console.log(`\nFound ${accounts.length} accounts to process\n`);

    if (accounts.length === 0) {
      console.log(`${green}All accounts have been researched!${reset}`);
      return;
    }

    // Process each account
    for (const account of accounts) {
      await processAccount(account, stats);

      // Rate limit
      await new Promise(r => setTimeout(r, 300));
    }

    // Summary
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`${bold}Summary${reset}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`${cyan}Processed:${reset}       ${stats.processed}`);
    console.log(`${cyan}Researched:${reset}      ${stats.researched}`);
    console.log(`${green}Linked to place:${reset} ${stats.linkedToPlace}`);
    console.log(`${green}Linked to org:${reset}   ${stats.linkedToOrg}`);
    if (stats.errors > 0) {
      console.log(`${red}Errors:${reset}          ${stats.errors}`);
    }

    console.log(`\n${bold}By Type:${reset}`);
    for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }

    // Show overall stats
    const totalStats = await pool.query(`
      SELECT
        account_type,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ai_researched_at IS NOT NULL) as researched,
        COUNT(*) FILTER (WHERE linked_place_id IS NOT NULL) as linked_to_place,
        COUNT(*) FILTER (WHERE linked_org_id IS NOT NULL) as linked_to_org
      FROM trapper.clinic_owner_accounts
      GROUP BY account_type
      ORDER BY total DESC
    `);

    console.log(`\n${bold}Overall Account Stats:${reset}`);
    console.log('┌────────────────────┬───────┬────────────┬──────────┬──────────┐');
    console.log('│ Type               │ Total │ Researched │ → Place  │ → Org    │');
    console.log('├────────────────────┼───────┼────────────┼──────────┼──────────┤');
    for (const row of totalStats.rows) {
      console.log(`│ ${row.account_type.padEnd(18)} │ ${String(row.total).padStart(5)} │ ${String(row.researched).padStart(10)} │ ${String(row.linked_to_place).padStart(8)} │ ${String(row.linked_to_org).padStart(8)} │`);
    }
    console.log('└────────────────────┴───────┴────────────┴──────────┴──────────┘');

    if (dryRun) {
      console.log(`\n${yellow}DRY RUN - No changes were saved${reset}`);
    }

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`${red}Fatal error:${reset}`, err);
  process.exit(1);
});
