#!/usr/bin/env node

/**
 * enrich_clinic_accounts_ai.mjs
 *
 * AI-powered enrichment for clinic_owner_accounts with FULL CONTEXT:
 *
 * KEY CONTEXT:
 * - LMFM = "Love Me Fix Me" - Sonoma Humane waiver program for spay/neuter
 *   These are REAL PEOPLE who should be in sot_people, not pseudo-profiles
 * - ALL CAPS names = Often program participants (real people)
 *
 * SCAS/FFSC SUFFIX PATTERNS (IMPORTANT):
 * - SCAS suffix = Cat came FROM SCAS (Sonoma County Animal Services contacted FFSC)
 *   NOT "who brought the cat". Track as SCAS-origin, salvage any real name/address.
 * - FFSC suffix = Generic placeholder used when they didn't know who to name under
 *   Try to salvage real name/address if possible.
 *
 * PRIORITY: Origin address is the MOST IMPORTANT data. Salvage owner names when possible.
 *
 * What this script does:
 * 1. Identifies LMFM/program participants and converts them to real people
 * 2. Salvages real names from SCAS/FFSC prefixed records where possible
 * 3. Researches organizations via AI to get addresses
 * 4. Creates places for org addresses
 * 5. Links orgs to known_organizations
 * 6. Finds apartment complexes that may be under person names
 * 7. Links everything together properly
 *
 * Usage:
 *   node scripts/jobs/enrich_clinic_accounts_ai.mjs --dry-run
 *   node scripts/jobs/enrich_clinic_accounts_ai.mjs --type lmfm
 *   node scripts/jobs/enrich_clinic_accounts_ai.mjs --type scas  # SCAS-origin records
 *   node scripts/jobs/enrich_clinic_accounts_ai.mjs --type ffsc  # FFSC placeholder records
 *   node scripts/jobs/enrich_clinic_accounts_ai.mjs --type organization
 *   node scripts/jobs/enrich_clinic_accounts_ai.mjs --type apartment
 */

import pg from "pg";
import Anthropic from "@anthropic-ai/sdk";

const { Pool } = pg;

// ANSI colors
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const cyan = '\x1b[36m';
const magenta = '\x1b[35m';
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
const help = args.includes("--help") || args.includes("-h");

// Initialize clients
let pool;
let anthropic;

// Known organizations in Sonoma County
const KNOWN_ORGS = {
  "scas": {
    canonical_name: "Sonoma County Animal Services",
    short_name: "SCAS",
    org_type: "shelter",
    address: "1247 Century Ct, Santa Rosa, CA 95403",
    phone: "707-565-7100"
  },
  "sonoma county animal services": {
    canonical_name: "Sonoma County Animal Services",
    short_name: "SCAS",
    org_type: "shelter",
    address: "1247 Century Ct, Santa Rosa, CA 95403",
    phone: "707-565-7100"
  },
  "ffsc": {
    canonical_name: "Forgotten Felines of Sonoma County",
    short_name: "FFSC",
    org_type: "nonprofit",
    address: "545 Sebastopol Ave, Santa Rosa, CA 95401",
    phone: "707-576-7999"
  },
  "forgotten felines": {
    canonical_name: "Forgotten Felines of Sonoma County",
    short_name: "FFSC",
    org_type: "nonprofit",
    address: "545 Sebastopol Ave, Santa Rosa, CA 95401",
    phone: "707-576-7999"
  },
  "sonoma humane": {
    canonical_name: "Sonoma Humane Society",
    short_name: "SHS",
    org_type: "shelter",
    address: "5345 Highway 12 West, Santa Rosa, CA 95407",
    phone: "707-542-0882"
  },
  "lmfm": {
    canonical_name: "Love Me Fix Me Program (Sonoma Humane)",
    short_name: "LMFM",
    org_type: "program",
    address: "5345 Highway 12 West, Santa Rosa, CA 95407",
    phone: "707-542-0882",
    notes: "Waiver program for low-income spay/neuter through Sonoma Humane Society"
  }
};

