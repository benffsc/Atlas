/**
 * Cat Determining System (CDS) — Multi-Source Ground Truth Engine
 *
 * 7-phase pipeline that determines which master list entry maps to which
 * ClinicHQ appointment/cat. Each phase narrows the problem for the next.
 *
 * Phase 0: Data Assembly — load all sources
 * Phase 1: SQL Deterministic — existing 4-pass SQL matching
 * Phase 2: Waiver Bridge — triangulate entry ↔ waiver ↔ appointment
 * Phase 3: Weight Disambiguation — within-group weight distance matrix
 * Phase 4: Composite Scoring — existing multi-signal TS matching
 * Phase 5: Constraint Propagation — pure logic (N-1 of N matched → assign Nth)
 * Phase 6: LLM Tiebreaker — gated, never auto-accepted
 * Phase 7: Results Assembly — write audit trail
 */

import { queryRows, queryOne, execute } from "@/lib/db";
import { runClinicDayMatching, clearAutoMatches } from "@/lib/clinic-day-matching";

// ── Types ──────────────────────────────────────────────────────────────

interface CDSEntry {
  entry_id: string;
  line_number: number;
  parsed_owner_name: string | null;
  parsed_cat_name: string | null;
  female_count: number;
  male_count: number;
  weight_lbs: number | null;
  sx_end_time: string | null;
  matched_appointment_id: string | null;
  match_confidence: string | null;
  cds_method: string | null;
}

interface CDSAppointment {
  appointment_id: string;
  client_name: string | null;
  cat_id: string | null;
  cat_name: string | null;
  cat_sex: string | null;
  cat_weight: number | null;
  microchip: string | null;
  cat_color: string | null;
  cat_breed: string | null;
  appointment_date: string;
}

interface CDSWaiver {
  waiver_id: string;
  parsed_last_name: string | null;
  parsed_last4_chip: string | null;
  parsed_date: string | null;
  matched_appointment_id: string | null;
  ocr_clinic_number: number | null;
  ocr_microchip: string | null;
  ocr_status: string | null;
}

interface CDSConfig {
  weight_gap_min: number;
  waiver_bridge_threshold: number;
  llm_enabled: boolean;
  llm_max_calls: number;
  llm_min_confidence: number;
}

interface PhaseResult {
  phase: string;
  matched: number;
  details?: Record<string, unknown>;
}

export interface CDSRunResult {
  run_id: string;
  clinic_date: string;
  total_entries: number;
  matched_before: number;
  matched_after: number;
  manual_preserved: number;
  llm_suggestions: number;
  unmatched_remaining: number;
  has_waivers: boolean;
  has_weights: boolean;
  phases: PhaseResult[];
}

// ── CDS method values ──────────────────────────────────────────────────

const CDS_METHODS = {
  SQL_OWNER_NAME: "sql_owner_name",
  SQL_CAT_NAME: "sql_cat_name",
  SQL_SEX: "sql_sex",
  SQL_CARDINALITY: "sql_cardinality",
  WAIVER_BRIDGE: "waiver_bridge",
  WEIGHT_DISAMBIGUATION: "weight_disambiguation",
  COMPOSITE: "composite",
  CONSTRAINT_PROPAGATION: "constraint_propagation",
  CDS_SUGGESTION: "cds_suggestion",
  MANUAL: "manual",
} as const;

// ── Main entry point ───────────────────────────────────────────────────

