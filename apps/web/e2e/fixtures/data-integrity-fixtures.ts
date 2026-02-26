/**
 * Data Integrity Test Fixtures
 *
 * SQL queries and fixture helpers for data integrity E2E tests.
 * These queries can be used to:
 * 1. Find test candidates with specific data patterns
 * 2. Verify data integrity rules in the database
 * 3. Cross-reference source data with UI display
 *
 * Note: These are READ-ONLY queries against real data.
 */

// ============================================================================
// CONFIDENCE FILTERING FIXTURES (INV-19)
// ============================================================================

/**
 * Find people with low-confidence identifiers for testing.
 * Low confidence identifiers (< 0.5) should NOT be displayed in UI.
 */
export const FIND_LOW_CONFIDENCE_IDENTIFIERS = `
  SELECT
    p.person_id,
    p.display_name,
    pi.id_type,
    pi.id_value,
    pi.confidence,
    pi.source_system
  FROM sot.people p
  JOIN sot.person_identifiers pi ON p.person_id = pi.person_id
  WHERE pi.confidence < 0.5
    AND pi.id_type IN ('email', 'phone')
    AND p.merged_into_person_id IS NULL
  ORDER BY pi.confidence ASC
  LIMIT 10;
`;

/**
 * Verify all API-returned identifiers have confidence >= 0.5.
 */
export const VERIFY_HIGH_CONFIDENCE_ONLY = `
  SELECT COUNT(*) as violation_count
  FROM sot.people p
  JOIN sot.person_identifiers pi ON p.person_id = pi.person_id
  WHERE pi.confidence < 0.5
    AND pi.is_active = TRUE
    AND p.merged_into_person_id IS NULL;
`;

// ============================================================================
// MERGE CHAIN FIXTURES (INV-8)
// ============================================================================

/**
 * Find merged people for redirect testing.
 */
export const FIND_MERGED_PEOPLE = `
  SELECT
    p.person_id as merged_id,
    p.display_name as merged_name,
    p.merged_into_person_id as canonical_id,
    c.display_name as canonical_name
  FROM sot.people p
  JOIN sot.people c ON p.merged_into_person_id = c.person_id
  WHERE p.merged_into_person_id IS NOT NULL
  LIMIT 5;
`;

/**
 * Find merged places for redirect testing.
 */
export const FIND_MERGED_PLACES = `
  SELECT
    p.place_id as merged_id,
    p.display_name as merged_name,
    p.merged_into_place_id as canonical_id,
    c.display_name as canonical_name
  FROM sot.places p
  JOIN sot.places c ON p.merged_into_place_id = c.place_id
  WHERE p.merged_into_place_id IS NOT NULL
  LIMIT 5;
`;

/**
 * Find merged cats for redirect testing.
 */
export const FIND_MERGED_CATS = `
  SELECT
    c.cat_id as merged_id,
    c.display_name as merged_name,
    c.merged_into_cat_id as canonical_id,
    cc.display_name as canonical_name
  FROM sot.cats c
  JOIN sot.cats cc ON c.merged_into_cat_id = cc.cat_id
  WHERE c.merged_into_cat_id IS NOT NULL
  LIMIT 5;
`;

// ============================================================================
// CAT-PLACE RELATIONSHIP FIXTURES (INV-26)
// ============================================================================

/**
 * Find cats with ClinicHQ appointments for place matching validation.
 */
export const FIND_CATS_WITH_APPOINTMENTS = `
  SELECT
    c.cat_id,
    c.display_name as cat_name,
    a.appointment_id,
    a.inferred_place_id,
    p.display_name as appointment_place_name,
    cpr.place_id as linked_place_id,
    lp.display_name as linked_place_name,
    cpr.relationship_type
  FROM sot.cats c
  JOIN ops.appointments a ON c.cat_id = a.cat_id
  LEFT JOIN sot.places p ON a.inferred_place_id = p.place_id
  LEFT JOIN sot.cat_place_relationships cpr ON c.cat_id = cpr.cat_id
  LEFT JOIN sot.places lp ON cpr.place_id = lp.place_id
  WHERE a.inferred_place_id IS NOT NULL
    AND c.merged_into_cat_id IS NULL
  ORDER BY a.appointment_date DESC
  LIMIT 20;
`;

