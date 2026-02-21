/**
 * Atlas Guards — Client-Side Validation
 *
 * These functions mirror SQL gates in the database:
 * - shouldBePerson() → sot.should_be_person()
 * - classifyOwnerName() → sot.classify_owner_name()
 * - isPositiveValue() → sot.is_positive_value()
 *
 * Used to provide immediate feedback before submitting to the API.
 * The server-side SQL functions are the authoritative gates.
 *
 * See CLAUDE.md INV-25, INV-29, INV-43, INV-44, INV-45
 */

import {
  SOFT_BLACKLIST_EMAILS,
  SOFT_BLACKLIST_PHONES,
  FAKE_EMAIL_DOMAINS,
} from './constants';

// =============================================================================
// TYPES
// =============================================================================

export type NameClassification =
  | 'likely_person'
  | 'organization'
  | 'site_name'
  | 'address'
  | 'garbage'
  | 'unknown';

export interface PersonValidationResult {
  valid: true;
}

export interface PersonRejectionResult {
  valid: false;
  reason: string;
  classification?: NameClassification;
}

export type ShouldBePersonResult = PersonValidationResult | PersonRejectionResult;

// =============================================================================
// CONSTANTS — Patterns for classification
// =============================================================================

/**
 * Organization patterns (legal suffixes, common org structures)
 */
const ORG_PATTERNS = [
  /\b(inc|llc|corp|corporation|ltd|llp|pllc|dba)\b/i,
  /\b(foundation|organization|association)\b/i,
  /\b(friends\s+of|society\s+for)\b/i,
  /\bfoundation$/i,
  /&\s+(associates|partners|sons|company|co)\b/i,
];

/**
 * Rescue/shelter organization patterns
 */
const RESCUE_PATTERNS = [
  /\b(animal\s+services?|pet\s+rescue|veterinary|humane\s+society)\b/i,
  /\b(rescue|shelter|spca)\b/i,
  /\b(feline|felines|ferals?|forgotten\s+felines)\b/i,
];

/**
 * Government/institution patterns
 */
const GOVT_PATTERNS = [
  /\b(county|city\s+of|department|hospital|district)\b/i,
  /\b(program|project|initiative)\b/i,
];

/**
 * Address patterns
 */
const ADDRESS_PATTERNS = [
  /^\d+\s+\w+\s+(st|street|rd|road|ave|avenue|blvd|dr|drive|ln|lane|ct|court)/i,
  /\b(parking|lot|complex|apartments?)\b/i,
];

/**
 * FFSC trapping site patterns
 */
const SITE_PATTERNS = [
  /\b(ranch|farm|estate|vineyard|winery)\b/i,
  /\bffsc\b/i,
  /\bmhp\b/i, // Mobile Home Park
];

/**
 * Business service keywords (INV-43, MIG_2374)
 */
const BUSINESS_KEYWORDS = [
  // Service industries
  'surgery', 'carpets', 'market', 'store', 'shop', 'service', 'services',
  'plumbing', 'electric', 'electrical', 'roofing', 'landscaping', 'construction',
  'painting', 'cleaning', 'moving', 'storage', 'tire', 'glass', 'repair',
  'heating', 'cooling', 'hvac', 'flooring', 'windows', 'doors', 'fencing',
  'paving', 'masonry', 'concrete', 'drywall', 'insulation', 'siding', 'gutters',
  'pest', 'locksmith', 'towing', 'welding', 'machining', 'printing', 'signs',
  'graphics', 'garden', 'nursery',
  // Auto/mechanical
  'auto', 'automotive', 'mechanic',
  // Agricultural businesses
  'winery', 'vineyard', 'vineyards', 'poultry', 'livestock', 'auction',
  'dairy', 'orchard',
  // Corporate indicators
  'corporation',
];

/**
 * Garbage/placeholder patterns
 */