export async function runCDS(
  clinicDate: string,
  triggeredBy: "import" | "rematch" | "manual"
): Promise<CDSRunResult> {
  const phases: PhaseResult[] = [];

  // Load CDS config from ops.app_config
  const config = await loadCDSConfig();

  // Create CDS run record
  const run = await queryOne<{ run_id: string }>(
    `INSERT INTO ops.cds_runs (clinic_date, triggered_by, config_snapshot)
     VALUES ($1, $2, $3)
     RETURNING run_id`,
    [clinicDate, triggeredBy, JSON.stringify(config)]
  );
  const runId = run!.run_id;

  try {
    // ── Phase -1: Check for changes since last run ────────────────
    // Query ops.cds_audit_events for data changes since last CDS run.
    // Informational for now — full delta matching is FFS-1235.
    let changesSinceLastRun: { event_count: number; event_types: string[] } | null = null;
    try {
      changesSinceLastRun = await queryOne<{ event_count: number; event_types: string[] }>(
        `SELECT event_count::int, event_types FROM ops.cds_changes_since_last_run($1)`,
        [clinicDate]
      );
    } catch { /* table may not exist yet, non-fatal */ }

    // ── Phase 0: Data Assembly ──────────────────────────────────────

    const [entries, appointments, waivers] = await Promise.all([
      loadEntries(clinicDate),
      loadAppointments(clinicDate),
      loadWaivers(clinicDate),
    ]);

    const totalEntries = entries.length;
    const manualCount = entries.filter(
      (e) => e.match_confidence === "manual"
    ).length;
    const matchedBefore = entries.filter(
      (e) =>
        e.matched_appointment_id != null &&
        e.match_confidence != null &&
        e.match_confidence !== "unmatched"
    ).length;
    const hasWaivers = waivers.length > 0;
    const hasWeights = entries.some((e) => e.weight_lbs != null);

    phases.push({
      phase: "0_assembly",
      matched: 0,
      details: {
        entries: totalEntries,
        appointments: appointments.length,
        waivers: waivers.length,
        manual: manualCount,
        has_weights: hasWeights,
        changes_since_last_run: changesSinceLastRun?.event_count ?? 0,
        change_types: changesSinceLastRun?.event_types ?? [],
      },
    });

    if (totalEntries === 0 || appointments.length === 0) {
      return await finalizeCDSRun(runId, clinicDate, {
        totalEntries,
        matchedBefore,
        matchedAfter: matchedBefore,
        manualPreserved: manualCount,
        llmSuggestions: 0,
        unmatchedRemaining: totalEntries - matchedBefore,
        hasWaivers,
        hasWeights,
        phases,
      });
    }

    // ── Phase 0.25: Waiver OCR CDN Bridge ─────────────────────────────
    // For waivers with OCR-extracted clinic_number and matched appointments,
    // bridge the CDN directly (waiver = irrefutable proof).
    const ocrBridged = await runWaiverOCRBridge(clinicDate, waivers);
    phases.push({
      phase: "0.25_waiver_ocr_bridge",
      matched: ocrBridged,
      details: {
        waivers_with_ocr: waivers.filter((w) => w.ocr_status === "extracted").length,
        waivers_with_cdn: waivers.filter((w) => w.ocr_clinic_number != null).length,
      },
    });

    // ── Phase 0.5: Appointment Dedup ────────────────────────────────
    // Detect duplicate appointments (same chip, same date) created by the
    // ClinicHQ cancel/rebook ingest path (FFS-862). Ghost appointments lack
    // appointment_number; they get merged into the canonical record. Stale
    // clinic_day_number values on the loser are cleared.
    const dedupResult = await dedupeAppointments(clinicDate);
    phases.push({
      phase: "0.5_appointment_dedup",
      matched: dedupResult.merged,
      details: dedupResult.details,
    });

    // ── Phase 1: SQL Deterministic ──────────────────────────────────
    // Clear non-manual matches first (for rematch), then run SQL passes

    if (triggeredBy === "rematch") {
      await clearAutoMatches(clinicDate);
    }

    const sqlPasses = await queryRows<{
      pass: string;
      entries_matched: number;
    }>(`SELECT * FROM ops.apply_smart_master_list_matches($1)`, [clinicDate]);

    const sqlMatched = sqlPasses.reduce(
      (sum, p) => sum + (p.entries_matched || 0),
      0
    );

    // Tag SQL-matched entries with cds_method + run_id
    if (sqlMatched > 0) {
      await tagSQLMatches(clinicDate, runId);
    }

    phases.push({
      phase: "1_sql_deterministic",
      matched: sqlMatched,
      details: Object.fromEntries(
        sqlPasses.map((p) => [p.pass, p.entries_matched || 0])
      ),
    });

    // ── Phase 1.5: Shelter ID Bridge ─────────────────────────────────
    // Master list lines often reference cats by their previous shelter ID
    // (e.g., "SCAS A439019 (updates)"). Look up the cat via
    // sot.cat_identifiers (id_type='previous_shelter_id') and bridge to
    // its appointment for that date.
    const shelterMatched = await runShelterIdBridge(clinicDate, runId);
    phases.push({ phase: "1.5_shelter_id_bridge", matched: shelterMatched });

    // ── Phase 2: Waiver Bridge ──────────────────────────────────────
    const waiverMatched = await runWaiverBridge(
      clinicDate,
      runId,
      waivers,
      appointments,
      config
    );
    phases.push({ phase: "2_waiver_bridge", matched: waiverMatched });

    // ── Phase 3: Weight Disambiguation ──────────────────────────────
    const weightMatched = await runWeightDisambiguation(
      clinicDate,
      runId,
      config
    );
    phases.push({ phase: "3_weight_disambiguation", matched: weightMatched });

    // ── Phase 4: Composite Scoring ──────────────────────────────────
    const compositeResult = await runClinicDayMatching(clinicDate);

    // Tag composite matches with cds_method
    if (compositeResult.newly_matched > 0) {
      await tagCompositeMatches(clinicDate, runId);
    }

    phases.push({
      phase: "4_composite",
      matched: compositeResult.newly_matched,
      details: {
        total_entries: compositeResult.total_entries,
        total_appointments: compositeResult.total_appointments,
        already_matched: compositeResult.already_matched,
        unmatched: compositeResult.unmatched,
        cancelled: compositeResult.cancelled.length,
        cancelled_entries: compositeResult.cancelled.map((c) => ({
          line: c.line_number,
          owner: c.parsed_owner_name,
          number: c.appointment_number,
          reason: c.reason,
        })),
      },
    });

    // ── Phase 5: Constraint Propagation ─────────────────────────────
    const constraintMatched = await runConstraintPropagation(
      clinicDate,
      runId
    );
    phases.push({
      phase: "5_constraint_propagation",
      matched: constraintMatched,
    });

    // ── Phase 6: LLM Tiebreaker ─────────────────────────────────────
    let llmSuggestions = 0;
    if (config.llm_enabled && process.env.ANTHROPIC_API_KEY) {
      llmSuggestions = await runLLMTiebreaker(
        clinicDate,
        runId,
        config
      );
    }
    phases.push({
      phase: "6_llm_tiebreaker",
      matched: llmSuggestions,
      details: {
        enabled: config.llm_enabled,
        api_key_present: !!process.env.ANTHROPIC_API_KEY,
      },
    });

    // ── Phase 7: Results Assembly ───────────────────────────────────

    // Propagate matches (creates cat_id, appointment_id links)
    await queryOne(
      `SELECT * FROM ops.propagate_master_list_matches($1::date)`,
      [clinicDate]
    );

    // Count final state
    const afterStats = await queryOne<{
      matched: number;
      unmatched: number;
      manual: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE match_confidence IS NOT NULL AND match_confidence != 'unmatched')::int AS matched,
         COUNT(*) FILTER (WHERE match_confidence IS NULL OR match_confidence = 'unmatched')::int AS unmatched,
         COUNT(*) FILTER (WHERE match_confidence = 'manual')::int AS manual
       FROM ops.clinic_day_entries e
       JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
       WHERE cd.clinic_date = $1`,
      [clinicDate]
    );

    const matchedAfter = afterStats?.matched ?? 0;
    const unmatchedRemaining = afterStats?.unmatched ?? 0;

    phases.push({
      phase: "7_results",
      matched: 0,
      details: {
        matched_after: matchedAfter,
        unmatched_remaining: unmatchedRemaining,
      },
    });

    return await finalizeCDSRun(runId, clinicDate, {
      totalEntries,
      matchedBefore,
      matchedAfter,
      manualPreserved: manualCount,
      llmSuggestions,
      unmatchedRemaining,
      hasWaivers,
      hasWeights,
      phases,
    });
  } catch (error) {
    // Mark run as failed but don't lose it
    await execute(
      `UPDATE ops.cds_runs SET completed_at = NOW(),
       phase_results = jsonb_set(COALESCE(phase_results, '{}'), '{error}', to_jsonb($2::text))
       WHERE run_id = $1`,
      [runId, error instanceof Error ? error.message : "Unknown error"]
    );
    throw error;
  }
}

// ── Phase 0.5: Appointment Dedup ────────────────────────────────────

interface DedupResult {
  merged: number;
  details: {
    chips_deduped: number;
    losers_with_clinic_day_number: number;
    pairs?: Array<{ chip: string; winner: string; losers: string[] }>;
  };
}

/**
 * Detect and merge duplicate appointments on a clinic date.
 *
 * Duplicates are identified by shared microchip on the same date. The winner
 * is selected by preferring (in order):
 *   1. Has appointment_number (real ClinicHQ booking)
 *   2. Has client_name
 *   3. Most recently created
 *
 * Stale clinic_day_number values on the loser are cleared before the merge,
 * since they were almost certainly assigned to the wrong appointment by a
 * prior matching pass. Any clinic_day_entries that pointed at the loser have
 * their appointment_id rewritten to the winner.
 */
async function dedupeAppointments(clinicDate: string): Promise<DedupResult> {
  // Discover duplicate groups
  const dupGroups = await queryRows<{
    chip: string;
    winner: string;
    losers: string[];
    losers_with_number: number;
  }>(
    `WITH dups AS (
       SELECT
         ci.id_value AS chip,
         array_agg(a.appointment_id ORDER BY
           (a.appointment_number IS NOT NULL) DESC,
           (a.client_name IS NOT NULL) DESC,
           a.appointment_number ASC NULLS LAST,
           a.created_at ASC
         ) AS apt_ids
       FROM ops.appointments a
       JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
       JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
       WHERE a.appointment_date = $1
         AND a.merged_into_appointment_id IS NULL
       GROUP BY ci.id_value
       HAVING COUNT(*) > 1
     )
     SELECT
       d.chip,
       d.apt_ids[1] AS winner,
       d.apt_ids[2:] AS losers,
       (
         SELECT COUNT(*)::int
         FROM ops.appointments a
         WHERE a.appointment_id = ANY(d.apt_ids[2:])
           AND a.clinic_day_number IS NOT NULL
       ) AS losers_with_number
     FROM dups d`,
    [clinicDate]
  );

  if (dupGroups.length === 0) {
    return {
      merged: 0,
      details: { chips_deduped: 0, losers_with_clinic_day_number: 0 },
    };
  }

  let totalMerged = 0;
  let totalWithNumber = 0;
  const pairs: Array<{ chip: string; winner: string; losers: string[] }> = [];

  for (const group of dupGroups) {
    // Re-point any clinic_day_entries that referenced the loser to the winner
    await execute(
      `UPDATE ops.clinic_day_entries
         SET appointment_id = $1
       WHERE appointment_id = ANY($2)`,
      [group.winner, group.losers]
    );
    await execute(
      `UPDATE ops.clinic_day_entries
         SET matched_appointment_id = $1
       WHERE matched_appointment_id = ANY($2)`,
      [group.winner, group.losers]
    );

    // Transfer clinic_day_number from loser → winner.
    // Manual assignments are sacred — we never lose them in a merge.
    // MIG_3048 / MIG_3052:
    //  - Pick the loser's best clinic_day_number (prefer manual over auto).
    //  - Route the write through ops.set_clinic_day_number() so the source
    //    is properly tagged. If the picked value was manually overridden,
    //    we use source='manual' so the winner inherits the protection.
    //    Otherwise source='cds_propagation'.
    await execute(
      `SELECT ops.set_clinic_day_number(
         $1::UUID,
         picked.clinic_day_number,
         CASE WHEN picked.is_manual THEN 'manual'::ops.clinic_day_number_source
              ELSE 'cds_propagation'::ops.clinic_day_number_source
         END,
         NULL
       )
       FROM (
         SELECT l.clinic_day_number,
                ops.is_field_manually_set(l.manually_overridden_fields, 'clinic_day_number') AS is_manual
         FROM ops.appointments l
         WHERE l.appointment_id = ANY($2)
           AND l.clinic_day_number IS NOT NULL
         ORDER BY
           ops.is_field_manually_set(l.manually_overridden_fields, 'clinic_day_number') DESC,
           l.created_at DESC
         LIMIT 1
       ) picked
       WHERE EXISTS (
         SELECT 1 FROM ops.appointments w
         WHERE w.appointment_id = $1
           AND (
             w.clinic_day_number IS NULL
             OR (
               picked.is_manual
               AND NOT ops.is_field_manually_set(w.manually_overridden_fields, 'clinic_day_number')
             )
           )
       )`,
      [group.winner, group.losers]
    );

    // MIG_3048: Transfer manually_overridden_fields from losers → winner.
    // Any field a human marked on a loser must remain protected on the winner.
    await execute(
      `UPDATE ops.appointments AS w
         SET manually_overridden_fields = (
           SELECT ARRAY(
             SELECT DISTINCT unnest(
               w.manually_overridden_fields ||
               COALESCE(
                 (SELECT array_agg(DISTINCT f)
                  FROM ops.appointments l,
                       unnest(l.manually_overridden_fields) f
                  WHERE l.appointment_id = ANY($2)),
                 ARRAY[]::TEXT[]
               )
             )
           )
         )
       WHERE w.appointment_id = $1`,
      [group.winner, group.losers]
    );

    // Soft-merge losers (clear their clinic_day_number after the transfer).
    const merged = await queryOne<{ merged: number }>(
      `WITH updated AS (
         UPDATE ops.appointments
           SET merged_into_appointment_id = $1,
               merged_at = NOW(),
               clinic_day_number = NULL
         WHERE appointment_id = ANY($2)
           AND merged_into_appointment_id IS NULL
         RETURNING 1
       )
       SELECT COUNT(*)::int AS merged FROM updated`,
      [group.winner, group.losers]
    );

    totalMerged += merged?.merged ?? 0;
    totalWithNumber += group.losers_with_number;
    pairs.push({
      chip: group.chip,
      winner: group.winner,
      losers: group.losers,
    });
  }

  return {
    merged: totalMerged,
    details: {
      chips_deduped: dupGroups.length,
      losers_with_clinic_day_number: totalWithNumber,
      pairs,
    },
  };
}

// ── Phase 0.25: Waiver OCR CDN Bridge ──────────────────────────────

/**
 * For waivers with OCR-extracted clinic_number AND matched appointments,
 * bridge the CDN directly. Waiver = irrefutable proof: if the waiver says
 * clinic number Y and matches cat X, then appointment for cat X gets CDN Y.
 *
 * Priority: waiver_ocr(80) > master_list(60) but < manual(100).
 */
async function runWaiverOCRBridge(
  clinicDate: string,
  waivers: CDSWaiver[]
): Promise<number> {
  const ocrWaivers = waivers.filter(
    (w) => w.ocr_status === "extracted" && w.ocr_clinic_number != null && w.matched_appointment_id != null
  );

  if (ocrWaivers.length === 0) return 0;

  let bridged = 0;

  for (const w of ocrWaivers) {
    const result = await queryOne<{ set_clinic_day_number: boolean }>(
      `SELECT ops.set_clinic_day_number(
         $1::UUID,
         $2::INTEGER,
         'waiver_ocr'::ops.clinic_day_number_source,
         NULL
       )`,
      [w.matched_appointment_id, w.ocr_clinic_number]
    );

    if (result?.set_clinic_day_number) {
      bridged++;
    }
  }

  return bridged;
}

// ── Phase 1.5: Shelter ID Bridge ────────────────────────────────────

/**
 * Bridge master list lines that reference a previous shelter ID to existing
 * cats via sot.cat_identifiers (id_type='previous_shelter_id').
 *
 * Pattern recognition (in raw_client_name):
 *   - "SCAS A123456 (updates)" → A123456
 *   - "Marin Humane #M789" → M789
 *   - any "[A-Z]\d{4,8}" token preceded or followed by a shelter keyword
 *
 * Strategy:
 *   1. Extract candidate shelter IDs from unmatched entries
 *   2. Look up cats by previous_shelter_id
 *   3. Find an active appointment for that cat on the clinic date
 *   4. If exactly one match → bind entry to appointment
 */
async function runShelterIdBridge(
  clinicDate: string,
  runId: string
): Promise<number> {
  // Extract entries containing shelter ID patterns
  const candidates = await queryRows<{
    entry_id: string;
    raw_client_name: string;
    extracted_id: string;
  }>(
    `SELECT
       e.entry_id,
       e.raw_client_name,
       (regexp_match(e.raw_client_name, '\\b([A-Z]\\d{4,8})\\b'))[1] AS extracted_id
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
       AND e.matched_appointment_id IS NULL
       AND e.match_confidence IS DISTINCT FROM 'manual'
       AND e.raw_client_name ~ '\\b[A-Z]\\d{4,8}\\b'`,
    [clinicDate]
  );

  if (candidates.length === 0) return 0;

  let matched = 0;

  for (const candidate of candidates) {
    if (!candidate.extracted_id) continue;

    // Find a cat with this previous shelter ID and an active appointment for the date
    const match = await queryOne<{
      appointment_id: string;
      cat_id: string;
    }>(
      `SELECT a.appointment_id, a.cat_id
       FROM sot.cat_identifiers ci
       JOIN ops.appointments a
         ON a.cat_id = ci.cat_id
        AND a.appointment_date = $1
        AND a.merged_into_appointment_id IS NULL
        AND a.clinic_day_number IS NULL
       WHERE ci.id_type = 'previous_shelter_id'
         AND ci.id_value = $2
       LIMIT 2`,
      [clinicDate, candidate.extracted_id]
    );

    if (!match) continue;

    // Bind entry → appointment as a high-confidence match
    await execute(
      `UPDATE ops.clinic_day_entries
       SET matched_appointment_id = $1,
           appointment_id = $1,
           cat_id = $2,
           match_confidence = 'high',
           match_reason = 'shelter_id_bridge',
           matched_at = NOW(),
           cds_run_id = $3,
           cds_method = 'shelter_id_bridge'
       WHERE entry_id = $4`,
      [match.appointment_id, match.cat_id, runId, candidate.entry_id]
    );

    matched++;
  }

  return matched;
}

// ── Phase 2: Waiver Bridge ──────────────────────────────────────────

async function runWaiverBridge(
  clinicDate: string,
  runId: string,
  waivers: CDSWaiver[],
  appointments: CDSAppointment[],
  _config: CDSConfig
): Promise<number> {
  if (waivers.length === 0) return 0;

  // Build microchip last-4 lookup from appointments
  const chipToAppt = new Map<string, CDSAppointment>();
  for (const appt of appointments) {
    if (appt.microchip && appt.microchip.length >= 4) {
      chipToAppt.set(appt.microchip.slice(-4), appt);
    }
  }

  // Load unmatched entries for this date
  const unmatched = await queryRows<{
    entry_id: string;
    parsed_owner_name: string | null;
  }>(
    `SELECT e.entry_id, e.parsed_owner_name
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
       AND (e.match_confidence IS NULL OR e.match_confidence = 'unmatched')`,
    [clinicDate]
  );

  if (unmatched.length === 0) return 0;

  // Already-matched appointment IDs
  const usedApptIds = new Set(
    (
      await queryRows<{ aid: string }>(
        `SELECT e.matched_appointment_id AS aid
         FROM ops.clinic_day_entries e
         JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
         WHERE cd.clinic_date = $1
           AND e.matched_appointment_id IS NOT NULL
           AND e.match_confidence IS NOT NULL
           AND e.match_confidence != 'unmatched'`,
        [clinicDate]
      )
    ).map((r) => r.aid)
  );

  let matched = 0;

  for (const waiver of waivers) {
    if (!waiver.parsed_last4_chip || !waiver.parsed_last_name) continue;

    // Find appointment by chip4
    const appt = chipToAppt.get(waiver.parsed_last4_chip);
    if (!appt || usedApptIds.has(appt.appointment_id)) continue;

    // Find unmatched entry whose owner name fuzzy-matches waiver last name
    const waiverLast = waiver.parsed_last_name.toLowerCase();
    const matchingEntry = unmatched.find((e) => {
      if (!e.parsed_owner_name) return false;
      const ownerLower = e.parsed_owner_name.toLowerCase();
      return ownerLower.includes(waiverLast) || waiverLast.includes(ownerLower.split(" ").pop() || "");
    });

    if (!matchingEntry) continue;

    // Three-source triangulation: entry ↔ waiver ↔ appointment
    await execute(
      `UPDATE ops.clinic_day_entries
       SET matched_appointment_id = $2,
           match_confidence = 'high',
           match_reason = 'waiver_bridge',
           match_score = 0.95,
           match_signals = $3,
           matched_at = NOW(),
           waiver_scan_id = $4,
           cds_run_id = $5,
           cds_method = $6
       WHERE entry_id = $1
         AND (matched_appointment_id IS NULL OR match_confidence = 'unmatched')`,
      [
        matchingEntry.entry_id,
        appt.appointment_id,
        JSON.stringify({
          waiver_last_name: waiverLast,
          chip4: waiver.parsed_last4_chip,
          owner_name: matchingEntry.parsed_owner_name,
        }),
        waiver.waiver_id,
        runId,
        CDS_METHODS.WAIVER_BRIDGE,
      ]
    );

    usedApptIds.add(appt.appointment_id);
    // Remove from unmatched pool
    const idx = unmatched.findIndex((e) => e.entry_id === matchingEntry.entry_id);
    if (idx >= 0) unmatched.splice(idx, 1);
    matched++;
  }

  return matched;
}

// ── Phase 3: Weight Disambiguation ──────────────────────────────────

async function runWeightDisambiguation(
  clinicDate: string,
  runId: string,
  config: CDSConfig
): Promise<number> {
  // Load unmatched entries with weight, grouped by owner
  const unmatchedEntries = await queryRows<{
    entry_id: string;
    parsed_owner_name: string | null;
    weight_lbs: number | null;
    female_count: number;
    male_count: number;
  }>(
    `SELECT e.entry_id, e.parsed_owner_name, e.weight_lbs,
            COALESCE(e.female_count, 0) AS female_count,
            COALESCE(e.male_count, 0) AS male_count
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
       AND (e.match_confidence IS NULL OR e.match_confidence = 'unmatched')
       AND e.weight_lbs IS NOT NULL
     ORDER BY e.line_number`,
    [clinicDate]
  );

  if (unmatchedEntries.length === 0) return 0;

  // Load available (unmatched) appointments with cat weight
  const availableAppts = await queryRows<{
    appointment_id: string;
    client_name: string | null;
    cat_weight: number | null;
    cat_sex: string | null;
  }>(
    `SELECT a.appointment_id, a.client_name,
            cv.weight_lbs AS cat_weight, c.sex AS cat_sex
     FROM ops.appointments a
     LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
     LEFT JOIN LATERAL (
       SELECT weight_lbs FROM ops.cat_vitals
       WHERE cat_id = a.cat_id ORDER BY recorded_at DESC LIMIT 1
     ) cv ON true
     WHERE a.appointment_date = $1
       AND a.merged_into_appointment_id IS NULL
       AND cv.weight_lbs IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM ops.clinic_day_entries e2
         JOIN ops.clinic_days cd2 ON cd2.clinic_day_id = e2.clinic_day_id
         WHERE cd2.clinic_date = $1
           AND e2.matched_appointment_id = a.appointment_id
           AND e2.match_confidence IS NOT NULL
           AND e2.match_confidence != 'unmatched'
       )`,
    [clinicDate]
  );

  if (availableAppts.length === 0) return 0;

  // Group entries by normalized owner name
  const entryGroups = new Map<string, typeof unmatchedEntries>();
  for (const entry of unmatchedEntries) {
    const key = normalizeForGrouping(entry.parsed_owner_name);
    if (!key) continue;
    const group = entryGroups.get(key) || [];
    group.push(entry);
    entryGroups.set(key, group);
  }

  // Group appointments by normalized client name
  const apptGroups = new Map<string, typeof availableAppts>();
  for (const appt of availableAppts) {
    const key = normalizeForGrouping(appt.client_name);
    if (!key) continue;
    const group = apptGroups.get(key) || [];
    group.push(appt);
    apptGroups.set(key, group);
  }

  let totalMatched = 0;

  for (const [ownerKey, groupEntries] of entryGroups) {
    // Find matching appointment group (fuzzy)
    const apptGroup = findBestGroup(ownerKey, apptGroups);
    if (!apptGroup || apptGroup.length === 0) continue;

    // Build weight distance matrix
    const assignments = solveWeightAssignment(
      groupEntries,
      apptGroup,
      config.weight_gap_min
    );

    for (const { entry, appt, gap } of assignments) {
      const confidence = gap >= 2.0 ? "medium" : "low";

      await execute(
        `UPDATE ops.clinic_day_entries
         SET matched_appointment_id = $2,
             match_confidence = $3,
             match_reason = 'weight_disambiguation',
             match_score = $4,
             match_signals = $5,
             matched_at = NOW(),
             cds_run_id = $6,
             cds_method = $7
         WHERE entry_id = $1
           AND (matched_appointment_id IS NULL OR match_confidence = 'unmatched')`,
        [
          entry.entry_id,
          appt.appointment_id,
          confidence,
          confidence === "medium" ? 0.75 : 0.55,
          JSON.stringify({
            entry_weight: entry.weight_lbs,
            cat_weight: appt.cat_weight,
            weight_diff: Math.abs((entry.weight_lbs ?? 0) - (appt.cat_weight ?? 0)),
            gap_to_next: gap,
          }),
          runId,
          CDS_METHODS.WEIGHT_DISAMBIGUATION,
        ]
      );
      totalMatched++;
    }
  }

  return totalMatched;
}

/**
 * Greedy optimal assignment: pair entries to appointments by closest weight.
 * Only assigns if the gap between best and second-best match is sufficient.
 */
function solveWeightAssignment(
  entries: Array<{ entry_id: string; weight_lbs: number | null; female_count: number; male_count: number }>,
  appts: Array<{ appointment_id: string; cat_weight: number | null; cat_sex: string | null }>,
  minGap: number
): Array<{ entry: typeof entries[0]; appt: typeof appts[0]; gap: number }> {
  const results: Array<{ entry: typeof entries[0]; appt: typeof appts[0]; gap: number }> = [];
  const usedAppts = new Set<string>();
  const usedEntries = new Set<string>();

  // Build all pairs with distances
  const pairs: Array<{
    entry: typeof entries[0];
    appt: typeof appts[0];
    dist: number;
  }> = [];

  for (const entry of entries) {
    if (entry.weight_lbs == null) continue;
    for (const appt of appts) {
      if (appt.cat_weight == null) continue;

      // Sex filter: skip if sex clearly mismatches
      if (appt.cat_sex) {
        const isFemale = appt.cat_sex.toLowerCase() === "female" || appt.cat_sex.toLowerCase() === "f";
        const isMale = appt.cat_sex.toLowerCase() === "male" || appt.cat_sex.toLowerCase() === "m";
        if (entry.female_count > 0 && isMale) continue;
        if (entry.male_count > 0 && isFemale) continue;
      }

      pairs.push({
        entry,
        appt,
        dist: Math.abs(entry.weight_lbs - appt.cat_weight),
      });
    }
  }

  // Sort by distance (closest first)
  pairs.sort((a, b) => a.dist - b.dist);

  for (const pair of pairs) {
    if (usedEntries.has(pair.entry.entry_id) || usedAppts.has(pair.appt.appointment_id)) {
      continue;
    }

    // Check gap to second-best for this entry
    const secondBest = pairs.find(
      (p) =>
        p.entry.entry_id === pair.entry.entry_id &&
        p.appt.appointment_id !== pair.appt.appointment_id &&
        !usedAppts.has(p.appt.appointment_id)
    );

    const gap = secondBest ? secondBest.dist - pair.dist : Infinity;

    if (gap >= minGap || !secondBest) {
      results.push({ entry: pair.entry, appt: pair.appt, gap: gap === Infinity ? 99 : gap });
      usedEntries.add(pair.entry.entry_id);
      usedAppts.add(pair.appt.appointment_id);
    }
  }

  return results;
}

// ── Phase 5: Constraint Propagation ─────────────────────────────────

async function runConstraintPropagation(
  clinicDate: string,
  runId: string
): Promise<number> {
  let totalPropagated = 0;
  let changed = true;

  // Iterate until no more propagations possible
  while (changed) {
    changed = false;

    // Load current state: entries grouped by owner, with match status
    const allEntries = await queryRows<{
      entry_id: string;
      parsed_owner_name: string | null;
      female_count: number;
      male_count: number;
      matched_appointment_id: string | null;
      match_confidence: string | null;
    }>(
      `SELECT e.entry_id, e.parsed_owner_name,
              COALESCE(e.female_count, 0) AS female_count,
              COALESCE(e.male_count, 0) AS male_count,
              e.matched_appointment_id, e.match_confidence
       FROM ops.clinic_day_entries e
       JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
       WHERE cd.clinic_date = $1
       ORDER BY e.line_number`,
      [clinicDate]
    );

    // All appointments for this date
    const allAppts = await queryRows<{
      appointment_id: string;
      client_name: string | null;
      cat_sex: string | null;
    }>(
      `SELECT a.appointment_id, a.client_name, c.sex AS cat_sex
       FROM ops.appointments a
       LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
       WHERE a.appointment_date = $1
         AND a.merged_into_appointment_id IS NULL`,
      [clinicDate]
    );

    // Sets of what's already matched
    const matchedApptIds = new Set(
      allEntries
        .filter((e) => e.matched_appointment_id && e.match_confidence !== "unmatched")
        .map((e) => e.matched_appointment_id!)
    );

    // Group entries by normalized owner
    const ownerGroups = new Map<string, typeof allEntries>();
    for (const e of allEntries) {
      const key = normalizeForGrouping(e.parsed_owner_name);
      if (!key) continue;
      const group = ownerGroups.get(key) || [];
      group.push(e);
      ownerGroups.set(key, group);
    }

    // Group appointments by normalized client
    const clientGroups = new Map<string, typeof allAppts>();
    for (const a of allAppts) {
      const key = normalizeForGrouping(a.client_name);
      if (!key) continue;
      const group = clientGroups.get(key) || [];
      group.push(a);
      clientGroups.set(key, group);
    }

    for (const [ownerKey, groupEntries] of ownerGroups) {
      const apptGroup = findBestGroup(ownerKey, clientGroups);
      if (!apptGroup) continue;

      const unmatchedEntries = groupEntries.filter(
        (e) => !e.matched_appointment_id || e.match_confidence === "unmatched"
      );
      const unmatchedAppts = apptGroup.filter(
        (a) => !matchedApptIds.has(a.appointment_id)
      );

      // Rule 1: N-1 of N matched → assign the Nth
      if (unmatchedEntries.length === 1 && unmatchedAppts.length === 1) {
        await assignConstraintMatch(
          unmatchedEntries[0].entry_id,
          unmatchedAppts[0].appointment_id,
          runId,
          "last_in_group"
        );
        matchedApptIds.add(unmatchedAppts[0].appointment_id);
        totalPropagated++;
        changed = true;
        continue;
      }

      // Rule 2: Only one unmatched entry of a given sex + one unmatched appointment of that sex
      if (unmatchedEntries.length > 0 && unmatchedAppts.length > 0) {
        const femaleEntries = unmatchedEntries.filter((e) => e.female_count > 0);
        const maleEntries = unmatchedEntries.filter((e) => e.male_count > 0);
        const femaleAppts = unmatchedAppts.filter(
          (a) => a.cat_sex?.toLowerCase() === "female" || a.cat_sex?.toLowerCase() === "f"
        );
        const maleAppts = unmatchedAppts.filter(
          (a) => a.cat_sex?.toLowerCase() === "male" || a.cat_sex?.toLowerCase() === "m"
        );

        if (femaleEntries.length === 1 && femaleAppts.length === 1) {
          await assignConstraintMatch(
            femaleEntries[0].entry_id,
            femaleAppts[0].appointment_id,
            runId,
            "sole_sex_female"
          );
          matchedApptIds.add(femaleAppts[0].appointment_id);
          totalPropagated++;
          changed = true;
        }

        if (maleEntries.length === 1 && maleAppts.length === 1) {
          await assignConstraintMatch(
            maleEntries[0].entry_id,
            maleAppts[0].appointment_id,
            runId,
            "sole_sex_male"
          );
          matchedApptIds.add(maleAppts[0].appointment_id);
          totalPropagated++;
          changed = true;
        }
      }
    }
  }

  return totalPropagated;
}

async function assignConstraintMatch(
  entryId: string,
  appointmentId: string,
  runId: string,
  reason: string
): Promise<void> {
  await execute(
    `UPDATE ops.clinic_day_entries
     SET matched_appointment_id = $2,
         match_confidence = 'high',
         match_reason = 'constraint_propagation_' || $3,
         match_score = 0.90,
         match_signals = $4,
         matched_at = NOW(),
         cds_run_id = $5,
         cds_method = $6
     WHERE entry_id = $1
       AND (matched_appointment_id IS NULL OR match_confidence = 'unmatched')`,
    [
      entryId,
      appointmentId,
      reason,
      JSON.stringify({ constraint_type: reason }),
      runId,
      CDS_METHODS.CONSTRAINT_PROPAGATION,
    ]
  );
}

// ── Phase 6: LLM Tiebreaker ────────────────────────────────────────

async function runLLMTiebreaker(
  clinicDate: string,
  runId: string,
  config: CDSConfig
): Promise<number> {
  // Load remaining unmatched entries
  const unmatched = await queryRows<{
    entry_id: string;
    line_number: number;
    parsed_owner_name: string | null;
    parsed_cat_name: string | null;
    female_count: number;
    male_count: number;
    weight_lbs: number | null;
  }>(
    `SELECT e.entry_id, e.line_number, e.parsed_owner_name, e.parsed_cat_name,
            COALESCE(e.female_count, 0) AS female_count,
            COALESCE(e.male_count, 0) AS male_count,
            e.weight_lbs
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
       AND (e.match_confidence IS NULL OR e.match_confidence = 'unmatched')`,
    [clinicDate]
  );

  if (unmatched.length === 0) return 0;

  // Load available appointments
  const available = await queryRows<{
    appointment_id: string;
    client_name: string | null;
    cat_name: string | null;
    cat_sex: string | null;
    cat_weight: number | null;
    microchip: string | null;
    cat_color: string | null;
    cat_breed: string | null;
  }>(
    `SELECT a.appointment_id, a.client_name,
            c.name AS cat_name, c.sex AS cat_sex,
            cv.weight_lbs AS cat_weight,
            ci.id_value AS microchip,
            c.color AS cat_color, c.breed AS cat_breed
     FROM ops.appointments a
     LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
     LEFT JOIN LATERAL (
       SELECT weight_lbs FROM ops.cat_vitals
       WHERE cat_id = a.cat_id ORDER BY recorded_at DESC LIMIT 1
     ) cv ON true
     LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = a.cat_id AND ci.id_type = 'microchip'
     WHERE a.appointment_date = $1
       AND a.merged_into_appointment_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM ops.clinic_day_entries e2
         JOIN ops.clinic_days cd2 ON cd2.clinic_day_id = e2.clinic_day_id
         WHERE cd2.clinic_date = $1
           AND e2.matched_appointment_id = a.appointment_id
           AND e2.match_confidence IS NOT NULL
           AND e2.match_confidence != 'unmatched'
       )`,
    [clinicDate]
  );

  if (available.length === 0) return 0;

  // Import Anthropic SDK dynamically to avoid hard dependency
  let Anthropic: typeof import("@anthropic-ai/sdk").default;
  try {
    Anthropic = (await import("@anthropic-ai/sdk")).default;
  } catch {
    return 0; // SDK not available
  }

  const anthropic = new Anthropic();
  let suggestions = 0;
  let callsUsed = 0;

  // Group unmatched entries by owner for batch LLM calls
  const groups = new Map<string, typeof unmatched>();
  for (const entry of unmatched) {
    const key = normalizeForGrouping(entry.parsed_owner_name) || entry.entry_id;
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }

  for (const [, groupEntries] of groups) {
    if (callsUsed >= config.llm_max_calls) break;

    // Find candidate appointments for this group
    const candidates = available.filter((a) => {
      const aKey = normalizeForGrouping(a.client_name);
      const eKey = normalizeForGrouping(groupEntries[0].parsed_owner_name);
      if (!aKey || !eKey) return true; // If no name, include as candidate
      return stringSimilarity(aKey, eKey) > 0.5;
    });

    if (candidates.length < 2) continue; // No ambiguity for LLM to resolve

    const prompt = buildLLMPrompt(groupEntries, candidates);

    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        system: `You are a veterinary clinic data matching assistant. Match master list entries to ClinicHQ appointment records based on all available evidence. Return valid JSON only.`,
        messages: [{ role: "user", content: prompt }],
      });

      const text =
        response.content[0]?.type === "text" ? response.content[0].text?.trim() : null;
      if (!text) continue;

      callsUsed++;

      let parsed: Array<{
        entry_id: string;
        appointment_id: string;
        confidence: number;
        reasoning: string;
      }>;

      try {
        const raw = JSON.parse(text);
        parsed = Array.isArray(raw) ? raw : raw.matches || [];
      } catch {
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) continue;
        parsed = JSON.parse(jsonMatch[0]);
      }

      for (const match of parsed) {
        if (match.confidence < config.llm_min_confidence) continue;

        // Verify entry and appointment are valid
        const validEntry = groupEntries.find((e) => e.entry_id === match.entry_id);
        const validAppt = candidates.find((a) => a.appointment_id === match.appointment_id);
        if (!validEntry || !validAppt) continue;

        await execute(
          `UPDATE ops.clinic_day_entries
           SET matched_appointment_id = $2,
               match_confidence = 'low',
               match_reason = 'cds_suggestion',
               match_score = $3,
               match_signals = $4,
               matched_at = NOW(),
               cds_run_id = $5,
               cds_method = $6,
               cds_llm_reasoning = $7
           WHERE entry_id = $1
             AND (matched_appointment_id IS NULL OR match_confidence = 'unmatched')`,
          [
            match.entry_id,
            match.appointment_id,
            match.confidence,
            JSON.stringify({ llm_confidence: match.confidence }),
            runId,
            CDS_METHODS.CDS_SUGGESTION,
            match.reasoning,
          ]
        );
        suggestions++;
      }
    } catch (error) {
      console.error("[CDS] LLM tiebreaker error:", error);
      // Continue with other groups
    }
  }

  return suggestions;
}

function buildLLMPrompt(
  entries: Array<{
    entry_id: string;
    line_number: number;
    parsed_owner_name: string | null;
    parsed_cat_name: string | null;
    female_count: number;
    male_count: number;
    weight_lbs: number | null;
  }>,
  candidates: Array<{
    appointment_id: string;
    client_name: string | null;
    cat_name: string | null;
    cat_sex: string | null;
    cat_weight: number | null;
    microchip: string | null;
    cat_color: string | null;
    cat_breed: string | null;
  }>
): string {
  const entryLines = entries
    .map(
      (e) =>
        `  - Entry ${e.entry_id} (line #${e.line_number}): owner="${e.parsed_owner_name || "?"}", cat="${e.parsed_cat_name || "Unknown"}", sex=${e.female_count > 0 ? "F" : e.male_count > 0 ? "M" : "?"}, weight=${e.weight_lbs ?? "?"} lbs`
    )
    .join("\n");

  const apptLines = candidates
    .map(
      (a) =>
        `  - Appointment ${a.appointment_id}: client="${a.client_name || "?"}", cat="${a.cat_name || "Unknown"}", sex=${a.cat_sex || "?"}, weight=${a.cat_weight ?? "?"} lbs, chip=...${a.microchip?.slice(-4) ?? "?"}, color=${a.cat_color || "?"}, breed=${a.cat_breed || "?"}`
    )
    .join("\n");

  return `Match these master list entries to ClinicHQ appointments. Same owner may have multiple cats.

MASTER LIST ENTRIES (unmatched):
${entryLines}

CLINICHQ APPOINTMENTS (available):
${apptLines}

Return JSON array:
[{ "entry_id": "...", "appointment_id": "...", "confidence": 0.0-1.0, "reasoning": "..." }]

Rules:
- Each entry maps to exactly one appointment (1:1)
- Use weight, sex, color, breed as disambiguation signals
- Confidence 0.9+ = strong evidence, 0.7-0.9 = reasonable, <0.7 = skip
- If genuinely ambiguous, set confidence < 0.7 to skip`;
}

