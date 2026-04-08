/**
 * Master List Ingest Pipeline
 *
 * Reusable end-to-end ingest of a parsed master list workbook into
 * ops.clinic_days + ops.clinic_day_entries, followed by a CDS run.
 *
 * Used by:
 *   - apps/web/src/app/api/admin/clinic-days/[date]/import/route.ts (manual UI upload)
 *   - apps/web/src/app/api/cron/sharepoint-master-list-sync/route.ts (FFS-1088 auto-sync)
 *
 * Created: 2026-04-07 for FFS-1088
 */

import * as xlsx from "xlsx";
import { queryOne, queryRows, withTransaction } from "@/lib/db";
import { runCDS } from "@/lib/cds";
import {
  parseMasterList,
  type ParsedEntry,
} from "@/lib/master-list-parser";

// Allowed values for ops.clinic_day_entries.status (per CHECK constraint).
// Master list raw status column carries clinical conditions (Heat, Preg,
// DNC, Relo) that don't fit this workflow enum. Normalize on ingest:
// known values pass through, unknown values fall back to 'completed'
// (since a master list row represents a completed clinic visit).
// The original raw value is preserved in `notes` so no data is lost.
const ALLOWED_STATUSES = new Set([
  "checked_in", "in_surgery", "recovering", "released", "held",
  "completed", "no_show", "cancelled", "partial", "pending",
]);

function normalizeStatus(rawStatus: string | null): { status: string; preservedRaw: string | null } {
  if (!rawStatus || !rawStatus.trim()) {
    return { status: "completed", preservedRaw: null };
  }
  const lower = rawStatus.trim().toLowerCase();
  if (ALLOWED_STATUSES.has(lower)) {
    return { status: lower, preservedRaw: null };
  }
  // Not in the enum — preserve in notes, default to 'completed'
  return { status: "completed", preservedRaw: rawStatus.trim() };
}

function mergeNotes(...parts: (string | null)[]): string | null {
  const filtered = parts.filter((p): p is string => !!p && p.trim().length > 0);
  if (filtered.length === 0) return null;
  return filtered.join(" | ");
}

export interface IngestResult {
  status: "ok" | "skipped_existing" | "no_entries" | "no_date" | "date_mismatch";
  clinic_day_id?: string;
  clinic_date?: string;
  imported?: number;
  trappers_resolved?: number;
  cds_run_id?: string;
  cds_phases?: Array<{ phase: string; matched: number }>;
  matched_after?: number;
  unmatched_remaining?: number;
  message?: string;
  // file-level diagnostics
  parsed_entries?: number;
  extracted_date_from_file?: string | null;
}

export interface IngestOptions {
  /**
   * Date to use for the clinic day. If not provided, falls back to the
   * date extracted from the workbook contents (Row 1).
   */
  dateOverride?: string;
  /**
   * UUID of the staff member triggering the ingest. NULL for cron-driven
   * imports (no staff session).
   */
  enteredBy?: string | null;
  /**
   * Source label for entered_by tracking. Defaults to "master_list".
   * Use "master_list_sharepoint_sync" for cron-driven imports.
   */
  sourceSystem?: string;
  /**
   * If true and clinic_day_entries already exist for this date, return
   * status='skipped_existing' instead of erroring. Default: true (cron-friendly).
   */
  skipIfExists?: boolean;
  /**
   * If true, skip the runCDS() call. Useful for batch backfills where you
   * want to run CDS once at the end. Default: false.
   */
  skipCDS?: boolean;
}

/**
 * Parse + ingest a master list workbook end-to-end.
 *
 * Flow:
 *   1. Parse workbook → entries + extracted date
 *   2. Determine final clinic_date (override > extracted)
 *   3. Get/create ops.clinic_days row
 *   4. Bail if entries already exist (idempotent)
 *   5. INSERT each entry into ops.clinic_day_entries
 *   6. Run CDS (unless skipCDS)
 *   7. Build entity relationships via ops.create_master_list_relationships
 *   8. Return result with stats
 */