/**
 * Check for cat-place pollution (cats with > 5 links of same type).
 */
export const CHECK_CAT_PLACE_POLLUTION = `
  SELECT
    c.cat_id,
    c.display_name,
    cpr.relationship_type,
    COUNT(*) as link_count
  FROM sot.cats c
  JOIN sot.cat_place_relationships cpr ON c.cat_id = cpr.cat_id
  WHERE c.merged_into_cat_id IS NULL
  GROUP BY c.cat_id, c.display_name, cpr.relationship_type
  HAVING COUNT(*) > 5
  ORDER BY COUNT(*) DESC
  LIMIT 10;
`;

/**
 * Verify no cats have links to staff addresses.
 */
export const CHECK_STAFF_ADDRESS_POLLUTION = `
  SELECT
    c.cat_id,
    c.display_name as cat_name,
    cpr.relationship_type,
    p.display_name as place_name,
    s.role
  FROM sot.cats c
  JOIN sot.cat_place_relationships cpr ON c.cat_id = cpr.cat_id
  JOIN sot.places p ON cpr.place_id = p.place_id
  JOIN sot.person_place_relationships ppr ON p.place_id = ppr.place_id
  JOIN ops.staff s ON ppr.person_id = s.person_id
  WHERE c.merged_into_cat_id IS NULL
    AND s.is_active = TRUE
    AND cpr.relationship_type IN ('home', 'residence')
  LIMIT 10;
`;

// ============================================================================
// PERSON CLASSIFICATION FIXTURES (INV-25, INV-43, INV-44)
// ============================================================================

/**
 * Find potential organizations incorrectly classified as people.
 */
export const FIND_ORGS_AS_PEOPLE = `
  SELECT
    p.person_id,
    p.display_name,
    p.first_name,
    p.last_name,
    p.source_system
  FROM sot.people p
  WHERE p.merged_into_person_id IS NULL
    AND p.is_organization = FALSE
    AND (
      p.display_name ~* 'campground|resort|hotel|motel|lodge|winery|vineyard|ranch|farm|church|school|hospital|clinic|shelter|humane society|animal control|county of|city of|world of|surgery|carpets?|market|store|shop|services?|plumbing|electric|roofing|landscaping|construction'
      OR p.first_name IS NULL
    )
  LIMIT 20;
`;

/**
 * Find potential addresses incorrectly classified as people.
 */
export const FIND_ADDRESSES_AS_PEOPLE = `
  SELECT
    p.person_id,
    p.display_name,
    p.source_system
  FROM sot.people p
  WHERE p.merged_into_person_id IS NULL
    AND p.is_organization = FALSE
    AND p.display_name ~* '^\\d+\\s+(north|south|east|west|n|s|e|w)?\\s*[a-z]+(\\s+street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|court|ct|circle|blvd|boulevard)?'
  LIMIT 20;
`;

// ============================================================================
// SOURCE DATA CROSS-REFERENCE FIXTURES
// ============================================================================

/**
 * Find cats with ClinicHQ source data for cross-reference.
 */
export const FIND_CLINICHQ_CATS = `
  SELECT
    c.cat_id,
    c.display_name,
    c.microchip_id,
    c.has_ear_tip,
    c.sex,
    c.source_system,
    c.source_record_id
  FROM sot.cats c
  WHERE c.source_system = 'clinichq'
    AND c.merged_into_cat_id IS NULL
    AND c.microchip_id IS NOT NULL
  ORDER BY c.created_at DESC
  LIMIT 10;
`;

/**
 * Find people with VolunteerHub source data for cross-reference.
 */