// ── Tag existing matches with CDS metadata ──────────────────────────

async function tagSQLMatches(
  clinicDate: string,
  runId: string
): Promise<void> {
  // Tag entries matched by SQL passes with appropriate cds_method
  await execute(
    `UPDATE ops.clinic_day_entries e
     SET cds_run_id = $2,
         cds_method = CASE
           WHEN e.match_reason LIKE 'owner_name%' THEN 'sql_owner_name'
           WHEN e.match_reason LIKE 'cat_name%' THEN 'sql_cat_name'
           WHEN e.match_reason LIKE 'sex%' THEN 'sql_sex'
           WHEN e.match_reason LIKE 'cardinality%' THEN 'sql_cardinality'
           ELSE 'sql_owner_name'
         END
     FROM ops.clinic_days cd
     WHERE cd.clinic_day_id = e.clinic_day_id
       AND cd.clinic_date = $1
       AND e.matched_appointment_id IS NOT NULL
       AND e.match_confidence IS NOT NULL
       AND e.match_confidence != 'unmatched'
       AND e.match_confidence != 'manual'
       AND e.cds_run_id IS NULL`,
    [clinicDate, runId]
  );
}

async function tagCompositeMatches(
  clinicDate: string,
  runId: string
): Promise<void> {
  await execute(
    `UPDATE ops.clinic_day_entries e
     SET cds_run_id = $2,
         cds_method = 'composite'
     FROM ops.clinic_days cd
     WHERE cd.clinic_day_id = e.clinic_day_id
       AND cd.clinic_date = $1
       AND e.match_reason LIKE 'composite_%'
       AND e.cds_run_id IS NULL`,
    [clinicDate, runId]
  );
}