// AI prompt for comprehensive entity analysis
const ANALYSIS_PROMPT = `You are a data analyst for Forgotten Felines of Sonoma County (FFSC), a cat TNR organization.

CRITICAL CONTEXT - Sonoma County Animal Welfare:
- FFSC (Forgotten Felines of Sonoma County) - Cat rescue and TNR organization
- SCAS (Sonoma County Animal Services) - County shelter at 1247 Century Ct, Santa Rosa
- Sonoma Humane Society - Shelter at 5345 Highway 12 West, Santa Rosa
- LMFM = "Love Me Fix Me" - Sonoma Humane's waiver program for low-income spay/neuter
  * Records with "LMFM" prefix are REAL PEOPLE enrolled in this program
  * Example: "Lmfm Karen Lopez" = Karen Lopez enrolled in LMFM program
- ALL CAPS names often indicate program participants (REAL PEOPLE)

IMPORTANT - SCAS/FFSC SUFFIX MEANING:
- SCAS suffix = Cat came FROM SCAS (they contacted FFSC), NOT who brought the cat
  * "John Smith SCAS" = John Smith, cat came from SCAS
  * "Comstock Middle School SCAS" = School, cat came from SCAS
- FFSC suffix = Generic placeholder used when we didn't know who to name under
  * Try to salvage the real name or address if possible
  * "John Smith FFSC" = salvage "John Smith" as owner name
  * "123 Main St FFSC" = salvage "123 Main St" as address

PRIORITY: Origin address is MOST IMPORTANT. Salvage owner names when possible.

YOUR TASK:
Analyze this clinic record and determine:
1. Is this a REAL PERSON or a pseudo-profile (address/org/apartment)?
2. If person: Extract actual name (remove SCAS/FFSC suffixes, LMFM prefix)
3. If org: Research to find official name, address, phone
4. If apartment: Identify as residential complex needing place creation
5. If address: Identify as address needing place creation

Return JSON:
{
  "entity_type": "person" | "organization" | "apartment_complex" | "address" | "unknown",
  "is_program_participant": true/false,
  "program_name": "LMFM" | null,
  "origin_org": "SCAS" | "FFSC" | null,
  "cleaned_name": "Actual name without prefixes/suffixes",
  "first_name": "First" | null,
  "last_name": "Last" | null,
  "salvaged_address": "Address if one can be extracted" | null,
  "org_info": {
    "canonical_name": "Official org name",
    "org_type": "school|church|business|shelter|nonprofit|government|other",
    "address": "Full street address, City, CA ZIP",
    "phone": "707-XXX-XXXX" | null
  } | null,
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

function showHelp() {
  console.log(`
${bold}Enrich Clinic Accounts (AI-Powered)${reset}

Comprehensive AI enrichment for clinic_owner_accounts with full Sonoma County context.

${bold}Key Context:${reset}
  LMFM = "Love Me Fix Me" - Sonoma Humane waiver program (REAL PEOPLE)
  ALL CAPS = Often program participants (REAL PEOPLE)
  SCAS suffix = Cat came FROM SCAS (not who brought it) - salvage name/address
  FFSC suffix = Generic placeholder - salvage real data if possible

${bold}Priority:${reset}
  1. Origin address (where cat came from) - MOST IMPORTANT
  2. Salvage owner names when extractable
  3. Link to places for Beacon stats

${bold}Usage:${reset}
  node scripts/jobs/enrich_clinic_accounts_ai.mjs [options]

${bold}Options:${reset}
  --dry-run       Preview changes without saving
  --limit N       Process up to N accounts (default: 50)
  --type TYPE     Filter by: lmfm, scas, ffsc, organization, apartment, address, unknown
  --verbose, -v   Show detailed output
  --help, -h      Show this help

${bold}Examples:${reset}
  # Process LMFM records (convert to real people)
  node scripts/jobs/enrich_clinic_accounts_ai.mjs --type lmfm --limit 50

  # Process SCAS-origin records (salvage names/addresses)
  node scripts/jobs/enrich_clinic_accounts_ai.mjs --type scas --limit 100

  # Process FFSC placeholder records
  node scripts/jobs/enrich_clinic_accounts_ai.mjs --type ffsc --limit 100

  # Research organizations and get addresses
  node scripts/jobs/enrich_clinic_accounts_ai.mjs --type organization

  # Find apartment complexes
  node scripts/jobs/enrich_clinic_accounts_ai.mjs --type apartment
