#!/usr/bin/env node
/**
 * volunteerhub_api_sync.mjs
 *
 * Syncs VolunteerHub volunteer data via API into Atlas.
 * Pulls user groups, users with all 52 fields, and maps group memberships to Atlas roles.
 *
 * Data flow:
 *   VH API → staged_records (raw)
 *           → volunteerhub_volunteers (enriched)
 *           → volunteerhub_group_memberships (temporal)
 *           → person_roles (via process_volunteerhub_group_roles)
 *
 * Usage:
 *   export $(cat .env | grep -v '^#' | xargs)
 *   node scripts/ingest/volunteerhub_api_sync.mjs
 *   node scripts/ingest/volunteerhub_api_sync.mjs --full-sync
 *   node scripts/ingest/volunteerhub_api_sync.mjs --groups-only
 *   node scripts/ingest/volunteerhub_api_sync.mjs --dry-run --verbose
 *
 * Required env:
 *   DATABASE_URL           - Postgres connection string
 *   VOLUNTEERHUB_API_KEY   - Auth credentials (tried as basic auth, then bearer)
 *   VOLUNTEERHUB_API_URL   - Base URL (default: https://forgottenfelines.volunteerhub.com)
 */

import pg from 'pg';
import crypto from 'crypto';

const { Client } = pg;

// ============================================================================
// Config
// ============================================================================

const BASE_URL = (process.env.VOLUNTEERHUB_API_URL || 'https://forgottenfelines.volunteerhub.com').replace(/\/+$/, '');
const API_KEY = process.env.VOLUNTEERHUB_API_KEY;
const SOURCE_SYSTEM = 'volunteerhub';
const SOURCE_TABLE = 'users';
const PAGE_SIZE = 50;
const DELAY_MS = 250; // Rate limit courtesy delay

const colors = {
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m'
};

// ============================================================================
// CLI Args
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    fullSync: args.includes('--full-sync'),
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    groupsOnly: args.includes('--groups-only'),
  };
}

// ============================================================================
// API Client
// ============================================================================

let authHeader = null;

async function tryAuth(url, header) {
  const res = await fetch(url, {
    headers: { 'Authorization': header, 'Accept': 'application/json' }
  });
  return res.ok ? res : null;
}

async function discoverAuth() {
  const testUrl = `${BASE_URL}/api/v1/organization`;

  // Try 1: API key as basic auth value
  let res = await tryAuth(testUrl, `basic ${API_KEY}`);
  if (res) { authHeader = `basic ${API_KEY}`; return res; }

  // Try 2: API key as Bearer token
  res = await tryAuth(testUrl, `Bearer ${API_KEY}`);
  if (res) { authHeader = `Bearer ${API_KEY}`; return res; }

  // Try 3: API key as raw basic auth (already base64)
  res = await tryAuth(testUrl, `Basic ${API_KEY}`);
  if (res) { authHeader = `Basic ${API_KEY}`; return res; }

  // Try 4: Separate username/password
  const user = process.env.VOLUNTEERHUB_USERNAME;
  const pass = process.env.VOLUNTEERHUB_PASSWORD;
  if (user && pass) {
    const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
    res = await tryAuth(testUrl, `basic ${encoded}`);
    if (res) { authHeader = `basic ${encoded}`; return res; }
  }

  throw new Error(
    'Could not authenticate with VolunteerHub API. Tried:\n' +
    '  1. VOLUNTEERHUB_API_KEY as basic auth\n' +
    '  2. VOLUNTEERHUB_API_KEY as Bearer token\n' +
    '  3. VOLUNTEERHUB_USERNAME + VOLUNTEERHUB_PASSWORD\n' +
    'Check your .env credentials.'
  );
}