// ── Finalize CDS run ────────────────────────────────────────────────

async function finalizeCDSRun(
  runId: string,
  clinicDate: string,
  stats: {
    totalEntries: number;
    matchedBefore: number;
    matchedAfter: number;
    manualPreserved: number;
    llmSuggestions: number;
    unmatchedRemaining: number;
    hasWaivers: boolean;
    hasWeights: boolean;
    phases: PhaseResult[];
  }
): Promise<CDSRunResult> {
  await execute(
    `UPDATE ops.cds_runs
     SET completed_at = NOW(),
         phase_results = $2,
         total_entries = $3,
         matched_before = $4,
         matched_after = $5,
         manual_preserved = $6,
         llm_suggestions = $7,
         unmatched_remaining = $8,
         has_waivers = $9,
         has_weights = $10
     WHERE run_id = $1`,
    [
      runId,
      JSON.stringify(stats.phases),
      stats.totalEntries,
      stats.matchedBefore,
      stats.matchedAfter,
      stats.manualPreserved,
      stats.llmSuggestions,
      stats.unmatchedRemaining,
      stats.hasWaivers,
      stats.hasWeights,
    ]
  );

  return {
    run_id: runId,
    clinic_date: clinicDate,
    total_entries: stats.totalEntries,
    matched_before: stats.matchedBefore,
    matched_after: stats.matchedAfter,
    manual_preserved: stats.manualPreserved,
    llm_suggestions: stats.llmSuggestions,
    unmatched_remaining: stats.unmatchedRemaining,
    has_waivers: stats.hasWaivers,
    has_weights: stats.hasWeights,
    phases: stats.phases,
  };
}

