/**
 * V2 Ingest Pipeline - OPS Layer
 *
 * Functions to write operational data to ops.* tables.
 * OPS layer is "usable and cleaned but not too cleaned":
 * - Preserves messy owner data for ClinicHQ lookups
 * - Enables change detection
 * - Links to source.* via source_raw_id
 * - Links to sot.* via resolved_*_id columns
 */

import { queryOne, execute } from "./db.js";

// ============================================================================
// Resolution Status Types
// ============================================================================

export type ResolutionStatus =
  | "pending"        // Not yet processed
  | "auto_linked"    // Automatically linked to sot.people
  | "manual_linked"  // Staff manually linked
  | "pseudo_profile" // Classified as org/site, linked to ops.clinic_accounts
  | "unresolvable";  // Could not resolve (no identifiers, garbage data)

// ============================================================================
// Appointments
// ============================================================================

export interface UpsertAppointmentParams {
  clinichqAppointmentId: string;
  appointmentDate: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  ownerAddress?: string;
  ownerRawPayload?: Record<string, unknown>;
  sourceRawId?: string;
  catId?: string;
}

/**
 * Upsert appointment to ops.appointments
 * Preserves messy owner data for ClinicHQ lookup
 */
export async function upsertAppointment(params: UpsertAppointmentParams): Promise<string> {
  const result = await queryOne<{ appointment_id: string }>(`
    INSERT INTO ops.appointments (
      clinichq_appointment_id,
      appointment_date,
      owner_first_name,
      owner_last_name,
      owner_email,
      owner_phone,
      owner_address,
      owner_raw_payload,
      source_raw_id,
      cat_id,
      resolution_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
    ON CONFLICT (clinichq_appointment_id) DO UPDATE SET
      owner_first_name = COALESCE(EXCLUDED.owner_first_name, ops.appointments.owner_first_name),
      owner_last_name = COALESCE(EXCLUDED.owner_last_name, ops.appointments.owner_last_name),
      owner_email = COALESCE(EXCLUDED.owner_email, ops.appointments.owner_email),
      owner_phone = COALESCE(EXCLUDED.owner_phone, ops.appointments.owner_phone),
      owner_address = COALESCE(EXCLUDED.owner_address, ops.appointments.owner_address),
      owner_raw_payload = COALESCE(EXCLUDED.owner_raw_payload, ops.appointments.owner_raw_payload),
      source_raw_id = COALESCE(EXCLUDED.source_raw_id, ops.appointments.source_raw_id),
      cat_id = COALESCE(EXCLUDED.cat_id, ops.appointments.cat_id),
      updated_at = NOW()
    RETURNING appointment_id
  `, [
    params.clinichqAppointmentId,
    params.appointmentDate,
    params.ownerFirstName || null,
    params.ownerLastName || null,
    params.ownerEmail || null,
    params.ownerPhone || null,
    params.ownerAddress || null,
    params.ownerRawPayload ? JSON.stringify(params.ownerRawPayload) : null,
    params.sourceRawId || null,
    params.catId || null,
  ]);

  if (!result) {
    throw new Error(`Failed to upsert appointment: ${params.clinichqAppointmentId}`);
  }

  return result.appointment_id;
}

/**
 * Update appointment resolution status
 */
export async function updateAppointmentResolution(
  appointmentId: string,
  personId: string | null,
  status: ResolutionStatus,
  notes?: string
): Promise<void> {
  await execute(`
    UPDATE ops.appointments
    SET
      resolved_person_id = $2,
      resolution_status = $3,
      resolution_notes = $4,
      resolved_at = NOW(),
      updated_at = NOW()
    WHERE appointment_id = $1
  `, [appointmentId, personId, status, notes || null]);
}

// ============================================================================
// Clinic Accounts (Pseudo-Profiles)
// ============================================================================

export type ClinicAccountType =
  | "organization"  // Known org (shelter, rescue, vet clinic)
  | "site_name"     // Trapping site name (Silveira Ranch, etc.)
  | "address"       // Address as name (5403 San Antonio Road)
  | "partial_name"  // First name only, no identifiers
  | "unknown";      // Unclassified

export interface UpsertClinicAccountParams {
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  ownerAddress?: string;
  accountType: ClinicAccountType;
  classificationReason?: string;
}

/**
 * Upsert clinic account (pseudo-profile)
 * For non-person owners: orgs, addresses, site names
 */