const GARBAGE_PATTERNS = [
  /^(unknown|n\/a|na|none|test|tbd|tba|owner|client|placeholder|rebooking|\?+|\-+)$/i,
  /^[0-9\s\-\.\(\)]+$/, // Only numbers/punctuation
];

/**
 * Common first names (subset for quick client-side check)
 * Full validation happens server-side with ref.first_names
 */
const COMMON_FIRST_NAMES = new Set([
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph',
  'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony', 'mark',
  'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan',
  'jessica', 'sarah', 'karen', 'nancy', 'lisa', 'betty', 'margaret', 'sandra',
  'ashley', 'dorothy', 'kimberly', 'emily', 'donna', 'michelle', 'carol',
  'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura',
  'cynthia', 'kathleen', 'amy', 'angela', 'shirley', 'anna', 'brenda', 'pamela',
  'emma', 'nicole', 'helen', 'samantha', 'katherine', 'christine', 'debra',
  'rachel', 'carolyn', 'janet', 'catherine', 'maria', 'heather', 'diane',
  'ruth', 'julie', 'olivia', 'joyce', 'virginia', 'victoria', 'kelly', 'lauren',
  'christina', 'joan', 'evelyn', 'judith', 'megan', 'andrea', 'cheryl', 'hannah',
  'jacqueline', 'martha', 'gloria', 'teresa', 'ann', 'sara', 'madison', 'frances',
  'kathryn', 'janice', 'jean', 'abigail', 'alice', 'judy', 'sophia', 'grace',
  'denise', 'amber', 'doris', 'marilyn', 'danielle', 'beverly', 'isabella',
  'theresa', 'diana', 'natalie', 'brittany', 'charlotte', 'marie', 'kayla', 'alexis',
]);

// =============================================================================
// MAIN GUARDS
// =============================================================================

/**
 * Client-side equivalent of SQL should_be_person()
 *
 * Validates whether the provided information should create a person record.
 * Returns rejection reason or null if valid.
 *
 * @example
 * const result = shouldBePerson('John', 'Smith', 'john@example.com', '7075551234');
 * if (!result.valid) {
 *   console.log(result.reason); // "Name appears to be an organization"
 * }
 */
export function shouldBePerson(
  firstName: string | null,
  lastName: string | null,
  email: string | null,
  phone: string | null
): ShouldBePersonResult {
  // Build full name for pattern matching
  const name = `${firstName || ''} ${lastName || ''}`.trim();
  const nameLower = name.toLowerCase();

  // 1. Must have at least email OR phone (INV-29)
  if (!email && !phone) {
    return { valid: false, reason: 'Email or phone required for identity matching' };
  }

  // 2. Check email against soft blacklist
  if (email) {
    const emailLower = email.toLowerCase();

    if (SOFT_BLACKLIST_EMAILS.includes(emailLower)) {
      return {
        valid: false,
        reason: 'This email belongs to an organization and cannot be used for personal contact',
      };
    }

    // Check fake email domains
    const domain = emailLower.split('@')[1];
    if (domain && FAKE_EMAIL_DOMAINS.includes(domain)) {
      return {
        valid: false,
        reason: 'This email domain is not valid for contact information',
      };
    }
  }

  // 3. Check phone against soft blacklist
  if (phone) {
    const normalizedPhone = phone.replace(/\D/g, '');
    // Handle 11-digit (with leading 1) and 10-digit phones
    const phone10 = normalizedPhone.length === 11 && normalizedPhone.startsWith('1')
      ? normalizedPhone.slice(1)
      : normalizedPhone;

    if (SOFT_BLACKLIST_PHONES.includes(phone10)) {
      return {
        valid: false,
        reason: 'This phone number belongs to FFSC and cannot be used for personal contact',
      };
    }
  }

  // 4. Classify the name if provided
  if (name) {
    const classification = classifyOwnerName(name);

    if (classification === 'organization') {
      return {
        valid: false,
        reason: 'Name appears to be an organization or business',
        classification,
      };
    }

    if (classification === 'address') {
      return {
        valid: false,
        reason: 'Name appears to be a street address',
        classification,
      };
    }

    if (classification === 'site_name') {
      return {
        valid: false,
        reason: 'Name appears to be a trapping site (ranch, farm, etc.)',
        classification,
      };
    }

    if (classification === 'garbage') {
      return {
        valid: false,
        reason: 'Name is not valid (placeholder or test data)',
        classification,
      };
    }
  }

  return { valid: true };
}