// ── Data loaders ────────────────────────────────────────────────────

async function loadEntries(clinicDate: string): Promise<CDSEntry[]> {
  return queryRows<CDSEntry>(
    `SELECT
       e.entry_id, e.line_number,
       e.parsed_owner_name, e.parsed_cat_name,
       COALESCE(e.female_count, 0) AS female_count,
       COALESCE(e.male_count, 0) AS male_count,
       e.weight_lbs,
       e.sx_end_time::text AS sx_end_time,
       e.matched_appointment_id, e.match_confidence,
       e.cds_method
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
     ORDER BY e.line_number`,
    [clinicDate]
  );
}

async function loadAppointments(clinicDate: string): Promise<CDSAppointment[]> {
  return queryRows<CDSAppointment>(
    `SELECT
       a.appointment_id, a.client_name, a.cat_id,
       c.name AS cat_name, c.sex AS cat_sex,
       cv.weight_lbs AS cat_weight,
       ci.id_value AS microchip,
       c.color AS cat_color, c.breed AS cat_breed,
       a.appointment_date::text AS appointment_date
     FROM ops.appointments a
     LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
     LEFT JOIN LATERAL (
       SELECT weight_lbs FROM ops.cat_vitals
       WHERE cat_id = a.cat_id ORDER BY recorded_at DESC LIMIT 1
     ) cv ON true
     LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = a.cat_id AND ci.id_type = 'microchip'
     WHERE a.appointment_date = $1
       AND a.merged_into_appointment_id IS NULL`,
    [clinicDate]
  );
}