export async function upsertClinicAccount(params: UpsertClinicAccountParams): Promise<string> {
  const result = await queryOne<{ account_id: string }>(`
    INSERT INTO ops.clinic_accounts (
      owner_first_name,
      owner_last_name,
      owner_email,
      owner_phone,
      owner_address,
      account_type,
      classification_reason,
      first_appointment_date,
      last_appointment_date
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, CURRENT_DATE)
    ON CONFLICT ON CONSTRAINT clinic_accounts_name_email_key DO UPDATE SET
      appointment_count = ops.clinic_accounts.appointment_count + 1,
      last_seen_at = NOW(),
      last_appointment_date = CURRENT_DATE,
      updated_at = NOW()
    RETURNING account_id
  `, [
    params.ownerFirstName || null,
    params.ownerLastName || null,
    params.ownerEmail || null,
    params.ownerPhone || null,
    params.ownerAddress || null,
    params.accountType,
    params.classificationReason || null,
  ]);

  // If conflict handling didn't return a row, find existing
  if (!result) {
    const existing = await queryOne<{ account_id: string }>(`
      SELECT account_id FROM ops.clinic_accounts
      WHERE owner_first_name = $1 AND owner_last_name = $2
        AND (owner_email = $3 OR (owner_email IS NULL AND $3 IS NULL))
      LIMIT 1
    `, [params.ownerFirstName, params.ownerLastName, params.ownerEmail]);

    if (existing) return existing.account_id;
    throw new Error(`Failed to upsert clinic account: ${params.ownerFirstName} ${params.ownerLastName}`);
  }

  return result.account_id;
}

// ============================================================================
// Intake Submissions
// ============================================================================

export interface UpsertIntakeSubmissionParams {
  submissionId: string;
  submitterFirstName?: string;
  submitterLastName?: string;
  submitterEmail?: string;
  submitterPhone?: string;
  address?: string;
  estimatedCatCount?: number;
  description?: string;
  sourceRawId?: string;
}

/**
 * Upsert intake submission to ops.intake_submissions
 */
export async function upsertIntakeSubmission(params: UpsertIntakeSubmissionParams): Promise<string> {
  const result = await queryOne<{ submission_id: string }>(`
    INSERT INTO ops.intake_submissions (
      submission_id,
      submitter_first_name,
      submitter_last_name,
      submitter_email,
      submitter_phone,
      address,
      estimated_cat_count,
      description,
      source_raw_id,
      resolution_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
    ON CONFLICT (submission_id) DO UPDATE SET
      submitter_first_name = COALESCE(EXCLUDED.submitter_first_name, ops.intake_submissions.submitter_first_name),
      submitter_last_name = COALESCE(EXCLUDED.submitter_last_name, ops.intake_submissions.submitter_last_name),
      submitter_email = COALESCE(EXCLUDED.submitter_email, ops.intake_submissions.submitter_email),
      submitter_phone = COALESCE(EXCLUDED.submitter_phone, ops.intake_submissions.submitter_phone),
      address = COALESCE(EXCLUDED.address, ops.intake_submissions.address),
      estimated_cat_count = COALESCE(EXCLUDED.estimated_cat_count, ops.intake_submissions.estimated_cat_count),
      description = COALESCE(EXCLUDED.description, ops.intake_submissions.description),
      source_raw_id = COALESCE(EXCLUDED.source_raw_id, ops.intake_submissions.source_raw_id),
      updated_at = NOW()
    RETURNING submission_id
  `, [
    params.submissionId,
    params.submitterFirstName || null,
    params.submitterLastName || null,
    params.submitterEmail || null,
    params.submitterPhone || null,
    params.address || null,
    params.estimatedCatCount || null,
    params.description || null,
    params.sourceRawId || null,
  ]);

  if (!result) {
    throw new Error(`Failed to upsert intake submission: ${params.submissionId}`);
  }

  return result.submission_id;
}

// ============================================================================
// Requests
// ============================================================================

export interface UpsertRequestParams {
  sourceSystem: string;
  sourceRecordId: string;
  address?: string;
  estimatedCatCount?: number;
  status?: string;
  priority?: string;
  notes?: string;
}

/**
 * Upsert request to ops.requests
 */
export async function upsertRequest(params: UpsertRequestParams): Promise<string> {
  const result = await queryOne<{ request_id: string }>(`
    INSERT INTO ops.requests (
      source_system,
      source_record_id,
      address,
      estimated_cat_count,
      status,
      priority,
      notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (source_system, source_record_id) DO UPDATE SET
      address = COALESCE(EXCLUDED.address, ops.requests.address),
      estimated_cat_count = COALESCE(EXCLUDED.estimated_cat_count, ops.requests.estimated_cat_count),
      status = COALESCE(EXCLUDED.status, ops.requests.status),
      priority = COALESCE(EXCLUDED.priority, ops.requests.priority),
      notes = COALESCE(EXCLUDED.notes, ops.requests.notes),
      updated_at = NOW()
    RETURNING request_id
  `, [
    params.sourceSystem,
    params.sourceRecordId,
    params.address || null,
    params.estimatedCatCount || null,
    params.status || "new",
    params.priority || null,
    params.notes || null,
  ]);

  if (!result) {
    throw new Error(`Failed to upsert request: ${params.sourceSystem}/${params.sourceRecordId}`);
  }

  return result.request_id;
}