export const FIND_VOLUNTEERHUB_PEOPLE = `
  SELECT
    p.person_id,
    p.display_name,
    v.user_groups,
    v.volunteerhub_id,
    v.is_active as volunteer_active
  FROM sot.people p
  JOIN ops.volunteers v ON p.person_id = v.person_id
  WHERE p.merged_into_person_id IS NULL
    AND v.user_groups IS NOT NULL
  ORDER BY v.updated_at DESC
  LIMIT 10;
`;

/**
 * Find requests with Airtable source data for cross-reference.
 */
export const FIND_AIRTABLE_REQUESTS = `
  SELECT
    r.request_id,
    r.request_number,
    r.status,
    r.estimated_cat_count,
    r.source_system,
    r.source_record_id
  FROM ops.requests r
  WHERE r.source_system = 'airtable'
    AND r.merged_into_request_id IS NULL
  ORDER BY r.created_at DESC
  LIMIT 10;
`;

// ============================================================================
// SOFT BLACKLIST FIXTURES
// ============================================================================

/**
 * Get all soft-blacklisted identifiers.
 */
export const GET_SOFT_BLACKLIST = `
  SELECT
    identifier_value,
    identifier_type,
    reason,
    created_at
  FROM sot.data_engine_soft_blacklist
  WHERE is_active = TRUE
  ORDER BY created_at DESC;
`;

/**
 * Verify no soft-blacklisted emails appear as primary identifiers.
 */
export const CHECK_BLACKLIST_VIOLATIONS = `
  SELECT
    p.person_id,
    p.display_name,
    pi.id_value,
    bl.reason
  FROM sot.people p
  JOIN sot.person_identifiers pi ON p.person_id = pi.person_id
  JOIN sot.data_engine_soft_blacklist bl ON LOWER(pi.id_value) = LOWER(bl.identifier_value)
  WHERE p.merged_into_person_id IS NULL
    AND pi.is_active = TRUE
    AND pi.id_type = 'email'
    AND bl.identifier_type = 'email'
  LIMIT 10;
`;

// ============================================================================
// DATA QUALITY FIXTURES
// ============================================================================

/**
 * Find records with garbage data quality (should be excluded from search).
 */
export const FIND_GARBAGE_RECORDS = `
  SELECT
    'person' as entity_type,
    person_id as entity_id,
    display_name,
    data_quality
  FROM sot.people
  WHERE data_quality = 'garbage'
    AND merged_into_person_id IS NULL
  LIMIT 5

  UNION ALL

  SELECT
    'place' as entity_type,
    place_id as entity_id,
    display_name,
    data_quality
  FROM sot.places
  WHERE data_quality = 'garbage'
    AND merged_into_place_id IS NULL
  LIMIT 5;
`;

/**
 * Verify search API excludes garbage data quality.
 */
export const VERIFY_SEARCH_EXCLUDES_GARBAGE = `
  -- This would need to be verified via API, not SQL
  -- The search function should have: WHERE data_quality NOT IN ('garbage', 'needs_review')
  SELECT 1;
`;

// ============================================================================
// HELPER TYPES
// ============================================================================

export interface LowConfidenceIdentifier {
  person_id: string;
  display_name: string;
  id_type: string;
  id_value: string;
  confidence: number;
  source_system: string;
}

export interface MergedEntity {
  merged_id: string;
  merged_name: string;
  canonical_id: string;
  canonical_name: string;
}

export interface CatWithAppointment {
  cat_id: string;
  cat_name: string;
  appointment_id: string;
  inferred_place_id: string;
  appointment_place_name: string;
  linked_place_id: string | null;
  linked_place_name: string | null;
  relationship_type: string | null;
}

export interface PollutedCat {
  cat_id: string;
  display_name: string;
  relationship_type: string;
  link_count: number;
}

export interface OrgAsPerson {
  person_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  source_system: string;
}

export interface BlacklistViolation {
  person_id: string;
  display_name: string;
  id_value: string;
  reason: string;
}