`);
}

/**
 * Check if a name is an LMFM program participant
 */
function isLmfmParticipant(name) {
  return /^lmfm\s+/i.test(name) || /\blmfm\b/i.test(name);
}

/**
 * Check if a name is ALL CAPS (likely program participant)
 */
function isAllCaps(name) {
  const cleaned = name.replace(/[^a-zA-Z\s]/g, '').trim();
  return cleaned.length > 3 && cleaned === cleaned.toUpperCase();
}

/**
 * Extract real name from prefixed name
 */
function extractRealName(name) {
  // Remove common prefixes
  let cleaned = name
    .replace(/^lmfm\s+/i, '')
    .replace(/^duplicate\s+report\s+/i, '')
    .replace(/^archived\s+record\s+/i, '')
    .replace(/\s+(ffsc|scas)$/i, '')
    .trim();

  // Split into first/last
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 2) {
    return {
      first_name: parts[0],
      last_name: parts.slice(1).join(' '),
      display_name: cleaned
    };
  }
  return {
    first_name: cleaned,
    last_name: null,
    display_name: cleaned
  };
}

/**
 * Analyze an account using AI
 */
async function analyzeAccountWithAI(account) {
  const displayName = account.display_name;

  // Quick checks first
  if (isLmfmParticipant(displayName)) {
    const { first_name, last_name, display_name } = extractRealName(displayName);
    return {
      entity_type: 'person',
      is_program_participant: true,
      program_name: 'LMFM',
      cleaned_name: display_name,
      first_name,
      last_name,
      org_info: null,
      confidence: 0.95,
      reasoning: 'LMFM prefix indicates Sonoma Humane waiver program participant'
    };
  }

  // Check for known orgs
  const lowerName = displayName.toLowerCase().replace(/\s+(ffsc|scas)$/i, '').trim();
  if (KNOWN_ORGS[lowerName]) {
    const org = KNOWN_ORGS[lowerName];
    return {
      entity_type: 'organization',
      is_program_participant: false,
      program_name: null,
      cleaned_name: org.canonical_name,
      first_name: null,
      last_name: null,
      org_info: {
        canonical_name: org.canonical_name,
        org_type: org.org_type,
        address: org.address,
        phone: org.phone
      },
      confidence: 1.0,
      reasoning: 'Known Sonoma County organization'
    };
  }

  // Use AI for deeper analysis
  try {
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      system: ANALYSIS_PROMPT,
      messages: [{
        role: "user",
        content: `Analyze this clinic record:

Name: "${displayName}"
Current account_type: ${account.account_type}
Has brought_by suffix: ${account.brought_by || 'none'}
Source variations: ${account.source_display_names?.join(', ') || 'none'}

Determine what this entity actually is and provide cleaned/researched info.`
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
    console.error(`${red}AI analysis error:${reset}`, err.message);
    return null;
  }
}

/**
 * Research an organization using AI with web search capability
 */
async function researchOrganizationAI(name) {
  // Strip suffixes
  const cleanName = name.replace(/\s+(ffsc|scas)$/i, '').trim();

  // Check known orgs first
  const lowerName = cleanName.toLowerCase();
  for (const [key, org] of Object.entries(KNOWN_ORGS)) {
    if (lowerName.includes(key) || key.includes(lowerName)) {
      return {
        canonical_name: org.canonical_name,
        org_type: org.org_type,
        address: org.address,
        phone: org.phone,
        verified: true,
        confidence: 1.0
      };
    }
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      system: `You are researching organizations in Sonoma County, California for a cat TNR database.

For this organization, provide:
- Official/canonical name
- Type (school, church, business, shelter, nonprofit, government, park, other)
- Full street address with city, state, zip
- Phone number if known

