/**
 * V2 Ingest Pipeline - SOT Resolver
 *
 * Identity resolution layer for routing data to sot.* tables.
 * Implements the identity validation gate to separate:
 * - Real people → sot.people (via identity resolution)
 * - Pseudo-profiles → ops.clinic_accounts (orgs, addresses, site names)
 * - Garbage → quarantine.failed_records
 */

import { queryOne, queryRows } from "./db.js";

// ============================================================================
// Classification Types
// ============================================================================

export type OwnerClassification =
  | "likely_person"    // Route to sot.people via identity resolution
  | "organization"     // Route to ops.clinic_accounts
  | "address"          // Route to ops.clinic_accounts
  | "garbage"          // Route to quarantine
  | "unknown";         // Needs manual review

export interface ClassificationResult {
  type: OwnerClassification;
  shouldBePerson: boolean;
  reason?: string;
}

export interface PersonResolutionResult {
  personId: string | null;
  status: "matched" | "created" | "rejected" | "pseudo_profile";
  classification: OwnerClassification;
  notes?: string;
}

// ============================================================================
// Classification Functions (call SQL functions)
// ============================================================================

/**
 * Classify an owner name as person/org/address/garbage
 * Calls sot.classify_owner_name() SQL function
 */
export async function classifyOwnerName(
  firstName: string | undefined,
  lastName: string | undefined
): Promise<OwnerClassification> {
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim();

  if (!displayName) {
    return "garbage";
  }

  const result = await queryOne<{ classification: OwnerClassification }>(`
    SELECT sot.classify_owner_name($1) as classification
  `, [displayName]);

  return result?.classification || "unknown";
}

/**
 * Check if owner info should create a person record
 * Calls sot.should_be_person() SQL function
 */
export async function shouldBePerson(
  firstName: string | undefined,
  lastName: string | undefined,
  email: string | undefined,
  phone: string | undefined
): Promise<boolean> {
  const result = await queryOne<{ should_create: boolean }>(`
    SELECT sot.should_be_person($1, $2, $3, $4) as should_create
  `, [
    firstName || null,
    lastName || null,
    email || null,
    phone || null,
  ]);

  return result?.should_create || false;
}

/**
 * Combined classification check with reasoning
 */
export async function classifyOwner(
  firstName: string | undefined,
  lastName: string | undefined,
  email: string | undefined,
  phone: string | undefined
): Promise<ClassificationResult> {
  const classification = await classifyOwnerName(firstName, lastName);
  const shouldCreatePerson = await shouldBePerson(firstName, lastName, email, phone);

  let reason: string | undefined;

  if (!shouldCreatePerson) {
    if (!email && !phone) {
      reason = "No contact info (email or phone required)";
    } else if (classification === "organization") {
      reason = "Name classified as organization";
    } else if (classification === "address") {
      reason = "Name classified as address";
    } else if (classification === "garbage") {
      reason = "Name classified as garbage/invalid";
    } else {
      // Check if email is blacklisted
      const isBlacklisted = await isIdentifierBlacklisted("email", email);
      if (isBlacklisted) {
        reason = "Email is soft-blacklisted (organizational)";
      }
    }
  }

  return {
    type: classification,
    shouldBePerson: shouldCreatePerson,
    reason,
  };
}

// ============================================================================
// Soft Blacklist Functions
// ============================================================================

/**
 * Check if an identifier is on the soft blacklist
 */
export async function isIdentifierBlacklisted(
  type: "email" | "phone",
  value: string | undefined
): Promise<boolean> {
  if (!value) return false;

  const result = await queryOne<{ is_blocked: boolean }>(`
    SELECT sot.is_identifier_blacklisted($1, $2) as is_blocked
  `, [type, value]);

  return result?.is_blocked || false;
}

// ============================================================================
// Microchip Validation
// ============================================================================

export interface MicrochipValidation {
  isValid: boolean;
  cleaned: string | null;
  rejectionReason: string | null;
}

/**
 * Validate and clean a microchip number
 * Calls sot.validate_microchip() SQL function
 */
export async function validateMicrochip(
  rawMicrochip: string | undefined
): Promise<MicrochipValidation> {
  if (!rawMicrochip) {
    return { isValid: false, cleaned: null, rejectionReason: "empty_or_null" };
  }

  const result = await queryOne<{
    is_valid: boolean;
    cleaned: string | null;
    rejection_reason: string | null;
  }>(`
    SELECT * FROM sot.validate_microchip($1)
  `, [rawMicrochip]);

  if (!result) {
    return { isValid: false, cleaned: null, rejectionReason: "validation_error" };
  }

  return {
    isValid: result.is_valid,
    cleaned: result.cleaned,
    rejectionReason: result.rejection_reason,
  };
}