/**
 * Client-side equivalent of SQL classify_owner_name()
 *
 * Classifies a display name into categories.
 * Returns the most likely classification.
 *
 * @example
 * classifyOwnerName('World Of Carpets') // 'organization'
 * classifyOwnerName('Silveira Ranch') // 'site_name'
 * classifyOwnerName('123 Main St') // 'address'
 * classifyOwnerName('John Smith') // 'likely_person'
 */
export function classifyOwnerName(displayName: string): NameClassification {
  if (!displayName || !displayName.trim()) {
    return 'garbage';
  }

  const name = displayName.trim();
  const nameLower = name.toLowerCase();

  // Extract words (letters only)
  const words = nameLower.replace(/[^a-z ]/g, '').split(' ').filter(Boolean);

  if (words.length === 0) {
    return 'garbage';
  }

  const firstWord = words[0];
  const lastWord = words[words.length - 1];
  const hasCommonFirstName = COMMON_FIRST_NAMES.has(firstWord);

  // 1. "World Of X" pattern (strong business indicator)
  if (/^world\s+of\s/i.test(nameLower)) {
    return 'organization';
  }

  // 2. Check FFSC site patterns first (before business keywords)
  for (const pattern of SITE_PATTERNS) {
    if (pattern.test(name)) {
      // If has common first name, might be a person (e.g., "John Ranch" surname)
      if (!hasCommonFirstName) {
        return 'site_name';
      }
    }
  }

  // 3. Check for business keywords
  const businessScore = getBusinessScore(name);

  // Strong business indicator
  if (businessScore >= 1.5) {
    return 'organization';
  }

  // Business keyword + no valid person name pattern
  if (businessScore >= 0.8 && !hasCommonFirstName) {
    return 'organization';
  }

  // Business keyword + 3+ words (e.g., "John Smith Plumbing")
  if (businessScore >= 0.6 && words.length >= 3) {
    // Don't trigger for site keywords
    if (!SITE_PATTERNS.some(p => p.test(name))) {
      return 'organization';
    }
  }

  // 4. Check organization patterns
  for (const pattern of ORG_PATTERNS) {
    if (pattern.test(name)) {
      return 'organization';
    }
  }

  // 5. "The X" pattern
  if (/^the\s+/i.test(name) && words.length >= 2) {
    return 'organization';
  }

  // 6. Rescue/shelter patterns
  for (const pattern of RESCUE_PATTERNS) {
    if (pattern.test(name)) {
      return 'organization';
    }
  }

  // 7. Government patterns
  for (const pattern of GOVT_PATTERNS) {
    if (pattern.test(name)) {
      return 'organization';
    }
  }

  // 8. Address patterns
  for (const pattern of ADDRESS_PATTERNS) {
    if (pattern.test(name)) {
      return 'address';
    }
  }

  // 9. Garbage patterns
  for (const pattern of GARBAGE_PATTERNS) {
    if (pattern.test(name)) {
      return 'garbage';
    }
  }

  // Single character or too short
  if (name.length < 2) {
    return 'garbage';
  }

  // All uppercase single word > 3 chars (likely abbreviation)
  if (words.length === 1 && name === name.toUpperCase() && name.length > 3) {
    return 'garbage';
  }

  // 10. Person validation
  // Strong: common first name + 2+ words
  if (hasCommonFirstName && words.length >= 2) {
    return 'likely_person';
  }

  // Moderate: at least 2 words with reasonable length
  if (words.length >= 2 && words[0].length >= 2 && lastWord.length >= 2) {
    return 'likely_person';
  }

  // Single capitalized word that might be a name
  if (words.length === 1 && /^[A-Z][a-z]+$/.test(name)) {
    if (COMMON_FIRST_NAMES.has(nameLower)) {
      return 'likely_person';
    }
  }

  return 'unknown';
}