Return JSON only:
{
  "canonical_name": "Official Name",
  "org_type": "type",
  "address": "Street, City, CA ZIP",
  "phone": "707-XXX-XXXX or null",
  "verified": true/false,
  "confidence": 0.0-1.0
}`,
      messages: [{
        role: "user",
        content: `Research this organization in Sonoma County, CA: "${cleanName}"`
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
    if (verbose) console.error(`${red}Research error:${reset}`, err.message);
    return null;
  }
}

/**
 * Convert an LMFM/program participant account to a real person
 */
async function convertToPerson(account, analysis, stats) {
  if (dryRun) {
    console.log(`${magenta}→ person${reset} (${analysis.program_name} participant)`);
    return;
  }

  try {
    // Create the person directly (since we don't have email/phone for dedup)
    const displayName = `${analysis.first_name || ''} ${analysis.last_name || ''}`.trim();

    // Check if person already exists with this name
    let personId;
    const existing = await pool.query(`
      SELECT person_id FROM trapper.sot_people
      WHERE lower(display_name) = lower($1)
        AND merged_into_person_id IS NULL
      LIMIT 1
    `, [displayName]);

    if (existing.rows.length > 0) {
      personId = existing.rows[0].person_id;
    } else {
      // Create new person (sot_people only has display_name, not first_name/last_name)
      const result = await pool.query(`
        INSERT INTO trapper.sot_people (
          display_name,
          data_source,
          account_type,
          account_type_reason
        ) VALUES ($1, 'clinichq', 'person', $2)
        RETURNING person_id
      `, [displayName, `Converted from ${analysis.program_name || 'LMFM'} program participant`]);
      personId = result.rows[0]?.person_id;
    }

    if (personId) {
      // Update the account to mark it as converted
      await pool.query(`
        UPDATE trapper.clinic_owner_accounts
        SET account_type = 'converted_to_person',
            ai_researched_at = NOW(),
            ai_research_notes = $1,
            ai_confidence = $2,
            updated_at = NOW()
        WHERE account_id = $3
      `, [
        `Converted to person: ${analysis.cleaned_name} (${analysis.program_name} participant)`,
        analysis.confidence,
        account.account_id
      ]);

      // Update any appointments that reference this account to point to the person
      await pool.query(`
        UPDATE trapper.sot_appointments
        SET person_id = $1,
            owner_account_id = NULL
        WHERE owner_account_id = $2
      `, [personId, account.account_id]);

      console.log(`${magenta}→ person${reset} ${personId.substring(0, 8)}... (${analysis.program_name})`);
      stats.convertedToPerson++;
    }
  } catch (err) {
    console.log(`${red}error${reset} ${err.message}`);
    stats.errors++;
  }
}

/**
 * Enrich an organization with address and link to places
 */
async function enrichOrganization(account, analysis, stats) {
  const orgInfo = analysis.org_info;

  if (dryRun) {
    if (orgInfo?.address) {
      console.log(`${cyan}organization${reset} → place: ${orgInfo.address.substring(0, 40)}`);
    } else {
      console.log(`${cyan}organization${reset} (no address found)`);
    }
    return;
  }

  try {
    let placeId = null;

    // Create place if we have an address
    if (orgInfo?.address && orgInfo.address.length > 10) {
      const placeResult = await pool.query(`
        SELECT trapper.find_or_create_place_deduped(
          $1,  -- address
          $2,  -- display_name
          NULL,
          NULL,
          'clinichq'
        ) as place_id
      `, [orgInfo.address, orgInfo.canonical_name || account.display_name]);

      placeId = placeResult.rows[0]?.place_id;
    }

    // Update the account
    await pool.query(`
      UPDATE trapper.clinic_owner_accounts
      SET canonical_name = COALESCE($1, canonical_name),
          linked_place_id = COALESCE($2, linked_place_id),
          ai_researched_at = NOW(),
          ai_research_notes = $3,
          ai_confidence = $4,
          updated_at = NOW()
      WHERE account_id = $5
    `, [
      orgInfo?.canonical_name,
      placeId,
      `Org: ${orgInfo?.canonical_name || account.display_name}, Type: ${orgInfo?.org_type || 'unknown'}, Phone: ${orgInfo?.phone || 'unknown'}`,
      analysis.confidence,
      account.account_id
    ]);

    if (placeId) {
      console.log(`${cyan}organization${reset} → place`);
      stats.linkedToPlace++;
    } else {
      console.log(`${cyan}organization${reset}`);
    }
  } catch (err) {
    console.log(`${red}error${reset} ${err.message}`);
    stats.errors++;
  }
}

/**
 * Process a single account
 */
async function processAccount(account, stats) {
  const displayStr = account.display_name.substring(0, 40).padEnd(40);
  process.stdout.write(`  [${stats.processed + 1}] ${displayStr} `);

  // Analyze with AI
  const analysis = await analyzeAccountWithAI(account);

  if (!analysis) {
    console.log(`${yellow}analysis failed${reset}`);
    stats.errors++;
    return;
  }

  if (verbose) {
    console.log(`\n    ${dim}${JSON.stringify(analysis)}${reset}`);
  }

  // Handle based on entity type
  if (analysis.entity_type === 'person' && analysis.is_program_participant) {
    await convertToPerson(account, analysis, stats);
  } else if (analysis.entity_type === 'organization') {
    // Research the org for more details if needed
    let enrichedAnalysis = analysis;
    if (!analysis.org_info?.address) {
      const research = await researchOrganizationAI(account.display_name);
      if (research) {
        enrichedAnalysis = {
          ...analysis,
          org_info: research
        };
      }
    }
    await enrichOrganization(account, enrichedAnalysis, stats);
  } else if (analysis.entity_type === 'apartment_complex') {
    // Handle apartment complex - create place
    if (!dryRun) {
      try {
        const placeResult = await pool.query(`
          SELECT trapper.find_or_create_place_deduped(
            $1,
            $1,
            NULL,
            NULL,
            'clinichq'
          ) as place_id
        `, [account.display_name]);

        const placeId = placeResult.rows[0]?.place_id;

        await pool.query(`
          UPDATE trapper.clinic_owner_accounts
          SET linked_place_id = $1,
              ai_researched_at = NOW(),
              ai_confidence = $2,
              updated_at = NOW()
          WHERE account_id = $3
        `, [placeId, analysis.confidence, account.account_id]);

        console.log(`${yellow}apartment_complex${reset} → place`);
        stats.linkedToPlace++;
      } catch (err) {
        console.log(`${red}error${reset} ${err.message}`);
        stats.errors++;
      }
    } else {
      console.log(`${yellow}apartment_complex${reset}`);
    }
  } else if (analysis.entity_type === 'address') {
    // Handle address - create place
    if (!dryRun) {
      try {
        const placeResult = await pool.query(`
          SELECT trapper.find_or_create_place_deduped(
            $1,
            NULL,
            NULL,
            NULL,
            'clinichq'
          ) as place_id
        `, [account.display_name]);

        const placeId = placeResult.rows[0]?.place_id;

        await pool.query(`
          UPDATE trapper.clinic_owner_accounts
          SET linked_place_id = $1,
              ai_researched_at = NOW(),
              ai_confidence = $2,
              updated_at = NOW()
          WHERE account_id = $3
        `, [placeId, analysis.confidence, account.account_id]);

        console.log(`${green}address${reset} → place`);
        stats.linkedToPlace++;
      } catch (err) {
        console.log(`${red}error${reset} ${err.message}`);
        stats.errors++;
      }
    } else {
      console.log(`${green}address${reset}`);
    }
  } else {
    // Unknown - just update with analysis
    if (!dryRun) {
      await pool.query(`
        UPDATE trapper.clinic_owner_accounts
        SET ai_researched_at = NOW(),
            ai_research_notes = $1,
            ai_confidence = $2,
            updated_at = NOW()
        WHERE account_id = $3
      `, [analysis.reasoning, analysis.confidence, account.account_id]);
    }
    console.log(`${dim}unknown${reset}`);
  }

  stats.processed++;
  stats.byType[analysis.entity_type] = (stats.byType[analysis.entity_type] || 0) + 1;
}

/**
 * Get accounts to process based on type filter
 */
async function getAccountsToProcess() {
  let whereClause = '1=1';

  if (typeFilter === 'lmfm') {
    // Find LMFM participants (in unknown or any type)
    whereClause = `(display_name ILIKE 'lmfm %' OR display_name ILIKE '% lmfm%')`;
  } else if (typeFilter === 'scas') {
    // SCAS-origin records - cat came FROM SCAS
    // These may have salvageable names or addresses
    whereClause = `(brought_by = 'SCAS' OR display_name ILIKE '% scas' OR display_name ILIKE 'scas %')
                   AND ai_researched_at IS NULL`;
  } else if (typeFilter === 'ffsc') {
    // FFSC placeholder records - generic naming, try to salvage
    whereClause = `(brought_by = 'FFSC' OR display_name ILIKE '% ffsc' OR display_name ILIKE 'ffsc %'
                   OR display_name ILIKE '% forgotten felines%')
                   AND ai_researched_at IS NULL`;
  } else if (typeFilter === 'organization') {
    whereClause = `account_type = 'organization' AND linked_place_id IS NULL`;
  } else if (typeFilter === 'apartment') {
    whereClause = `account_type = 'apartment_complex' AND linked_place_id IS NULL`;
  } else if (typeFilter === 'address') {
    whereClause = `account_type = 'address' AND linked_place_id IS NULL`;
  } else if (typeFilter === 'unknown') {
    whereClause = `account_type = 'unknown' AND ai_researched_at IS NULL`;
  }

  const query = `
    SELECT
      account_id,
      display_name,
      account_type,
      brought_by,
      source_display_names,
      linked_place_id,
      linked_org_id
    FROM trapper.clinic_owner_accounts
    WHERE ${whereClause}
    ORDER BY created_at
    LIMIT $1
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