export async function ingestMasterListWorkbook(
  workbook: xlsx.WorkBook,
  options: IngestOptions = {}
): Promise<IngestResult> {
  const {
    dateOverride,
    enteredBy = null,
    sourceSystem = "master_list",
    skipIfExists = true,
    skipCDS = false,
  } = options;

  // 1. Parse
  const { entries, extractedDate } = parseMasterList(workbook);

  if (entries.length === 0) {
    return {
      status: "no_entries",
      message: "Parser returned 0 entries",
      parsed_entries: 0,
      extracted_date_from_file: extractedDate,
    };
  }

  // 2. Determine clinic_date
  const clinicDate = dateOverride || extractedDate;
  if (!clinicDate) {
    return {
      status: "no_date",
      message: "No dateOverride provided and could not extract date from workbook",
      parsed_entries: entries.length,
      extracted_date_from_file: extractedDate,
    };
  }

  // Sanity check: if both are provided and they disagree by more than ±1 day,
  // flag it. The Apr 6 / Mar 30 timezone-edge cases are normal and OK.
  if (dateOverride && extractedDate && dateOverride !== extractedDate) {
    console.warn(
      `[ingestMasterListWorkbook] date mismatch: filename=${dateOverride}, content=${extractedDate}. Using ${clinicDate}.`
    );
  }

  // 3. Get or create clinic_day
  let clinicDay = await queryOne<{ clinic_day_id: string }>(
    `SELECT clinic_day_id FROM ops.clinic_days WHERE clinic_date = $1`,
    [clinicDate]
  );

  if (!clinicDay) {
    clinicDay = await queryOne<{ clinic_day_id: string }>(
      `INSERT INTO ops.clinic_days (clinic_date, clinic_type)
       VALUES ($1, ops.get_default_clinic_type($1))
       RETURNING clinic_day_id`,
      [clinicDate]
    );
  }

  if (!clinicDay) {
    throw new Error(`Failed to get or create clinic_day for ${clinicDate}`);
  }

  // 4. Idempotency: skip if entries already exist
  const existingCount = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM ops.clinic_day_entries WHERE clinic_day_id = $1`,
    [clinicDay.clinic_day_id]
  );

  if (existingCount && existingCount.count > 0) {
    if (skipIfExists) {
      return {
        status: "skipped_existing",
        clinic_day_id: clinicDay.clinic_day_id,
        clinic_date: clinicDate,
        imported: 0,
        message: `${existingCount.count} entries already exist for ${clinicDate}`,
        parsed_entries: entries.length,
        extracted_date_from_file: extractedDate,
      };
    }
    throw new Error(
      `${existingCount.count} entries already exist for ${clinicDate}. Delete first or use skipIfExists.`
    );
  }

  // 5. INSERT entries — wrapped in a transaction so a single bad row
  // doesn't leave orphan inserts. lib/db.ts withTransaction handles
  // BEGIN/COMMIT/ROLLBACK on a single pooled client.
  const clinicDayId = clinicDay.clinic_day_id;
  let inserted = 0;
  let trappersResolved = 0;

  await withTransaction(async (tx) => {
    for (const entry of entries) {
      const trapperResult = entry.parsed_trapper_alias
        ? await tx.queryOne<{ person_id: string | null }>(
            `SELECT ops.resolve_trapper_alias($1) as person_id`,
            [entry.parsed_trapper_alias]
          )
        : null;

      const trapperPersonId = trapperResult?.person_id || null;
      if (trapperPersonId) trappersResolved++;

      // Normalize status to fit the CHECK constraint, preserve raw value in notes
      const { status, preservedRaw } = normalizeStatus(entry.status);
      const finalNotes = mergeNotes(
        entry.notes,
        preservedRaw ? `master_list_status=${preservedRaw}` : null
      );

      await tx.query(
        `INSERT INTO ops.clinic_day_entries (
          clinic_day_id, line_number, source_description,
          raw_client_name, parsed_owner_name, parsed_cat_name,
          parsed_trapper_alias, trapper_person_id,
          cat_count, female_count, male_count, was_altered,
          is_walkin, is_already_altered, fee_code,
          test_requested, test_result, notes, status,
          source_system, entered_by,
          is_recheck, recheck_type,
          is_foster, foster_parent_name, is_shelter,
          org_code, shelter_animal_id, org_name,
          is_address, parsed_address, parsed_cat_color,
          contact_phone, alt_contact_name, alt_contact_phone,
          weight_lbs, sx_end_time
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
          $29, $30, $31, $32, $33, $34, $35, $36, $37
        )`,
        [
          clinicDayId, entry.line_number, entry.raw_client_name,
          entry.raw_client_name, entry.parsed_owner_name, entry.parsed_cat_name,
          entry.parsed_trapper_alias, trapperPersonId,
          1, entry.is_female ? 1 : 0, entry.is_male ? 1 : 0, entry.was_altered,
          entry.is_walkin, entry.is_already_altered, entry.fee_code,
          entry.test_requested, entry.test_result, finalNotes,
          status, sourceSystem, enteredBy,
          entry.is_recheck, entry.recheck_type,
          entry.is_foster, entry.foster_parent_name, entry.is_shelter,
          entry.org_code, entry.shelter_animal_id, entry.org_name,
          entry.is_address, entry.parsed_address, entry.parsed_cat_color,
          entry.contact_phone, entry.alt_contact_name, entry.alt_contact_phone,
          entry.weight_lbs, entry.sx_end_time,
        ]
      );
      inserted++;
    }
  });

  // 6. CDS run
  let cdsRunId: string | undefined;
  let cdsPhases: Array<{ phase: string; matched: number }> | undefined;
  let matchedAfter: number | undefined;
  let unmatchedRemaining: number | undefined;

  if (!skipCDS) {
    const cdsResult = await runCDS(clinicDate, "import");
    cdsRunId = cdsResult.run_id;
    cdsPhases = cdsResult.phases.map((p) => ({ phase: p.phase, matched: p.matched }));
    matchedAfter = cdsResult.matched_after;
    unmatchedRemaining = cdsResult.unmatched_remaining;

    // 7. Entity relationships
    await queryRows(`SELECT * FROM ops.create_master_list_relationships($1)`, [clinicDate]);
  }

  return {
    status: "ok",
    clinic_day_id: clinicDay.clinic_day_id,
    clinic_date: clinicDate,
    imported: inserted,
    trappers_resolved: trappersResolved,
    cds_run_id: cdsRunId,
    cds_phases: cdsPhases,
    matched_after: matchedAfter,
    unmatched_remaining: unmatchedRemaining,
    parsed_entries: entries.length,
    extracted_date_from_file: extractedDate,
  };
}

// Re-export ParsedEntry type for callers that want it
export type { ParsedEntry };