/**
 * Calculate business keyword score for a name.
 * Higher score = more likely to be a business.
 */
function getBusinessScore(name: string): number {
  const nameLower = name.toLowerCase();
  let score = 0;

  for (const keyword of BUSINESS_KEYWORDS) {
    if (nameLower.includes(keyword)) {
      // Exact word match scores higher
      const wordBoundary = new RegExp(`\\b${keyword}\\b`, 'i');
      if (wordBoundary.test(name)) {
        score += 1.0;
      } else {
        score += 0.5;
      }
    }
  }

  return score;
}

// =============================================================================
// UTILITY GUARDS
// =============================================================================

/**
 * Validate microchip format.
 * Standard microchips are 15 digits.
 *
 * @example
 * isValidMicrochip('985141404123456') // true
 * isValidMicrochip('12345') // false
 */
export function isValidMicrochip(chip: string | null | undefined): boolean {
  if (!chip) return false;
  const cleaned = chip.replace(/\D/g, '');
  return cleaned.length === 15 && /^\d{15}$/.test(cleaned);
}

/**
 * Client-side equivalent of SQL is_positive_value()
 *
 * Handles boolean extraction from ClinicHQ fields.
 * Recognizes: Yes, TRUE, Y, Checked, Positive, 1, Left, Right, Bilateral
 *
 * @example
 * isPositiveValue('Yes') // true
 * isPositiveValue('Bilateral') // true (for cryptorchid)
 * isPositiveValue('No') // false
 * isPositiveValue(null) // false
 */
export function isPositiveValue(value: string | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (!value) return false;

  const normalized = String(value).toLowerCase().trim();

  return [
    'yes',
    'true',
    'y',
    'checked',
    'positive',
    '1',
    'left',     // For cryptorchid location
    'right',    // For cryptorchid location
    'bilateral', // For cryptorchid location
  ].includes(normalized);
}

/**
 * Validate UUID format.
 * Used for entity IDs (person_id, place_id, cat_id, etc.)
 */
export function isValidUUID(value: string | null | undefined): boolean {
  if (!value) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Check if an email appears to be fabricated (PetLink pattern).
 * These use street addresses as domain names.
 *
 * @example
 * isFabricatedEmail('gordon@lohrmanln.com') // true (street name domain)
 * isFabricatedEmail('john@gmail.com') // false
 */
export function isFabricatedEmail(email: string | null | undefined): boolean {
  if (!email) return false;

  const domain = email.toLowerCase().split('@')[1];
  if (!domain) return false;

  // Check known fake domains
  if (FAKE_EMAIL_DOMAINS.includes(domain)) {
    return true;
  }

  // Check for street-name patterns in domain
  // PetLink staff fabricates emails like gordon@lohrmanln.com (street address)
  const streetPatterns = [
    /\d+.*\.(com|net|org)$/i, // Numbers in domain
    /(st|rd|ave|ln|dr|ct|way|blvd)\.(com|net|org)$/i, // Street suffix
  ];

  for (const pattern of streetPatterns) {
    if (pattern.test(domain)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a confidence score meets the display threshold.
 * PetLink fabricated emails get 0.1-0.2 confidence.
 * See CLAUDE.md INV-19.
 */
export function meetsConfidenceThreshold(
  confidence: number | null | undefined,
  threshold = 0.5
): boolean {
  if (confidence === null || confidence === undefined) {
    return true; // Default 1.0 if not set
  }
  return confidence >= threshold;
}