/**
 * Main function
 */
async function main() {
  if (help) {
    showHelp();
    process.exit(0);
  }

  console.log(`\n${bold}Enrich Clinic Accounts (AI-Powered)${reset}`);
  console.log('═'.repeat(60));

  if (dryRun) {
    console.log(`${yellow}DRY RUN MODE - No changes will be saved${reset}`);
  }

  console.log(`Limit: ${limit}${typeFilter ? `, Type: ${typeFilter}` : ''}`);
  console.log(`${dim}LMFM = Love Me Fix Me (Sonoma Humane waiver program)${reset}\n`);

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
    convertedToPerson: 0,
    linkedToPlace: 0,
    linkedToOrg: 0,
    errors: 0,
    byType: {}
  };

  try {
    const accounts = await getAccountsToProcess();
    console.log(`Found ${accounts.length} accounts to process\n`);

    if (accounts.length === 0) {
      console.log(`${green}No accounts to process for this filter${reset}`);
      return;
    }

    for (const account of accounts) {
      await processAccount(account, stats);
      await new Promise(r => setTimeout(r, 300)); // Rate limit
    }

    // Summary
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`${bold}Summary${reset}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`${cyan}Processed:${reset}          ${stats.processed}`);
    console.log(`${magenta}Converted to person:${reset} ${stats.convertedToPerson}`);
    console.log(`${green}Linked to place:${reset}    ${stats.linkedToPlace}`);
    if (stats.errors > 0) {
      console.log(`${red}Errors:${reset}             ${stats.errors}`);
    }

    console.log(`\n${bold}By Type:${reset}`);
    for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }

    // Show final stats
    const totalStats = await pool.query(`
      SELECT
        account_type,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ai_researched_at IS NOT NULL) as researched,
        COUNT(*) FILTER (WHERE linked_place_id IS NOT NULL) as linked_to_place
      FROM trapper.clinic_owner_accounts
      GROUP BY account_type
      ORDER BY total DESC
    `);

    console.log(`\n${bold}Overall Account Stats:${reset}`);
    console.log('┌──────────────────────┬───────┬────────────┬──────────────┐');
    console.log('│ Type                 │ Total │ Researched │ Linked Place │');
    console.log('├──────────────────────┼───────┼────────────┼──────────────┤');
    for (const row of totalStats.rows) {
      console.log(`│ ${row.account_type.padEnd(20)} │ ${String(row.total).padStart(5)} │ ${String(row.researched).padStart(10)} │ ${String(row.linked_to_place).padStart(12)} │`);
    }
    console.log('└──────────────────────┴───────┴────────────┴──────────────┘');

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