async function loadWaivers(clinicDate: string): Promise<CDSWaiver[]> {
  return queryRows<CDSWaiver>(
    `SELECT
       waiver_id, parsed_last_name, parsed_last4_chip,
       parsed_date::text AS parsed_date,
       matched_appointment_id,
       ocr_clinic_number, ocr_microchip, ocr_status
     FROM ops.waiver_scans
     WHERE parsed_date = $1
       AND (parsed_last4_chip IS NOT NULL OR ocr_microchip IS NOT NULL)`,
    [clinicDate]
  );
}

async function loadCDSConfig(): Promise<CDSConfig> {
  const rows = await queryRows<{ key: string; value: unknown }>(
    `SELECT key, value FROM ops.app_config WHERE key LIKE 'cds.%'`
  );

  const configMap = new Map(rows.map((r) => [r.key, String(r.value)]));

  return {
    weight_gap_min: parseFloat(configMap.get("cds.thresholds.weight_gap_min") ?? "1.0"),
    waiver_bridge_threshold: parseFloat(configMap.get("cds.thresholds.waiver_bridge") ?? "0.90"),
    llm_enabled: configMap.get("cds.llm.enabled") === "true",
    llm_max_calls: parseInt(configMap.get("cds.llm.max_calls_per_day") ?? "5", 10),
    llm_min_confidence: parseFloat(configMap.get("cds.llm.min_confidence") ?? "0.70"),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function normalizeForGrouping(name: string | null): string {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const triA = trigrams(a);
  const triB = trigrams(b);
  let intersection = 0;
  for (const tri of triA) {
    if (triB.has(tri)) intersection++;
  }
  const union = triA.size + triB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const result = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    result.add(padded.substring(i, i + 3));
  }
  return result;
}

function findBestGroup<T>(
  key: string,
  groups: Map<string, T[]>
): T[] | null {
  if (groups.has(key)) return groups.get(key)!;

  let bestKey: string | null = null;
  let bestSim = 0;
  for (const gKey of groups.keys()) {
    const sim = stringSimilarity(key, gKey);
    if (sim > bestSim && sim > 0.6) {
      bestSim = sim;
      bestKey = gKey;
    }
  }
  return bestKey ? groups.get(bestKey)! : null;
}

// ── Review API helpers ──────────────────────────────────────────────

/**
 * Accept or reject a CDS suggestion. Used by the review API route.
 */
export async function reviewCDSSuggestion(
  entryId: string,
  action: "accept" | "reject",
  alternateAppointmentId?: string
): Promise<void> {
  if (action === "accept") {
    // Promote from cds_suggestion to manual
    await execute(
      `UPDATE ops.clinic_day_entries
       SET match_confidence = 'manual',
           cds_method = 'manual',
           match_reason = 'cds_accepted'
       WHERE entry_id = $1
         AND cds_method = 'cds_suggestion'`,
      [entryId]
    );
  } else if (action === "reject" && alternateAppointmentId) {
    // Reject suggestion + assign different appointment
    await execute(
      `UPDATE ops.clinic_day_entries
       SET matched_appointment_id = $2,
           match_confidence = 'manual',
           cds_method = 'manual',
           match_reason = 'cds_rejected_manual_override',
           matched_at = NOW()
       WHERE entry_id = $1`,
      [entryId, alternateAppointmentId]
    );
  } else {
    // Just reject — clear the suggestion
    await execute(
      `UPDATE ops.clinic_day_entries
       SET matched_appointment_id = NULL,
           match_confidence = NULL,
           match_reason = NULL,
           match_score = NULL,
           match_signals = NULL,
           matched_at = NULL,
           cds_method = NULL,
           cds_llm_reasoning = NULL
       WHERE entry_id = $1
         AND cds_method = 'cds_suggestion'`,
      [entryId]
    );
  }
}

/**
 * Get the latest CDS run for a clinic date.
 */
export async function getLatestCDSRun(
  clinicDate: string
): Promise<{
  run_id: string;
  triggered_by: string;
  started_at: string;
  completed_at: string | null;
  phase_results: PhaseResult[];
  total_entries: number;
  matched_before: number;
  matched_after: number;
  manual_preserved: number;
  llm_suggestions: number;
  unmatched_remaining: number;
  has_waivers: boolean;
  has_weights: boolean;
} | null> {
  return queryOne(
    `SELECT run_id, triggered_by,
            started_at::text, completed_at::text,
            phase_results, total_entries,
            matched_before, matched_after,
            manual_preserved, llm_suggestions,
            unmatched_remaining, has_waivers, has_weights
     FROM ops.cds_runs
     WHERE clinic_date = $1
     ORDER BY started_at DESC
     LIMIT 1`,
    [clinicDate]
  );
}
