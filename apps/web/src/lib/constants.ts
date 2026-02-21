/**
 * Atlas Constants
 *
 * Centralized constants for status enums, soft blacklists, and other shared values.
 * These mirror SQL definitions in sot.soft_blacklist and ops.* tables.
 */

// =============================================================================
// REQUEST STATUS
// =============================================================================

export type RequestStatus =
  | 'new'
  | 'triaged'
  | 'scheduled'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'cancelled';

/**
 * Valid status transitions for requests.
 * Mirrors the request lifecycle in ops.requests.
 */
export const VALID_STATUS_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  new: ['triaged', 'cancelled'],
  triaged: ['scheduled', 'on_hold', 'cancelled'],
  scheduled: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['completed', 'on_hold'],
  on_hold: ['triaged', 'scheduled', 'in_progress', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  new: 'New',
  triaged: 'Triaged',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// =============================================================================
// DATA QUALITY
// =============================================================================

export type DataQuality = 'good' | 'needs_review' | 'garbage';

export const DATA_QUALITY_LABELS: Record<DataQuality, string> = {
  good: 'Verified',
  needs_review: 'Review Needed',
  garbage: 'Invalid',
};

// =============================================================================
// SOURCE SYSTEMS
// =============================================================================

export type SourceSystem =
  | 'clinichq'
  | 'shelterluv'
  | 'volunteerhub'
  | 'airtable'
  | 'web_intake'
  | 'petlink'
  | 'google_maps'
  | 'atlas_ui';

export const SOURCE_SYSTEM_LABELS: Record<SourceSystem, string> = {
  clinichq: 'ClinicHQ',
  shelterluv: 'ShelterLuv',
  volunteerhub: 'VolunteerHub',
  airtable: 'Airtable',
  web_intake: 'Web Intake',
  petlink: 'PetLink',
  google_maps: 'Google Maps',
  atlas_ui: 'Atlas',
};

export const SOURCE_SYSTEM_COLORS: Record<SourceSystem, string> = {
  clinichq: 'blue',
  shelterluv: 'purple',
  volunteerhub: 'teal',
  airtable: 'orange',
  web_intake: 'green',
  petlink: 'gray',
  google_maps: 'red',
  atlas_ui: 'cyan',
};

// =============================================================================
// SOFT BLACKLISTS
// =============================================================================
// These identifiers should NOT create person records.
// Mirrors sot.soft_blacklist from MIG_2009.

/**
 * Soft-blacklisted email addresses.
 * These are organizational/shared emails that should route to clinic_accounts.
 */
export const SOFT_BLACKLIST_EMAILS: string[] = [
  // FFSC organizational emails
  'info@forgottenfelines.com',
  'info@forgottenfelines.org',
  'office@forgottenfelines.com',
  'contact@forgottenfelines.com',

  // FFSC staff booking emails (used when booking on behalf of clients)
  'sandra@forgottenfelines.com',
  'addie@forgottenfelines.com',
  'jami@forgottenfelines.com',
  'neely@forgottenfelines.com',
  'julia@forgottenfelines.com',
  'kate@forgottenfelines.com',
  'pip@forgottenfelines.com',
  'ben@forgottenfelines.com',
  'brian@forgottenfelines.com',
  'jenniferc@forgottenfelines.com',
  'wcbc@forgottenfelines.com',
  'valentina@forgottenfelines.com',
  'bridget@forgottenfelines.com',
  'ethan@forgottenfelines.com',

  // Partner organization emails
  'marinferals@yahoo.com',
  'cats@sonomacounty.org',
  'animalservices@sonomacounty.org',
  'info@petalumaanimalservices.org',
  'intake@sonomahumane.org',
  'info@sonomahumane.org',
  'cats@humanesociety.org',
];

/**
 * Soft-blacklisted phone numbers (10-digit normalized).
 * These are organizational/shared phones.
 */
export const SOFT_BLACKLIST_PHONES: string[] = [
  '7075671373', // FFSC main office
  '7075671374', // FFSC secondary
  '7075767999', // FFSC default placeholder
];

/**
 * Fake email domains used by ClinicHQ system.
 * Emails with these domains should NOT create person records.
 */
export const FAKE_EMAIL_DOMAINS: string[] = [
  'noemail.com',
  'petestablished.com',
  'nomail.com',
  'none.com',
  'noemail.org',
];

// =============================================================================
// TRAPPER TYPES
// =============================================================================

export type TrapperType =
  | 'coordinator'
  | 'head_trapper'
  | 'ffsc_trapper'
  | 'community_trapper';

export const TRAPPER_TYPE_LABELS: Record<TrapperType, string> = {
  coordinator: 'Coordinator',
  head_trapper: 'Head Trapper',
  ffsc_trapper: 'FFSC Trapper',
  community_trapper: 'Community Trapper',
};

/**
 * Is this trapper type officially FFSC-affiliated?
 */
export function isFFSCTrapper(type: TrapperType): boolean {
  return type !== 'community_trapper';
}

// =============================================================================
// VOLUNTEER ROLES
// =============================================================================

export type VolunteerRole =
  | 'trapper'
  | 'foster'
  | 'clinic_volunteer'
  | 'coordinator'
  | 'board_member'
  | 'staff'
  | 'caretaker'
  | 'donor'
  | 'volunteer';

export const VOLUNTEER_ROLE_LABELS: Record<VolunteerRole, string> = {
  trapper: 'Trapper',
  foster: 'Foster',
  clinic_volunteer: 'Clinic Volunteer',
  coordinator: 'Coordinator',
  board_member: 'Board Member',
  staff: 'Staff',
  caretaker: 'Caretaker',
  donor: 'Donor',
  volunteer: 'Volunteer',
};

// =============================================================================
// ALTERED STATUS
// =============================================================================

export type AlteredStatus = 'spayed' | 'neutered' | 'intact' | 'unknown';

export const ALTERED_STATUS_LABELS: Record<AlteredStatus, string> = {
  spayed: 'Spayed',
  neutered: 'Neutered',
  intact: 'Intact',
  unknown: 'Unknown',
};

// =============================================================================
// RELATIONSHIP TYPES
// =============================================================================

export type PersonCatRelationship =
  | 'owner'
  | 'adopter'
  | 'foster'
  | 'caretaker'
  | 'colony_caretaker'
  | 'trapper'
  | 'rescuer';

export type CatPlaceRelationship =
  | 'home'
  | 'residence'
  | 'colony_member'
  | 'treated_at'
  | 'trapped_at'
  | 'found_at';

/**
 * Residential relationship types for cat-place linking.
 * These indicate the cat actually lives at the place.
 */
export const RESIDENTIAL_RELATIONSHIP_TYPES: CatPlaceRelationship[] = [
  'home',
  'residence',
  'colony_member',
];

// =============================================================================
// CONFIDENCE THRESHOLDS
// =============================================================================

/**
 * Minimum confidence for displaying identifiers.
 * PetLink fabricated emails get 0.1-0.2 confidence.
 * See CLAUDE.md INV-19.
 */
export const MIN_CONFIDENCE_DISPLAY = 0.5;

/**
 * Minimum confidence for identity matching.
 */
export const MIN_CONFIDENCE_MATCH = 0.5;