// ============================================================================
// Person Identity Resolution
// ============================================================================

/**
 * Normalize phone number for identity matching
 */
export function normalizePhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  // Strip leading 1 if 11 digits
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

/**
 * Normalize email for identity matching
 */
export function normalizeEmail(email: string | undefined): string | null {
  if (!email) return null;
  return email.toLowerCase().trim() || null;
}

/**
 * Resolve person identity - find existing or create new
 * This is the main entry point for person resolution
 */
export async function resolvePersonIdentity(params: {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  sourceSystem: string;
  sourceRecordId?: string;
}): Promise<PersonResolutionResult> {
  // 1. Classify the owner
  const classification = await classifyOwner(
    params.firstName,
    params.lastName,
    params.email,
    params.phone
  );

  // 2. If not a person, return rejection
  if (!classification.shouldBePerson) {
    return {
      personId: null,
      status: "rejected",
      classification: classification.type,
      notes: classification.reason,
    };
  }

  // 3. Normalize identifiers
  const emailNorm = normalizeEmail(params.email);
  const phoneNorm = normalizePhone(params.phone);

  // 4. Try to find existing person by identifier
  if (emailNorm || phoneNorm) {
    const existingPerson = await findPersonByIdentifier(emailNorm, phoneNorm);

    if (existingPerson) {
      return {
        personId: existingPerson.personId,
        status: "matched",
        classification: classification.type,
        notes: `Matched on ${existingPerson.matchedOn}`,
      };
    }
  }

  // 5. Create new person in SOT
  const newPersonId = await createPerson({
    firstName: params.firstName,
    lastName: params.lastName,
    email: emailNorm,
    phone: phoneNorm,
    sourceSystem: params.sourceSystem,
    sourceRecordId: params.sourceRecordId,
  });

  if (!newPersonId) {
    return {
      personId: null,
      status: "rejected",
      classification: classification.type,
      notes: "Failed to create person",
    };
  }

  return {
    personId: newPersonId,
    status: "created",
    classification: classification.type,
  };
}

/**
 * Find existing person by email or phone identifier
 */
async function findPersonByIdentifier(
  email: string | null,
  phone: string | null
): Promise<{ personId: string; matchedOn: string } | null> {
  // Try email first (higher confidence)
  if (email) {
    const byEmail = await queryOne<{ person_id: string }>(`
      SELECT pi.person_id
      FROM sot.person_identifiers pi
      JOIN sot.people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'email'
        AND pi.id_value_norm = $1
        AND pi.confidence >= 0.5
        AND p.merged_into_person_id IS NULL
      ORDER BY pi.confidence DESC
      LIMIT 1
    `, [email]);

    if (byEmail) {
      return { personId: byEmail.person_id, matchedOn: "email" };
    }
  }

  // Try phone
  if (phone) {
    const byPhone = await queryOne<{ person_id: string }>(`
      SELECT pi.person_id
      FROM sot.person_identifiers pi
      JOIN sot.people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'phone'
        AND pi.id_value_norm = $1
        AND pi.confidence >= 0.5
        AND p.merged_into_person_id IS NULL
      ORDER BY pi.confidence DESC
      LIMIT 1
    `, [phone]);

    if (byPhone) {
      return { personId: byPhone.person_id, matchedOn: "phone" };
    }
  }

  return null;
}

/**
 * Create new person in sot.people
 */
