/**
 * Identity Validation Utilities (DATA_GAP_013)
 *
 * Defense-in-depth validation for identity resolution.
 * These checks mirror the SQL should_be_person() logic to catch issues
 * BEFORE they reach the database.
 *
 * Primary gate is in the database (data_engine_resolve_identity).
 * This JS layer is belt-and-suspenders to prevent sending bad data.
 *
 * Related: MIG_915 (should_be_person), MIG_919 (Data Engine consolidated gate)
 */

/**
 * Check if an email is an organizational email that should not create a person record.
 * Mirrors SQL should_be_person() email checks.
 *
 * @param {string|null|undefined} email - Email to check
 * @returns {boolean} True if this is an organizational email
 */
export function isOrganizationalEmail(email) {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();

  // FFSC domain emails (INV-17)
  if (normalized.endsWith('@forgottenfelines.com') ||
      normalized.endsWith('@forgottenfelines.org')) {
    return true;
  }

  // Generic org prefixes (INV-17)
  const orgPrefixes = ['info@', 'office@', 'contact@', 'admin@', 'help@', 'support@'];
  if (orgPrefixes.some(prefix => normalized.startsWith(prefix))) {
    return true;
  }

  return false;
}

/**
 * Organization keywords for name detection.
 * Mirrors SQL classify_owner_name() / is_organization_name() patterns.
 */
const ORG_KEYWORDS = [
  // Business types
  'school', 'church', 'hospital', 'clinic', 'shelter', 'rescue',
  'corp', 'inc', 'llc', 'company', 'ltd', 'winery', 'vineyard',
  'brewery', 'hotel', 'inn', 'motel', 'ranch', 'farm', 'temple',
  // Housing
  'apartments', 'village', 'manor', 'plaza', 'transit',
  // Organizations
  'ffsc', 'scas', 'humane', 'society', 'foundation',
  // Location indicators
  'properties', 'management', 'services', 'center'
];

/**
 * Address pattern keywords.
 * Names containing these are likely addresses, not people.
 */
const ADDRESS_KEYWORDS = [
  'street', 'st.', 'avenue', 'ave.', 'drive', 'dr.',
  'road', 'rd.', 'lane', 'ln.', 'boulevard', 'blvd.',
  'highway', 'hwy', 'freeway', 'parkway'
];

/**
 * Check if a name looks like an organization or location, not a person.
 * Mirrors SQL classify_owner_name() logic.
 *
 * @param {string|null|undefined} name - Full name to check
 * @returns {boolean} True if this looks like an organization name
 */
export function isOrganizationalName(name) {
  if (!name) return false;
  const normalized = name.toLowerCase().trim();

  // Check organization keywords
  if (ORG_KEYWORDS.some(kw => normalized.includes(kw))) {
    return true;
  }

  // Check address patterns
  if (ADDRESS_KEYWORDS.some(kw => normalized.includes(kw))) {
    return true;
  }

  // All-caps names over 20 chars are often organizations
  if (name === name.toUpperCase() && name.length > 20) {
    return true;
  }

  return false;
}

/**
 * Check if a name is garbage/test data.
 * Mirrors SQL garbage name detection.
 *
 * @param {string|null|undefined} name - Name to check
 * @returns {boolean} True if this is garbage/test data
 */
export function isGarbageName(name) {
  if (!name) return true;
  const normalized = name.toLowerCase().trim();

  // Too short
  if (normalized.length < 2) return true;

  // Test patterns
  if (normalized.startsWith('test') ||
      normalized.includes('xxxxxx') ||
      normalized === 'unknown' ||
      normalized === 'n/a' ||
      normalized === 'na') {
    return true;
  }

  // Single character repeated
  if (/^(.)\1+$/.test(normalized)) return true;

  return false;
}

/**
 * Validate before calling find_or_create_person.
 * Returns validation result with specific reason if invalid.
 *
 * @param {string|null|undefined} email
 * @param {string|null|undefined} phone
 * @param {string|null|undefined} firstName
 * @param {string|null|undefined} lastName
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validatePersonCreation(email, phone, firstName, lastName) {
  const emailNorm = email?.trim()?.toLowerCase() || '';
  const phoneNorm = phone?.replace(/\D/g, '') || '';
  const firstNorm = firstName?.trim() || '';

  // Must have email OR phone
  if (!emailNorm && !phoneNorm) {
    return { valid: false, reason: 'No email or phone provided' };
  }

  // Check org emails
  if (isOrganizationalEmail(emailNorm)) {
    return { valid: false, reason: `Organizational email: ${emailNorm}` };
  }

  // Must have first name
  if (!firstNorm) {
    return { valid: false, reason: 'No first name provided' };
  }

  // Check full name for org/location patterns
  const fullName = `${firstNorm} ${lastName?.trim() || ''}`.trim();
  if (isOrganizationalName(fullName)) {
    return { valid: false, reason: `Organizational name: ${fullName}` };
  }

  // Check for garbage name
  if (isGarbageName(fullName)) {
    return { valid: false, reason: `Garbage/test name: ${fullName}` };
  }

  return { valid: true };
}

/**
 * Log validation failure (for debugging and audit trail).
 *
 * @param {string} source - Where validation was called from (script name)
 * @param {Object} input - Input that failed validation
 * @param {string} reason - Why validation failed
 */
export function logValidationFailure(source, input, reason) {
  console.log(`[identity-validation] SKIPPED in ${source}: ${reason}`);
  console.log(`  Input: email=${input.email || 'null'}, phone=${input.phone || 'null'}, name=${input.firstName} ${input.lastName}`);
}