async function apiGet(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate'
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VH API ${res.status}: ${path} — ${text.substring(0, 200)}`);
  }

  return res.json();
}

async function apiGetPaginated(path, params = {}) {
  const allResults = [];
  let page = 0;

  while (true) {
    const data = await apiGet(path, { ...params, page: String(page), pageSize: String(PAGE_SIZE) });
    const items = Array.isArray(data) ? data : (data.Results || data.results || [data]);

    if (items.length === 0) break;
    allResults.push(...items);

    if (items.length < PAGE_SIZE) break;
    page++;
    await sleep(DELAY_MS);
  }

  return allResults;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================================
// FormAnswer Decoding
// ============================================================================

/**
 * Build a mapping from FormQuestionUid → human-readable field label
 * by parsing the organization's Form definitions.
 */
function buildQuestionMapping(orgData) {
  const mapping = {};

  const forms = orgData.Forms || orgData.forms || [];
  for (const form of forms) {
    const questions = form.FormQuestions || form.formQuestions || [];
    for (const q of questions) {
      const uid = q.FormQuestionUid || q.formQuestionUid;
      const label = q.Name || q.name || q.Label || q.label || q.Text || q.text || '';
      if (uid && label) {
        mapping[uid] = label;
      }
    }
  }

  return mapping;
}

/**
 * Decode a user's FormAnswers array into a flat key→value object
 * using the question mapping.
 */
function decodeFormAnswers(formAnswers, questionMapping) {
  const fields = {};

  for (const answer of (formAnswers || [])) {
    const quid = answer.FormQuestionUid || answer.formQuestionUid;
    const label = questionMapping[quid] || quid;
    const normalizedLabel = label.toLowerCase().trim();

    // FormAnswerName
    if (answer.FirstName !== undefined || answer.firstName !== undefined) {
      fields['Name - FirstName'] = answer.FirstName || answer.firstName || '';
      fields['Name - MiddleName'] = answer.MiddleName || answer.middleName || '';
      fields['Name - LastName'] = answer.LastName || answer.lastName || '';
      fields['Name - Prefix'] = answer.Prefix || answer.prefix || '';
      continue;
    }

    // FormAnswerAddress
    if (answer.Address1 !== undefined || answer.address1 !== undefined) {
      fields['Street Address - Address1'] = answer.Address1 || answer.address1 || '';
      fields['Street Address - Address2'] = answer.Address2 || answer.address2 || '';
      fields['Street Address - City'] = answer.City || answer.city || '';
      fields['Street Address - State'] = answer.State || answer.state || '';
      fields['Street Address - PostalCode'] = answer.PostalCode || answer.postalCode || '';
      continue;
    }

    // FormAnswerEmailAddress — VH may use EmailAddress property
    if (answer.EmailAddress !== undefined || answer.emailAddress !== undefined) {
      fields[label] = answer.EmailAddress || answer.emailAddress || '';
      continue;
    }

    // FormAnswerPhoneNumber — VH may use PhoneNumber property
    if (answer.PhoneNumber !== undefined || answer.phoneNumber !== undefined) {
      fields[label] = answer.PhoneNumber || answer.phoneNumber || '';
      continue;
    }

    // FormAnswerString / Boolean / other types — use the label
    const value = answer.Value !== undefined ? answer.Value
                : answer.value !== undefined ? answer.value
                : answer.BoolValue !== undefined ? answer.BoolValue
                : answer.boolValue !== undefined ? answer.boolValue
                : '';
    fields[label] = value;
  }

  return fields;
}

/**
 * Extract structured volunteer data from decoded form fields.
 */
function extractVolunteerData(fields, user) {
  const email = (fields['Email'] || fields['email'] || '').toLowerCase().trim() || null;
  const homePhone = fields['Home Phone'] || fields['home phone'] || '';
  const mobilePhone = fields['Mobile Phone'] || fields['mobile phone'] || '';
  const phone = mobilePhone || homePhone || null;

  return {
    volunteerhub_id: user.UserUid || user.userUid,
    username: user.Username || user.username || null,
    email,
    phone,
    first_name: fields['Name - FirstName'] || '',
    last_name: fields['Name - LastName'] || '',
    display_name: `${fields['Name - FirstName'] || ''} ${fields['Name - LastName'] || ''}`.trim(),
    address: fields['Street Address - Address1'] || '',
    city: fields['Street Address - City'] || '',
    state: fields['Street Address - State'] || '',
    zip: fields['Street Address - PostalCode'] || '',
    is_active: user.IsActive !== undefined ? user.IsActive : true,
    hours_logged: parseFloat(user.Hours || user.hours || '0') || 0,
    event_count: parseInt(user.EventCount || user.eventCount || '0', 10) || 0,
    joined_at: user.Created || user.created || null,
    last_activity_at: user.LastActivity || user.lastActivity || null,
    last_login_at: user.LastLogin || user.lastLogin || null,
    vh_version: parseInt(user.Version || user.version || '0', 10) || 0,
    user_group_uids: user.UserGroupMemberships || user.userGroupMemberships || [],

    // Enriched fields from form answers
    volunteer_notes: fields['Volunteer Notes'] || null,
    volunteer_motivation: fields['Why would you like to Volunteer with FFSC?'] || null,
    volunteer_experience: fields['Volunteer Experience'] || null,
    volunteer_availability: fields['Available Days & Times to Volunteer?'] || null,
    pronouns: fields['What are your preferred pronouns?'] || null,
    occupation: fields['Occupation'] || null,
    languages: fields['Are you fluent in other languages?'] || null,
    how_heard: fields['How did you hear about Forgotten Felines?'] || null,
    emergency_contact_raw: fields['Emergency Contact'] || null,
    can_drive: (fields['Do you drive?'] || '').toLowerCase().includes('yes') || null,
    date_of_birth: parseDate(fields['Date of Birth']),
    waiver_status: fields['Waiver'] || null,

    // Skills JSONB
    skills: {
      trapping: fields['Trapping'] || null,
      fostering: fields['Fostering'] || null,
      colony_caretaking: fields['Cat Colony Caretaking'] || null,
      transportation: fields['Transportation'] || null,
      special_skills: fields['Special Skills'] || null,
      spay_neuter_clinic: fields['Spay/Neuter Clinic'] || null,
      cat_reunification: fields['Cat Reunification'] || null,
      cat_experience: fields['Cat or Kitten Experience'] || null,
      laundry_angel: fields['Laundry Angel'] || null,
      special_events: fields['Special Events/Fundraising'] || null,
      thrift_store: fields['Volunteering at Pick of The Litter Thrift Store'] || null,
    },

    // Raw form fields for staged_records
    raw_fields: fields,
  };
}

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

function computeRowHash(data) {
  const normalized = {};
  for (const key of Object.keys(data).sort()) {
    let value = data[key];
    if (typeof value === 'string') value = value.trim().toLowerCase();
    if (value !== '' && value !== null && value !== undefined && key !== 'raw_fields') {
      normalized[key] = value;
    }
  }
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex').substring(0, 32);
}

// ============================================================================
// Database Operations
// ============================================================================

async function getLastSyncDate(client) {
  const res = await client.query(`
    SELECT MAX(last_api_sync_at) as last_sync
    FROM trapper.volunteerhub_volunteers
    WHERE last_api_sync_at IS NOT NULL
  `);
  return res.rows[0]?.last_sync || null;
}

async function upsertUserGroups(client, groups, verbose) {
  let inserted = 0, updated = 0;

  for (const group of groups) {
    const uid = group.UserGroupUid || group.userGroupUid;
    const name = group.Name || group.name || '';
    const desc = group.Description || group.description || '';
    const parentUid = group.ParentUserGroupUid || group.parentUserGroupUid || null;

    const res = await client.query(`
      INSERT INTO trapper.volunteerhub_user_groups (user_group_uid, name, description, parent_user_group_uid, synced_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_group_uid) DO UPDATE SET
        name = $2, description = $3, parent_user_group_uid = $4, synced_at = NOW()
      RETURNING (xmax = 0) as was_inserted
    `, [uid, name, desc, parentUid]);

    if (res.rows[0]?.was_inserted) inserted++;
    else updated++;

    if (verbose) console.log(`  ${colors.dim}Group: ${name} (${uid})${colors.reset}`);
  }

  return { inserted, updated };
}

async function markApprovedParent(client, groups) {
  // Find "Approved Volunteers" group and mark it
  for (const group of groups) {
    const name = (group.Name || group.name || '').trim();
    const uid = group.UserGroupUid || group.userGroupUid;
    const parentUid = group.ParentUserGroupUid || group.parentUserGroupUid;

    if (name === 'Approved Volunteers' && !parentUid) {
      await client.query(`
        UPDATE trapper.volunteerhub_user_groups
        SET is_approved_parent = TRUE
        WHERE user_group_uid = $1
      `, [uid]);
      return uid;
    }
  }

  // Fallback: look for "Approved Volunteers" that is a parent of other groups
  for (const group of groups) {
    const name = (group.Name || group.name || '').trim();
    const uid = group.UserGroupUid || group.userGroupUid;

    if (name === 'Approved Volunteers') {
      await client.query(`
        UPDATE trapper.volunteerhub_user_groups
        SET is_approved_parent = TRUE
        WHERE user_group_uid = $1
      `, [uid]);
      return uid;
    }
  }

  return null;
}

async function seedRoleMappings(client) {
  // Seed known group→role mappings (by name pattern matching)
  const mappings = [
    { pattern: 'Approved Trappers', role: 'trapper', type: 'ffsc_trapper' },
    { pattern: 'Approved Foster Parent', role: 'foster', type: null },
    { pattern: 'Approved Forever Foster', role: 'foster', type: null },
    { pattern: 'Approved Rehabilitation', role: 'foster', type: null },
    { pattern: 'Approved Colony Caretakers', role: 'caretaker', type: null },
    { pattern: 'Admin/Office', role: 'staff', type: null },
  ];

  for (const m of mappings) {
    await client.query(`
      UPDATE trapper.volunteerhub_user_groups
      SET atlas_role = $2, atlas_trapper_type = $3
      WHERE name ILIKE $1 || '%'
        AND atlas_role IS NULL
    `, [m.pattern, m.role, m.type]);
  }

  // Default: all unmapped groups under "Approved Volunteers" → volunteer
  await client.query(`
    UPDATE trapper.volunteerhub_user_groups
    SET atlas_role = 'volunteer'
    WHERE atlas_role IS NULL
      AND parent_user_group_uid IS NOT NULL
      AND parent_user_group_uid IN (
        SELECT user_group_uid FROM trapper.volunteerhub_user_groups WHERE is_approved_parent = TRUE
      )
  `);
}

async function upsertVolunteer(client, data) {
  const fullAddress = [data.address, data.city, data.state, data.zip].filter(Boolean).join(', ');

  // Generated columns (display_name, phone_norm, email_norm, full_address) excluded from INSERT
  const res = await client.query(`
    INSERT INTO trapper.volunteerhub_volunteers (
      volunteerhub_id, username, email, phone, first_name, last_name,
      address, city, state, zip,
      status, is_active, hours_logged, event_count,
      joined_at, last_activity_at, last_login_at,
      vh_version, user_group_uids, last_api_sync_at,
      volunteer_notes, skills, volunteer_availability, languages,
      pronouns, occupation, how_heard, volunteer_motivation,
      emergency_contact_raw, can_drive, date_of_birth, volunteer_experience,
      waiver_status, raw_data, synced_at, sync_status
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      CASE WHEN $11 THEN 'active' ELSE 'inactive' END, $11, $12, $13,
      $14::timestamptz, $15::timestamptz, $16::timestamptz,
      $17, $18, NOW(),
      $19, $20, $21, $22,
      $23, $24, $25, $26,
      $27, $28, $29::date, $30,
      $31, $32, NOW(), 'pending'
    )
    ON CONFLICT (volunteerhub_id) DO UPDATE SET
      username = EXCLUDED.username,
      email = COALESCE(EXCLUDED.email, volunteerhub_volunteers.email),
      phone = COALESCE(EXCLUDED.phone, volunteerhub_volunteers.phone),
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      address = EXCLUDED.address, city = EXCLUDED.city,
      state = EXCLUDED.state, zip = EXCLUDED.zip,
      status = EXCLUDED.status, is_active = EXCLUDED.is_active,
      hours_logged = EXCLUDED.hours_logged, event_count = EXCLUDED.event_count,
      last_activity_at = EXCLUDED.last_activity_at,
      last_login_at = EXCLUDED.last_login_at,
      vh_version = EXCLUDED.vh_version,
      user_group_uids = EXCLUDED.user_group_uids,
      last_api_sync_at = NOW(),
      volunteer_notes = EXCLUDED.volunteer_notes,
      skills = EXCLUDED.skills,
      volunteer_availability = EXCLUDED.volunteer_availability,
      languages = EXCLUDED.languages,
      pronouns = EXCLUDED.pronouns,
      occupation = EXCLUDED.occupation,
      how_heard = EXCLUDED.how_heard,
      volunteer_motivation = EXCLUDED.volunteer_motivation,
      emergency_contact_raw = EXCLUDED.emergency_contact_raw,
      can_drive = EXCLUDED.can_drive,
      date_of_birth = EXCLUDED.date_of_birth,
      volunteer_experience = EXCLUDED.volunteer_experience,
      waiver_status = EXCLUDED.waiver_status,
      raw_data = EXCLUDED.raw_data,
      synced_at = NOW()
    RETURNING (xmax = 0) as was_inserted
  `, [
    data.volunteerhub_id, data.username, data.email, data.phone,
    data.first_name, data.last_name,
    data.address, data.city, data.state, data.zip,
    data.is_active, data.hours_logged, data.event_count,
    data.joined_at, data.last_activity_at, data.last_login_at,
    data.vh_version, data.user_group_uids,
    data.volunteer_notes, JSON.stringify(data.skills), data.volunteer_availability,
    data.languages, data.pronouns, data.occupation, data.how_heard,
    data.volunteer_motivation, data.emergency_contact_raw, data.can_drive,
    data.date_of_birth, data.volunteer_experience, data.waiver_status,
    JSON.stringify({ ...data.raw_fields, _user_meta: { UserUid: data.volunteerhub_id, Version: data.vh_version } })
  ]);

  return res.rows[0]?.was_inserted;
}

async function stageRecord(client, data, rowHash) {
  await client.query(`
    INSERT INTO trapper.staged_records (
      source_system, source_table, source_row_id, row_hash, payload, is_processed
    ) VALUES ($1, $2, $3, $4, $5, FALSE)
    ON CONFLICT (source_system, source_table, row_hash) DO NOTHING
  `, [
    SOURCE_SYSTEM, SOURCE_TABLE, data.volunteerhub_id, rowHash,
    JSON.stringify(data.raw_fields)
  ]);
}

async function processVolunteerRoles(client, volunteerhubId) {
  // Get matched person_id
  const match = await client.query(`
    SELECT matched_person_id FROM trapper.volunteerhub_volunteers
    WHERE volunteerhub_id = $1 AND matched_person_id IS NOT NULL
  `, [volunteerhubId]);

  if (match.rows.length === 0) return null;
  const personId = match.rows[0].matched_person_id;

  // Sync group memberships
  const syncRes = await client.query(`
    SELECT trapper.sync_volunteer_group_memberships($1, $2) as result
  `, [volunteerhubId, await getVolunteerGroupUids(client, volunteerhubId)]);

  // Process roles from groups
  const roleRes = await client.query(`
    SELECT trapper.process_volunteerhub_group_roles($1, $2) as result
  `, [personId, volunteerhubId]);

  return {
    membership_changes: syncRes.rows[0]?.result,
    roles: roleRes.rows[0]?.result
  };
}

async function getVolunteerGroupUids(client, volunteerhubId) {
  const res = await client.query(`
    SELECT user_group_uids FROM trapper.volunteerhub_volunteers
    WHERE volunteerhub_id = $1
  `, [volunteerhubId]);
  return res.rows[0]?.user_group_uids || [];
}

async function matchVolunteer(client, volunteerhubId) {
  const res = await client.query(`
    SELECT trapper.match_volunteerhub_volunteer($1) as result
  `, [volunteerhubId]);
  return res.rows[0]?.result;
}

async function enrichVolunteer(client, volunteerhubId) {
  // Run enrichment for this specific volunteer
  const res = await client.query(`
    SELECT matched_person_id FROM trapper.volunteerhub_volunteers
    WHERE volunteerhub_id = $1 AND matched_person_id IS NOT NULL
  `, [volunteerhubId]);

  if (res.rows.length === 0) return;

  // Enrich phones and places
  await client.query(`SELECT trapper.enrich_from_volunteerhub(1)`);
}

// ============================================================================
// Main Sync
// ============================================================================

async function main() {
  const options = parseArgs();
  const startTime = Date.now();

  console.log(`\n${colors.bold}VolunteerHub API Sync${colors.reset}`);
  console.log('═'.repeat(50));
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Mode: ${options.fullSync ? 'Full sync' : 'Incremental'}${options.dryRun ? ' (DRY RUN)' : ''}`);
  console.log('');

  if (!process.env.DATABASE_URL) {
    console.error(`${colors.red}Error:${colors.reset} DATABASE_URL not set`);
    process.exit(1);
  }
  if (!API_KEY) {
    console.error(`${colors.red}Error:${colors.reset} VOLUNTEERHUB_API_KEY not set`);
    process.exit(1);
  }

  // Step 1: Discover auth + fetch org data
  console.log(`${colors.cyan}Step 1:${colors.reset} Authenticating and fetching organization data...`);
  let orgData;
  try {
    const orgResponse = await discoverAuth();
    orgData = await orgResponse.json();
    console.log(`  ${colors.green}Auth successful${colors.reset} (method: ${authHeader.split(' ')[0]})`);
  } catch (e) {
    console.error(`${colors.red}Auth failed:${colors.reset} ${e.message}`);
    process.exit(1);
  }

  // Build question mapping from org forms
  const questionMapping = buildQuestionMapping(orgData);
  const mappingCount = Object.keys(questionMapping).length;
  console.log(`  Form question mapping: ${mappingCount} questions found`);

  if (mappingCount === 0) {
    console.log(`  ${colors.yellow}Warning:${colors.reset} No form questions found. Fields will be keyed by UID.`);
  }

  // Step 2: Sync user groups
  console.log(`\n${colors.cyan}Step 2:${colors.reset} Syncing user groups...`);
  const groups = await apiGetPaginated('/api/v1/userGroups');
  console.log(`  Fetched ${groups.length} user groups`);

  let client = null;
  if (!options.dryRun) {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  }

  if (!options.dryRun) {
    // First pass: insert groups without parent FK (to avoid FK violations)
    for (const g of groups) {
      const uid = g.UserGroupUid || g.userGroupUid;
      const name = g.Name || g.name || '';
      await client.query(`
        INSERT INTO trapper.volunteerhub_user_groups (user_group_uid, name, synced_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_group_uid) DO UPDATE SET name = $2, synced_at = NOW()
      `, [uid, name]);
    }

    // Second pass: update with parent + description
    const groupStats = await upsertUserGroups(client, groups, options.verbose);
    console.log(`  ${colors.green}Groups:${colors.reset} ${groupStats.inserted} new, ${groupStats.updated} updated`);

    // Mark "Approved Volunteers" parent
    const parentUid = await markApprovedParent(client, groups);
    if (parentUid) {
      console.log(`  Approved Volunteers parent: ${parentUid}`);
    } else {
      console.log(`  ${colors.yellow}Warning:${colors.reset} Could not find "Approved Volunteers" parent group`);
    }

    // Seed role mappings
    await seedRoleMappings(client);

    // Report unmapped groups
    const unmapped = await client.query(`
      SELECT name FROM trapper.volunteerhub_user_groups
      WHERE atlas_role IS NULL AND parent_user_group_uid IS NOT NULL
    `);
    if (unmapped.rows.length > 0) {
      console.log(`  ${colors.yellow}Unmapped groups:${colors.reset} ${unmapped.rows.map(r => r.name).join(', ')}`);
    }
  } else {
    for (const g of groups) {
      const name = g.Name || g.name || '';
      const parentUid = g.ParentUserGroupUid || g.parentUserGroupUid;
      console.log(`  ${colors.dim}[DRY] Group: ${name}${parentUid ? ` (under ${parentUid})` : ''}${colors.reset}`);
    }
  }

  if (options.groupsOnly) {
    if (client) await client.end();
    console.log(`\n${colors.bold}Done (groups only)${colors.reset} — ${Date.now() - startTime}ms`);
    process.exit(0);
  }

  // Step 3: Fetch users
  console.log(`\n${colors.cyan}Step 3:${colors.reset} Fetching users...`);

  let earliestDate = '1/1/2000';
  if (!options.fullSync && client) {
    const lastSync = await getLastSyncDate(client);
    if (lastSync) {
      const d = new Date(lastSync);
      d.setDate(d.getDate() - 1); // 1-day overlap for safety
      earliestDate = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
      console.log(`  Incremental since: ${earliestDate} (last sync: ${lastSync})`);
    } else {
      console.log(`  No previous sync found — doing full sync`);
    }
  }

  const users = await apiGetPaginated('/api/v2/users', {
    query: 'LastUpdate',
    earliestLastUpdate: earliestDate
  });
  console.log(`  Fetched ${users.length} users`);

  // Step 4: Process users
  console.log(`\n${colors.cyan}Step 4:${colors.reset} Processing users...`);

  const stats = {
    total: users.length,
    inserted: 0,
    updated: 0,
    matched: 0,
    roles_assigned: 0,
    skipped: 0,
    errors: 0,
    group_joins: 0,
    group_leaves: 0,
    skeletons_promoted: 0,
    skeletons_merged: 0,
  };

  for (let i = 0; i < users.length; i++) {
    const user = users[i];

    try {
      // Decode form answers
      const formAnswers = user.FormAnswers || user.formAnswers || [];
      const fields = decodeFormAnswers(formAnswers, questionMapping);
      const data = extractVolunteerData(fields, user);

      if (options.verbose) {
        const groupCount = data.user_group_uids.length;
        console.log(`  [${i + 1}/${users.length}] ${data.display_name || data.email || data.volunteerhub_id} — ${groupCount} groups`);
      }

      if (options.dryRun) {
        stats.inserted++;
        continue;
      }

      // Upsert volunteer record
      const wasInserted = await upsertVolunteer(client, data);
      if (wasInserted) stats.inserted++;
      else stats.updated++;

      // Stage raw record
      const rowHash = computeRowHash(data);
      await stageRecord(client, data, rowHash);

      // Identity resolution (match to sot_people)
      try {
        await matchVolunteer(client, data.volunteerhub_id);
      } catch (e) {
        if (options.verbose) console.log(`    ${colors.yellow}Match warning:${colors.reset} ${e.message}`);
      }

      // Sync group memberships + assign roles
      const roleResult = await processVolunteerRoles(client, data.volunteerhub_id);
      if (roleResult) {
        stats.matched++;
        const changes = roleResult.membership_changes;
        if (changes) {
          stats.group_joins += (changes.joined || []).length;
          stats.group_leaves += (changes.left || []).length;
        }
        const roles = roleResult.roles;
        if (roles?.roles_assigned) {
          stats.roles_assigned += roles.roles_assigned.length;
        }
      }

      // Enrich (phones + places)
      try {
        await enrichVolunteer(client, data.volunteerhub_id);
      } catch (e) {
        if (options.verbose) console.log(`    ${colors.yellow}Enrich warning:${colors.reset} ${e.message}`);
      }

    } catch (e) {
      stats.errors++;
      console.error(`  ${colors.red}Error processing user ${i + 1}:${colors.reset} ${e.message}`);
      if (options.verbose) console.error(e.stack);
    }

    // Progress indicator every 50 users
    if (!options.verbose && (i + 1) % 50 === 0) {
      console.log(`  Processed ${i + 1}/${users.length}...`);
    }
  }

  // Step 5: Skeleton enrichment (merge/promote skeletons that now have contact info)
  if (client && !options.dryRun) {
    console.log(`\n${colors.cyan}Step 5:${colors.reset} Enriching skeleton people...`);
    try {
      const enrichRes = await client.query(`SELECT trapper.enrich_skeleton_people(200) as result`);
      const e = enrichRes.rows[0]?.result;
      if (e) {
        stats.skeletons_promoted = e.promoted || 0;
        stats.skeletons_merged = e.merged || 0;
        if (e.promoted > 0 || e.merged > 0) {
          console.log(`  ${colors.green}Promoted:${colors.reset} ${e.promoted} (contact info added, now normal quality)`);
          console.log(`  ${colors.green}Merged:${colors.reset} ${e.merged} (matched to existing person)`);
        } else {
          console.log(`  No skeletons ready for enrichment`);
        }
      }
    } catch (e) {
      console.log(`  ${colors.yellow}Skeleton enrichment warning:${colors.reset} ${e.message}`);
    }
  }

  // Step 6: Reconciliation
  if (client && !options.dryRun) {
    console.log(`\n${colors.cyan}Step 6:${colors.reset} Trapper reconciliation (VH vs Airtable)...`);
    try {
      const recon = await client.query(`SELECT trapper.cross_reference_vh_trappers_with_airtable() as result`);
      const r = recon.rows[0]?.result;
      if (r) {
        console.log(`  Matched in both: ${r.matched_both}`);
        console.log(`  Only in VH: ${r.only_in_vh}`);
        console.log(`  Only in Airtable: ${r.only_in_airtable}`);
      }
    } catch (e) {
      console.log(`  ${colors.yellow}Reconciliation skipped:${colors.reset} ${e.message}`);
    }
  }

  // Summary
  if (client) await client.end();

  const elapsed = Date.now() - startTime;
  console.log(`\n${colors.bold}${'═'.repeat(50)}${colors.reset}`);
  console.log(`${colors.bold}VolunteerHub Sync Complete${colors.reset} (${elapsed}ms)`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`  Total users:    ${stats.total}`);
  console.log(`  New:            ${stats.inserted}`);
  console.log(`  Updated:        ${stats.updated}`);
  console.log(`  Matched/linked: ${stats.matched}`);
  console.log(`  Roles assigned: ${stats.roles_assigned}`);
  console.log(`  Group joins:    ${stats.group_joins}`);
  console.log(`  Group leaves:   ${stats.group_leaves}`);
  if (stats.skeletons_promoted || stats.skeletons_merged) {
    console.log(`  Skeletons promoted: ${stats.skeletons_promoted || 0}`);
    console.log(`  Skeletons merged:   ${stats.skeletons_merged || 0}`);
  }
  console.log(`  Errors:         ${stats.errors}`);
  if (options.dryRun) console.log(`\n  ${colors.yellow}DRY RUN — no database changes made${colors.reset}`);
  console.log('');

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(`${colors.red}Fatal:${colors.reset}`, e.message);
  if (process.argv.includes('--verbose')) console.error(e.stack);
  process.exit(1);
});