async function createPerson(params: {
  firstName: string;
  lastName?: string;
  email: string | null;
  phone: string | null;
  sourceSystem: string;
  sourceRecordId?: string;
}): Promise<string | null> {
  const displayName = [params.firstName, params.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  const result = await queryOne<{ person_id: string }>(`
    INSERT INTO sot.people (
      first_name,
      last_name,
      display_name,
      primary_email,
      primary_phone,
      source_system,
      source_record_id,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    RETURNING person_id
  `, [
    params.firstName,
    params.lastName || null,
    displayName || null,
    params.email,
    params.phone,
    params.sourceSystem,
    params.sourceRecordId || null,
  ]);

  if (!result) return null;

  // Create identifiers
  if (params.email) {
    await queryOne(`
      INSERT INTO sot.person_identifiers (
        person_id, id_type, id_value_raw, id_value_norm, confidence, source_system
      ) VALUES ($1, 'email', $2, $2, 1.0, $3)
      ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING
    `, [result.person_id, params.email, params.sourceSystem]);
  }

  if (params.phone) {
    await queryOne(`
      INSERT INTO sot.person_identifiers (
        person_id, id_type, id_value_raw, id_value_norm, confidence, source_system
      ) VALUES ($1, 'phone', $2, $3, 1.0, $4)
      ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING
    `, [result.person_id, params.phone, params.phone, params.sourceSystem]);
  }

  return result.person_id;
}

// ============================================================================
// Cat Resolution
// ============================================================================

export interface CatResolutionResult {
  catId: string | null;
  status: "matched" | "created" | "rejected";
  matchedOn?: string;
  notes?: string;
}

/**
 * Find or create cat by microchip
 */
export async function resolveCatByMicrochip(params: {
  microchip: string;
  name?: string;
  sex?: string;
  color?: string;
  sourceSystem: string;
  sourceRecordId?: string;
}): Promise<CatResolutionResult> {
  // 1. Validate microchip
  const validation = await validateMicrochip(params.microchip);

  if (!validation.isValid || !validation.cleaned) {
    return {
      catId: null,
      status: "rejected",
      notes: `Invalid microchip: ${validation.rejectionReason}`,
    };
  }

  // 2. Try to find existing cat by microchip
  const existingCat = await queryOne<{ cat_id: string }>(`
    SELECT ci.cat_id
    FROM sot.cat_identifiers ci
    JOIN sot.cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'microchip'
      AND ci.id_value_norm = $1
      AND c.merged_into_cat_id IS NULL
    LIMIT 1
  `, [validation.cleaned]);

  if (existingCat) {
    return {
      catId: existingCat.cat_id,
      status: "matched",
      matchedOn: "microchip",
    };
  }

  // 3. Create new cat
  const newCat = await queryOne<{ cat_id: string }>(`
    INSERT INTO sot.cats (
      name,
      display_name,
      sex,
      color,
      microchip,
      source_system,
      source_record_id,
      created_at,
      updated_at
    ) VALUES ($1, $1, $2, $3, $4, $5, $6, NOW(), NOW())
    RETURNING cat_id
  `, [
    params.name || null,
    params.sex || null,
    params.color || null,
    validation.cleaned,
    params.sourceSystem,
    params.sourceRecordId || null,
  ]);

  if (!newCat) {
    return {
      catId: null,
      status: "rejected",
      notes: "Failed to create cat",
    };
  }

  // 4. Create microchip identifier
  await queryOne(`
    INSERT INTO sot.cat_identifiers (
      cat_id, id_type, id_value_raw, id_value_norm, confidence, source_system
    ) VALUES ($1, 'microchip', $2, $3, 1.0, $4)
    ON CONFLICT (cat_id, id_type, id_value_norm) DO NOTHING
  `, [newCat.cat_id, params.microchip, validation.cleaned, params.sourceSystem]);

  return {
    catId: newCat.cat_id,
    status: "created",
  };
}

// ============================================================================
// Place Resolution
// ============================================================================

export interface PlaceResolutionResult {
  placeId: string | null;
  status: "matched" | "created" | "rejected";
  matchedOn?: string;
  notes?: string;
}

/**
 * Find or create place by address
 */
export async function resolvePlaceByAddress(params: {
  address: string;
  name?: string;
  lat?: number;
  lng?: number;
  sourceSystem: string;
  sourceRecordId?: string;
}): Promise<PlaceResolutionResult> {
  if (!params.address || params.address.trim().length < 5) {
    return {
      placeId: null,
      status: "rejected",
      notes: "Address too short or missing",
    };
  }

  const normalizedAddress = params.address.trim();

  // Try to find existing place by normalized address
  const existingPlace = await queryOne<{ place_id: string }>(`
    SELECT p.place_id
    FROM sot.places p
    LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
    WHERE p.merged_into_place_id IS NULL
      AND (
        p.display_name ILIKE $1
        OR a.formatted_address ILIKE $1
      )
    LIMIT 1
  `, [normalizedAddress]);

  if (existingPlace) {
    return {
      placeId: existingPlace.place_id,
      status: "matched",
      matchedOn: "address",
    };
  }

  // Create new place
  const displayName = params.name || normalizedAddress;

  const newPlace = await queryOne<{ place_id: string }>(`
    INSERT INTO sot.places (
      display_name,
      raw_address,
      latitude,
      longitude,
      source_system,
      source_record_id,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    RETURNING place_id
  `, [
    displayName,
    normalizedAddress,
    params.lat || null,
    params.lng || null,
    params.sourceSystem,
    params.sourceRecordId || null,
  ]);

  if (!newPlace) {
    return {
      placeId: null,
      status: "rejected",
      notes: "Failed to create place",
    };
  }

  return {
    placeId: newPlace.place_id,
    status: "created",
  };
}
