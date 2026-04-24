/**
 * Cat Determining System (CDS) — Multi-Source Ground Truth Engine
 *
 * Validate-before-commit pipeline (FFS-1321): CDNs are proposed as candidates,
 * validated against the ML, and only committed when verified. Each phase
 * narrows the problem for the next.
 *
 * Phase 0:    Data Assembly — load all sources
 * Phase 0.5:  Appointment dedup — merge cancel/rebook ghosts
 * Phase 1:    CDN Candidates — generate, validate, commit CDNs from waivers
 * Phase 2:    Cancelled Entry Detection — notes-based + header + recheck
 * Phase 3:    CDN-First Matching — deterministic match via committed CDNs
 * Phase 4:    SQL Deterministic — owner name, cat name, sex, cardinality
 * Phase 5:    Shelter ID Bridge — previous shelter ID → cat → appointment
 * Phase 6:    Waiver Bridge — triangulate entry ↔ waiver ↔ appointment
 * Phase 7:    Composite Scoring — multi-signal TS matching (foster-aware)
 * Phase 7.5:  Fuzzy Name Rescue — Levenshtein token matching for typos/formatting
 * Phase 8:    Weight Disambiguation — within-group weight distance matrix
 * Phase 9:    Constraint Propagation — N-1 of N matched → assign Nth
 * Phase 10:   LLM Tiebreaker — gated, never auto-accepted
 * Phase 11:   Propagate Matches — write cat_id + appointment_id links
 * Phase 11.5: Waiver Cat Rescue — identify cats on entries without appointments
 * Phase 12:   Classify Unmatched — deterministic + LLM notes classifier
 */

import Anthropic from "@anthropic-ai/sdk";
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

interface CDNCandidate {
  appointment_id: string;
  cdn: number;
  source: "waiver_chip" | "waiver_weight";
  waiver_id: string;
  confidence: number;
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
  CDN_FIRST: "cdn_first",
  WAIVER_BRIDGE: "waiver_bridge",
  WEIGHT_DISAMBIGUATION: "weight_disambiguation",
  COMPOSITE: "composite",
  CONSTRAINT_PROPAGATION: "constraint_propagation",
  FUZZY_NAME_RESCUE: "fuzzy_name_rescue",
  SHELTER_ID_BRIDGE: "shelter_id_bridge",
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

    // ── Clear stale matches before matching phases ─────────────────
    // For "rematch": clear all non-manual matches and re-score from scratch.
    // For "import": only clear entries affected by data changes (delta mode).
    // For "manual": no clear, just score unmatched entries.

    let cleared = 0;
    if (triggeredBy === "rematch") {
      cleared = await clearAutoMatches(clinicDate);
    } else if (triggeredBy === "import" && (changesSinceLastRun?.event_count ?? 0) > 0) {
      cleared = await clearAffectedMatches(clinicDate);
    }

    if (cleared > 0) {
      phases.push({
        phase: "0.75_clear",
        matched: 0,
        details: { cleared, mode: triggeredBy === "rematch" ? "full" : "delta" },
      });
    }

    // ── Phase 1: CDN Candidate System ──────────────────────────────
    // Validate-before-commit: propose CDNs from waivers, check against ML,
    // only commit when verified. Replaces direct CDN writes (old phases 0.1/0.25).
    const { candidates: cdnCandidates, suspiciousCdnsRemoved } = await buildCDNCandidates(clinicDate, waivers);
    const { verified: verifiedCdns, rejected: rejectedCdns } = validateCDNCandidates(
      cdnCandidates, entries, appointments
    );
    const cdnsCommitted = await commitVerifiedCDNs(verifiedCdns, clinicDate);

    // Update waiver records for weight-bridge candidates that were committed
    for (const candidate of verifiedCdns) {
      if (candidate.source === "waiver_weight") {
        try {
          await execute(
            `UPDATE ops.waiver_scans SET
               matched_appointment_id = $1,
               matched_cat_id = (SELECT cat_id FROM ops.appointments WHERE appointment_id = $1),
               match_method = 'ocr_weight_composite_validated',
               match_confidence = $2
             WHERE waiver_id = $3
               AND matched_appointment_id IS NULL`,
            [candidate.appointment_id, candidate.confidence, candidate.waiver_id]
          );
        } catch { /* non-fatal */ }
      }
    }

    // Reload waivers if any were weight-bridged (so Phase 6 sees updated state)
    if (verifiedCdns.some((c) => c.source === "waiver_weight")) {
      waivers.length = 0;
      const refreshed = await loadWaivers(clinicDate);
      waivers.push(...refreshed);
    }

    phases.push({
      phase: "1_cdn_candidates",
      matched: cdnsCommitted,
      details: {
        chip_candidates: cdnCandidates.filter((c) => c.source === "waiver_chip").length,
        weight_candidates: cdnCandidates.filter((c) => c.source === "waiver_weight").length,
        total_candidates: cdnCandidates.length,
        verified: verifiedCdns.length,
        rejected: rejectedCdns.length,
        suspicious_ocr_removed: suspiciousCdnsRemoved,
        committed: cdnsCommitted,
      },
    });

    // ── Phase 2: Cancelled Entry Detection ─────────────────────────
    // Detect cancelled entries before matching so they don't consume
    // appointment slots. Uses notes, headers, and recheck patterns.
    let cancelledDetected = 0;
    try {
      const cd = await queryOne<{ detect_cancelled_entries: number }>(
        `SELECT ops.detect_cancelled_entries($1::date)`,
        [clinicDate]
      );
      cancelledDetected = cd?.detect_cancelled_entries ?? 0;
    } catch { /* function may not exist yet */ }

    // TS pre-pass: catch crossed-out entries and master_list_status annotations
    // that the SQL function may not know about
    const tsCancelled = await queryRows<{ entry_id: string; notes: string }>(
      `SELECT e.entry_id::text, LOWER(COALESCE(e.notes, '')) AS notes
       FROM ops.clinic_day_entries e
       JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
       WHERE cd.clinic_date = $1
         AND e.cancellation_reason IS NULL
         AND (
           e.notes ILIKE '%master_list_status=Cancel%'
         )`,
      [clinicDate]
    );
    for (const entry of tsCancelled) {
      const reason = "surgery_cancelled";
      await execute(
        `UPDATE ops.clinic_day_entries SET cancellation_reason = $2
         WHERE entry_id = $1::UUID AND cancellation_reason IS NULL`,
        [entry.entry_id, reason]
      );
      cancelledDetected++;
    }

    phases.push({
      phase: "2_cancelled_detection",
      matched: 0,
      details: { detected: cancelledDetected },
    });

    // ── Phase 3: CDN-First Matching ────────────────────────────────
    // Match entries to appointments by committed CDN (clinic_day_number).
    // Only fires on CDNs validated by Phase 1 — deterministic and safe.
    let cdnFirstMatched = 0;
    try {
      const cdnResult = await queryOne<{ match_master_list_by_clinic_day_number: number }>(
        `SELECT ops.match_master_list_by_clinic_day_number($1::date)`,
        [clinicDate]
      );
      cdnFirstMatched = cdnResult?.match_master_list_by_clinic_day_number ?? 0;
    } catch { /* function may not exist yet */ }
    if (cdnFirstMatched > 0) {
      await tagMethodMatches(clinicDate, runId, "cdn_first", CDS_METHODS.CDN_FIRST);
    }
    phases.push({ phase: "3_cdn_first", matched: cdnFirstMatched });

    // ── Phase 4: SQL Deterministic ─────────────────────────────────
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
      phase: "4_sql_deterministic",
      matched: sqlMatched,
      details: Object.fromEntries(
        sqlPasses.map((p) => [p.pass, p.entries_matched || 0])
      ),
    });

    // ── Phase 5: Shelter ID Bridge ─────────────────────────────────
    // Master list lines often reference cats by their previous shelter ID
    // (e.g., "SCAS A439019 (updates)"). Look up the cat via
    // sot.cat_identifiers (id_type='previous_shelter_id') and bridge to
    // its appointment for that date.
    const shelterMatched = await runShelterIdBridge(clinicDate, runId);
    phases.push({ phase: "5_shelter_id_bridge", matched: shelterMatched });

    // ── Phase 6: Waiver Bridge ──────────────────────────────────────
    const waiverMatched = await runWaiverBridge(
      clinicDate,
      runId,
      waivers,
      appointments,
      config
    );
    phases.push({ phase: "6_waiver_bridge", matched: waiverMatched });

    // ── Phase 7: Composite Scoring (foster-aware) ────────────────────
    const compositeResult = await runClinicDayMatching(clinicDate);

    // Tag composite matches with cds_method
    if (compositeResult.newly_matched > 0) {
      await tagCompositeMatches(clinicDate, runId);
    }

    phases.push({
      phase: "7_composite",
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

    // ── Phase 7.5: Fuzzy Name Rescue ──────────────────────────────
    // Catches entries that composite scoring missed due to name formatting
    // differences (phone suffixes, typos, trapper aliases). Uses aggressive
    // normalization + Levenshtein token matching instead of trigrams.
    const fuzzyRescued = await runFuzzyNameRescue(clinicDate, runId);
    if (fuzzyRescued > 0) {
      phases.push({
        phase: "7.5_fuzzy_name_rescue",
        matched: fuzzyRescued,
      });
    }

    // ── Phase 8: Weight Disambiguation ─────────────────────────────
    // Moved AFTER composite scoring: weight resolves multi-cat ambiguity
    // that name matching can't handle.
    const weightMatched = await runWeightDisambiguation(
      clinicDate,
      runId,
      config
    );
    phases.push({ phase: "8_weight_disambiguation", matched: weightMatched });

    // ── Phase 9: Constraint Propagation ─────────────────────────────
    const constraintMatched = await runConstraintPropagation(
      clinicDate,
      runId
    );
    phases.push({
      phase: "9_constraint_propagation",
      matched: constraintMatched,
    });

    // ── Phase 10: LLM Tiebreaker ────────────────────────────────────
    let llmSuggestions = 0;
    if (config.llm_enabled && process.env.ANTHROPIC_API_KEY) {
      llmSuggestions = await runLLMTiebreaker(
        clinicDate,
        runId,
        config
      );
    }
    phases.push({
      phase: "10_llm_tiebreaker",
      matched: llmSuggestions,
      details: {
        enabled: config.llm_enabled,
        api_key_present: !!process.env.ANTHROPIC_API_KEY,
      },
    });

    // ── Phase 11: Propagate Matches ──────────────────────────────────

    // Propagate matches (creates cat_id, appointment_id links — NO CDN)
    await queryOne(
      `SELECT * FROM ops.propagate_master_list_matches($1::date)`,
      [clinicDate]
    );

    // Link cancelled entries to their cats (for data cohesion)
    // Cancelled entries don't match appointments but we still want to know
    // which cat was scheduled (e.g., Jadis was cancelled but is a real cat)
    try {
      await queryOne(
        `SELECT ops.link_cancelled_entries_to_cats($1::date)`,
        [clinicDate]
      );
    } catch { /* function may not exist yet */ }

    // ── Phase 11.5: Waiver Cat Rescue ────────────────────────────────
    // For entries with NO appointment match but a waiver exists at their
    // line number that identifies a cat → set cat_id directly.
    // This gives us cat identity for no-booking entries, rechecks,
    // cancellations — enabling photo linkage even without an appointment.
    const waiverCatRescued = await rescueCatsFromWaivers(clinicDate);
    if (waiverCatRescued > 0) {
      phases.push({
        phase: "11.5_waiver_cat_rescue",
        matched: 0,
        details: { cats_identified: waiverCatRescued },
      });
    }

    // ── Phase 12: Classify Unmatched Entries ─────────────────────────
    // Use deterministic rules + LLM to interpret notes and classify
    // WHY entries are unmatched (cancelled, no-show, redirected, etc.)
    let classifiedCount = 0;
    try {
      const classResult = await classifyUnmatchedEntries(clinicDate);
      classifiedCount = classResult.classified;
      if (classifiedCount > 0) {
        phases.push({
          phase: "12_classify_unmatched",
          matched: 0,
          details: {
            classified: classResult.classified,
            llm_calls: classResult.llm_calls,
          },
        });
      }
    } catch { /* non-fatal */ }

    // Count final state (exclude cancelled entries from unmatched count)
    const afterStats = await queryOne<{
      matched: number;
      unmatched: number;
      manual: number;
      cancelled: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE match_confidence IS NOT NULL AND match_confidence != 'unmatched' AND cancellation_reason IS NULL)::int AS matched,
         COUNT(*) FILTER (WHERE (match_confidence IS NULL OR match_confidence = 'unmatched') AND cancellation_reason IS NULL)::int AS unmatched,
         COUNT(*) FILTER (WHERE match_confidence = 'manual')::int AS manual,
         COUNT(*) FILTER (WHERE cancellation_reason IS NOT NULL)::int AS cancelled
       FROM ops.clinic_day_entries e
       JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
       WHERE cd.clinic_date = $1`,
      [clinicDate]
    );

    const matchedAfter = afterStats?.matched ?? 0;
    const unmatchedRemaining = afterStats?.unmatched ?? 0;

    phases.push({
      phase: "11_results",
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

// ── Phase 1: CDN Candidate System ───────────────────────────────────

/**
 * Build CDN candidates from all waiver sources.
 *
 * Source 1 (waiver_chip): Chip-matched waivers with OCR clinic_number.
 *   High confidence — waiver chip → cat → appointment is irrefutable.
 * Source 2 (waiver_weight): Weight bridge dry-run candidates.
 *   Lower confidence — composite scoring on weight/sex/color/name.
 */
interface BuildCDNResult {
  candidates: CDNCandidate[];
  suspiciousCdnsRemoved: number;
}

async function buildCDNCandidates(
  clinicDate: string,
  waivers: CDSWaiver[]
): Promise<BuildCDNResult> {
  const candidates: CDNCandidate[] = [];

  // Source 1: Chip-matched waivers with OCR clinic number
  const ocrWaivers = waivers.filter(
    (w) =>
      w.ocr_status === "extracted" &&
      w.ocr_clinic_number != null &&
      w.matched_appointment_id != null
  );
  for (const w of ocrWaivers) {
    candidates.push({
      appointment_id: w.matched_appointment_id!,
      cdn: w.ocr_clinic_number!,
      source: "waiver_chip",
      waiver_id: w.waiver_id,
      confidence: 0.95,
    });
  }

  // Detect suspicious CDN values: if 3+ waivers from DIFFERENT appointments
  // all claim the same CDN, it's a systematic OCR error (e.g., Haiku reads "50")
  const cdnCounts = new Map<number, Set<string>>();
  for (const c of candidates) {
    const appts = cdnCounts.get(c.cdn) || new Set();
    appts.add(c.appointment_id);
    cdnCounts.set(c.cdn, appts);
  }
  const suspiciousCdns = new Set<number>();
  for (const [cdn, appts] of cdnCounts) {
    if (appts.size >= 3) suspiciousCdns.add(cdn);
  }
  // Remove suspicious candidates (keeping them would all be rejected by
  // bidirectional check anyway, but this is clearer)
  let suspiciousRemoved = 0;
  if (suspiciousCdns.size > 0) {
    const before = candidates.length;
    const kept = candidates.filter((c) => !suspiciousCdns.has(c.cdn));
    candidates.length = 0;
    candidates.push(...kept);
    suspiciousRemoved = before - candidates.length;
    if (suspiciousRemoved > 0) {
      console.log(
        `[CDS] Removed ${suspiciousRemoved} candidates with suspicious CDNs: ${[...suspiciousCdns].join(", ")}`
      );
    }
  }

  // Source 2: Weight bridge candidates (dry-run — no writes)
  try {
    const weightCandidates = await queryRows<{
      waiver_id: string;
      appointment_id: string;
      cdn: number;
      score: number;
    }>(
      `SELECT waiver_id::text, appointment_id::text, cdn, score
       FROM ops.bridge_waivers_by_weight_candidates($1)`,
      [clinicDate]
    );
    for (const wc of weightCandidates) {
      candidates.push({
        appointment_id: wc.appointment_id,
        cdn: wc.cdn,
        source: "waiver_weight",
        waiver_id: wc.waiver_id,
        confidence: wc.score,
      });
    }
  } catch {
    /* function may not exist yet */
  }

  return { candidates, suspiciousCdnsRemoved: suspiciousRemoved };
}

/**
 * Validate CDN candidates against the master list before committing.
 *
 * Checks:
 * 1. ML owner match: does the ML entry at line N belong to the same owner?
 *    Foster exception: check cat name instead when either side is foster.
 * 2. Bidirectional: if multiple candidates claim the same CDN, keep highest confidence.
 * 3. Appointment conflict: if multiple CDNs target the same appointment, keep highest.
 * 4. Range check: CDN must correspond to a valid entry line.
 */
function validateCDNCandidates(
  candidates: CDNCandidate[],
  entries: CDSEntry[],
  appointments: CDSAppointment[]
): { verified: CDNCandidate[]; rejected: CDNCandidate[] } {
  const verified: CDNCandidate[] = [];
  const rejected: CDNCandidate[] = [];

  if (candidates.length === 0) return { verified, rejected };

  // Build lookups
  const entryByLine = new Map<number, CDSEntry>();
  for (const e of entries) {
    entryByLine.set(e.line_number, e);
  }
  const apptById = new Map<string, CDSAppointment>();
  for (const a of appointments) {
    apptById.set(a.appointment_id, a);
  }

  // ── Resolve bidirectional conflicts ──────────────────────────────
  // Multiple candidates claiming the same CDN → keep highest confidence
  const byCdn = new Map<number, CDNCandidate[]>();
  for (const c of candidates) {
    const group = byCdn.get(c.cdn) || [];
    group.push(c);
    byCdn.set(c.cdn, group);
  }

  const afterCdnDedup: CDNCandidate[] = [];
  for (const [, group] of byCdn) {
    group.sort((a, b) => b.confidence - a.confidence);
    afterCdnDedup.push(group[0]);
    for (let i = 1; i < group.length; i++) {
      rejected.push(group[i]);
    }
  }

  // Multiple CDNs targeting the same appointment → keep highest confidence
  const byAppt = new Map<string, CDNCandidate[]>();
  for (const c of afterCdnDedup) {
    const group = byAppt.get(c.appointment_id) || [];
    group.push(c);
    byAppt.set(c.appointment_id, group);
  }

  const deduped: CDNCandidate[] = [];
  for (const [, group] of byAppt) {
    group.sort((a, b) => b.confidence - a.confidence);
    deduped.push(group[0]);
    for (let i = 1; i < group.length; i++) {
      rejected.push(group[i]);
    }
  }

  // ── Validate each candidate against ML ───────────────────────────
  for (const candidate of deduped) {
    const entry = entryByLine.get(candidate.cdn);
    const appt = apptById.get(candidate.appointment_id);

    // Range check: CDN must map to an actual ML entry
    if (!entry) {
      rejected.push(candidate);
      continue;
    }

    // Appointment must exist
    if (!appt) {
      rejected.push(candidate);
      continue;
    }

    // ML owner match check
    const mlOwner = normalizeForGrouping(entry.parsed_owner_name);
    const apptClient = normalizeForGrouping(appt.client_name);

    if (mlOwner && apptClient) {
      const sim = stringSimilarity(mlOwner, apptClient);

      if (sim < 0.3) {
        // Names don't match — check if foster
        const isFoster =
          mlOwner.includes("foster") ||
          apptClient.includes("foster");

        if (isFoster) {
          // For fosters, verify cat name matches instead of owner
          const mlCat = normalizeForGrouping(entry.parsed_cat_name);
          const apptCat = normalizeForGrouping(appt.cat_name);
          if (mlCat && apptCat && stringSimilarity(mlCat, apptCat) < 0.3) {
            rejected.push(candidate);
            continue;
          }
          // If no cat name to check, allow foster through
        } else {
          // Check first name as fallback (handles "Name - call phone" formatting)
          const mlFirst = (entry.parsed_owner_name || "")
            .split(" ")[0]
            ?.toLowerCase()
            .replace(/[^a-z]/g, "") || "";
          if (mlFirst.length >= 2 && apptClient.includes(mlFirst)) {
            // First name match — allow
          } else {
            rejected.push(candidate);
            continue;
          }
        }
      }
    }

    verified.push(candidate);
  }

  return { verified, rejected };
}

/**
 * Commit verified CDN candidates by calling set_clinic_day_number().
 *
 * Handles swap detection: if two appointments need to exchange CDNs,
 * clears both first then sets both (atomic swap).
 *
 * MIG_3103 guards remain as defense-in-depth (collision + ML validation).
 */
async function commitVerifiedCDNs(
  verified: CDNCandidate[],
  clinicDate: string
): Promise<number> {
  if (verified.length === 0) return 0;

  // Build desired CDN map for swap detection
  const desiredCdns = new Map<string, number>();
  for (const c of verified) {
    desiredCdns.set(c.appointment_id, c.cdn);
  }

  // Detect and resolve swaps: appointment A has CDN X but wants Y,
  // AND appointment B has CDN Y but wants X
  const swapPairs = new Set<string>();
  for (const candidate of verified) {
    const current = await queryOne<{
      clinic_day_number: number | null;
      other_appt_id: string | null;
    }>(
      `SELECT a.clinic_day_number,
        (SELECT a2.appointment_id::text FROM ops.appointments a2
         WHERE a2.appointment_date = $2::DATE AND a2.clinic_day_number = $3
           AND a2.merged_into_appointment_id IS NULL AND a2.appointment_id != $1::UUID
         LIMIT 1) AS other_appt_id
       FROM ops.appointments a WHERE a.appointment_id = $1::UUID`,
      [candidate.appointment_id, clinicDate, candidate.cdn]
    );

    if (
      current?.clinic_day_number != null &&
      current.clinic_day_number !== candidate.cdn &&
      current.other_appt_id &&
      desiredCdns.has(current.other_appt_id) &&
      desiredCdns.get(current.other_appt_id) === current.clinic_day_number
    ) {
      const key = [candidate.appointment_id, current.other_appt_id]
        .sort()
        .join(":");
      if (!swapPairs.has(key)) {
        swapPairs.add(key);
        await execute(
          `UPDATE ops.appointments SET clinic_day_number = NULL, clinic_day_number_source = NULL
           WHERE appointment_id IN ($1::UUID, $2::UUID)
             AND NOT COALESCE(manually_overridden_fields @> ARRAY['clinic_day_number'], false)`,
          [candidate.appointment_id, current.other_appt_id]
        );
      }
    }
  }

  // Commit all verified CDNs via set_clinic_day_number (defense-in-depth)
  let committed = 0;
  for (const candidate of verified) {
    const result = await queryOne<{ set_clinic_day_number: boolean }>(
      `SELECT ops.set_clinic_day_number(
         $1::UUID,
         $2::INTEGER,
         'waiver_ocr'::ops.clinic_day_number_source,
         NULL
       )`,
      [candidate.appointment_id, candidate.cdn]
    );
    if (result?.set_clinic_day_number) committed++;
  }

  return committed;
}

// ── Delta clear: only clear entries affected by data changes ────────

/**
 * Clear only entries whose matched appointment was affected by a data change
 * since the last CDS run. Uses ops.cds_audit_events to identify affected
 * appointments (merged, CDN changed, etc.).
 *
 * FFS-1235: Delta-based re-matching instead of full clear.
 */
async function clearAffectedMatches(clinicDate: string): Promise<number> {
  // Find appointment IDs that changed since last CDS run
  const result = await queryOne<{ cleared: number }>(
    `WITH last_run AS (
       SELECT completed_at
       FROM ops.cds_runs
       WHERE clinic_date = $1 AND completed_at IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1
     ),
     affected_appts AS (
       SELECT DISTINCT e.entity_id::uuid AS appointment_id
       FROM ops.cds_audit_events e
       WHERE e.clinic_date = $1
         AND e.entity_type = 'appointment'
         AND e.event_type IN ('appointment_merged', 'cdn_changed')
         AND e.created_at > COALESCE((SELECT completed_at FROM last_run), '1970-01-01')
     ),
     cleared AS (
       UPDATE ops.clinic_day_entries e
       SET matched_appointment_id = NULL,
           match_confidence = NULL,
           match_reason = NULL,
           match_score = NULL,
           match_signals = NULL,
           matched_at = NULL,
           appointment_id = NULL,
           cat_id = NULL,
           cds_run_id = NULL,
           cds_method = NULL
       FROM ops.clinic_days cd
       WHERE cd.clinic_day_id = e.clinic_day_id
         AND cd.clinic_date = $1
         AND e.matched_appointment_id IN (SELECT appointment_id FROM affected_appts)
         AND e.match_confidence != 'manual'
         AND e.verified_at IS NULL
       RETURNING 1
     )
     SELECT COUNT(*)::int AS cleared FROM cleared`,
    [clinicDate]
  );

  return result?.cleared ?? 0;
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
       (regexp_match(e.raw_client_name, '\\m([A-Z]\\d{4,8})\\M'))[1] AS extracted_id
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
       AND e.matched_appointment_id IS NULL
       AND e.match_confidence IS DISTINCT FROM 'manual'
       AND e.raw_client_name ~ '\\m[A-Z]\\d{4,8}\\M'`,
    [clinicDate]
  );

  if (candidates.length === 0) return 0;

  let matched = 0;

  for (const candidate of candidates) {
    if (!candidate.extracted_id) continue;

    // Find a cat with this shelter ID (as previous_shelter_id OR cat name)
    // and an active appointment for the date.
    // Cat name match covers FFSC Relo/SCAS cats named by their shelter ID (e.g., "A440726").
    const match = await queryOne<{
      appointment_id: string;
      cat_id: string;
    }>(
      `SELECT a.appointment_id, a.cat_id
       FROM ops.appointments a
       JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
       WHERE a.appointment_date = $1
         AND a.merged_into_appointment_id IS NULL
         AND a.clinic_day_number IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM sot.cat_identifiers ci
             WHERE ci.cat_id = c.cat_id
               AND ci.id_type = 'previous_shelter_id'
               AND ci.id_value = $2
           )
           OR UPPER(c.name) = UPPER($2)
         )
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

  // Load available (unmatched) appointments with cat weight.
  // Waiver OCR weight (from day of surgery) is more authoritative than
  // cat_vitals which may be from a different date.
  const availableAppts = await queryRows<{
    appointment_id: string;
    client_name: string | null;
    cat_weight: number | null;
    cat_sex: string | null;
  }>(
    `SELECT a.appointment_id, a.client_name,
            COALESCE(ww.ocr_weight_lbs, cv.weight_lbs) AS cat_weight,
            c.sex AS cat_sex
     FROM ops.appointments a
     LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
     LEFT JOIN LATERAL (
       SELECT weight_lbs FROM ops.cat_vitals
       WHERE cat_id = a.cat_id ORDER BY recorded_at DESC LIMIT 1
     ) cv ON true
     LEFT JOIN LATERAL (
       SELECT ws.ocr_weight_lbs FROM ops.waiver_scans ws
       WHERE ws.matched_appointment_id = a.appointment_id
         AND ws.ocr_weight_lbs IS NOT NULL
       LIMIT 1
     ) ww ON true
     WHERE a.appointment_date = $1
       AND a.merged_into_appointment_id IS NULL
       AND COALESCE(ww.ocr_weight_lbs, cv.weight_lbs) IS NOT NULL
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
 *
 * Sex partitioning: if the group has both sexes, partition into sex groups
 * first (2F + 1M → solve females separately from males). This prevents
 * cross-sex weight confusion where a heavy female looks like a light male.
 */
function solveWeightAssignment(
  entries: Array<{ entry_id: string; weight_lbs: number | null; female_count: number; male_count: number }>,
  appts: Array<{ appointment_id: string; cat_weight: number | null; cat_sex: string | null }>,
  minGap: number
): Array<{ entry: typeof entries[0]; appt: typeof appts[0]; gap: number }> {
  // Partition by sex when both sexes are present
  const femaleEntries = entries.filter((e) => e.female_count > 0);
  const maleEntries = entries.filter((e) => e.male_count > 0);
  const unknownEntries = entries.filter((e) => e.female_count === 0 && e.male_count === 0);

  const femaleAppts = appts.filter((a) => {
    const s = a.cat_sex?.toLowerCase();
    return s === "female" || s === "f";
  });
  const maleAppts = appts.filter((a) => {
    const s = a.cat_sex?.toLowerCase();
    return s === "male" || s === "m";
  });
  const unknownAppts = appts.filter((a) => !a.cat_sex);

  const hasBothSexes =
    (femaleEntries.length > 0 || femaleAppts.length > 0) &&
    (maleEntries.length > 0 || maleAppts.length > 0);

  if (hasBothSexes) {
    // Solve each sex group independently, then unknowns against remainder
    const usedAppts = new Set<string>();
    const usedEntries = new Set<string>();
    const results: Array<{ entry: typeof entries[0]; appt: typeof appts[0]; gap: number }> = [];

    // Females first
    const fResults = solveWeightGroup(femaleEntries, [...femaleAppts, ...unknownAppts], minGap);
    for (const r of fResults) {
      results.push(r);
      usedAppts.add(r.appt.appointment_id);
      usedEntries.add(r.entry.entry_id);
    }

    // Males
    const remainingMaleAppts = [...maleAppts, ...unknownAppts].filter((a) => !usedAppts.has(a.appointment_id));
    const mResults = solveWeightGroup(maleEntries, remainingMaleAppts, minGap);
    for (const r of mResults) {
      results.push(r);
      usedAppts.add(r.appt.appointment_id);
      usedEntries.add(r.entry.entry_id);
    }

    // Unknowns against remaining
    const remainingUnkEntries = unknownEntries.filter((e) => !usedEntries.has(e.entry_id));
    const remainingAppts = appts.filter((a) => !usedAppts.has(a.appointment_id));
    if (remainingUnkEntries.length > 0 && remainingAppts.length > 0) {
      const uResults = solveWeightGroup(remainingUnkEntries, remainingAppts, minGap);
      results.push(...uResults);
    }

    return results;
  }

  // Single sex or unknown — solve as one group
  return solveWeightGroup(entries, appts, minGap);
}

/**
 * Core weight assignment within a single sex partition.
 */
function solveWeightGroup(
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

// ── Phase 7.5: Fuzzy Name Rescue ──────────────────────────────────────

/**
 * Aggressive name normalization: strips phone suffixes, trapper aliases,
 * parenthetical notes, and honorifics.
 */
function normalizeNameAggressive(name: string | null): string {
  if (!name) return "";
  let n = name.toLowerCase();
  n = n.replace(/\s*[-–]\s*(call|text|phone|cell|home|work)\b.*$/i, "");
  n = n.replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "");
  n = n.replace(/\s*[-–]\s*trp\b.*$/i, "");
  n = n.replace(/\s*\(.*?\)\s*/g, " ");
  n = n.replace(/\b(jr|sr|ii|iii|iv|mr|mrs|ms|dr)\b\.?/g, "");
  return n.replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

function scoreNameTokensFuzzy(a: string, b: string): number {
  const tokensA = normalizeNameAggressive(a).split(" ").filter((t) => t.length >= 2);
  const tokensB = normalizeNameAggressive(b).split(" ").filter((t) => t.length >= 2);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  let totalScore = 0;
  const usedB = new Set<number>();
  for (const tA of tokensA) {
    let bestScore = 0;
    let bestIdx = -1;
    for (let i = 0; i < tokensB.length; i++) {
      if (usedB.has(i)) continue;
      const maxLen = Math.max(tA.length, tokensB[i].length);
      if (maxLen === 0) continue;
      const score = 1 - levenshtein(tA, tokensB[i]) / maxLen;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx >= 0) usedB.add(bestIdx);
    totalScore += bestScore;
  }
  return totalScore / tokensA.length;
}

/**
 * Fuzzy name rescue: catches entries that composite scoring missed due to
 * name formatting differences. Uses aggressive normalization + Levenshtein
 * token matching. Only matches when a corroborating signal (sex, cat name)
 * also agrees — never matches on fuzzy name alone.
 */
async function runFuzzyNameRescue(
  clinicDate: string,
  runId: string
): Promise<number> {
  // Load unmatched entries
  const unmatched = await queryRows<{
    entry_id: string;
    parsed_owner_name: string | null;
    parsed_cat_name: string | null;
    female_count: number;
    male_count: number;
    is_foster: boolean;
  }>(
    `SELECT e.entry_id, e.parsed_owner_name, e.parsed_cat_name,
            COALESCE(e.female_count, 0) AS female_count,
            COALESCE(e.male_count, 0) AS male_count,
            COALESCE(e.is_foster, false) AS is_foster
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
       AND (e.match_confidence IS NULL OR e.match_confidence = 'unmatched')
       AND e.cancellation_reason IS NULL
     ORDER BY e.line_number`,
    [clinicDate]
  );

  if (unmatched.length === 0) return 0;

  // Load available appointments
  const available = await queryRows<{
    appointment_id: string;
    client_name: string | null;
    cat_name: string | null;
    cat_sex: string | null;
    account_owner_name: string | null;
  }>(
    `SELECT a.appointment_id, a.client_name, c.name AS cat_name, c.sex AS cat_sex,
            NULLIF(TRIM(COALESCE(ca.owner_first_name, '') || ' ' || COALESCE(ca.owner_last_name, '')), '') AS account_owner_name
     FROM ops.appointments a
     LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
     LEFT JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id AND ca.merged_into_account_id IS NULL
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

  let matched = 0;
  const usedApptIds = new Set<string>();
  const usedEntryIds = new Set<string>();

  // Score all entry-appointment pairs using token-level fuzzy matching
  const pairs: Array<{
    entry: typeof unmatched[0];
    appt: typeof available[0];
    nameScore: number;
    corroborating: number; // count of agreeing signals
  }> = [];

  for (const entry of unmatched) {
    if (!entry.parsed_owner_name) continue;
    for (const appt of available) {
      // Try fuzzy name match against both client_name and account_owner_name
      let nameScore = 0;
      for (const name of [appt.client_name, appt.account_owner_name]) {
        if (!name) continue;
        nameScore = Math.max(nameScore, scoreNameTokensFuzzy(entry.parsed_owner_name!, name));
      }

      // Must have meaningful name similarity (0.65+ on tokens)
      if (nameScore < 0.65) continue;

      // Count corroborating signals
      let corroborating = 0;

      // Sex agreement
      if (appt.cat_sex) {
        const isFemale = appt.cat_sex.toLowerCase() === "female" || appt.cat_sex.toLowerCase() === "f";
        const isMale = appt.cat_sex.toLowerCase() === "male" || appt.cat_sex.toLowerCase() === "m";
        if ((entry.female_count > 0 && isFemale) || (entry.male_count > 0 && isMale)) {
          corroborating++;
        }
        // Sex mismatch is a hard reject
        if ((entry.female_count > 0 && isMale) || (entry.male_count > 0 && isFemale)) {
          continue;
        }
      }

      // Cat name similarity
      if (entry.parsed_cat_name && appt.cat_name) {
        const catNorm1 = normalizeForGrouping(entry.parsed_cat_name);
        const catNorm2 = normalizeForGrouping(appt.cat_name);
        if (catNorm1 && catNorm2 && stringSimilarity(catNorm1, catNorm2) > 0.5) {
          corroborating++;
        }
      }

      // Require at least 1 corroborating signal (never match on name alone)
      if (corroborating === 0) continue;

      pairs.push({ entry, appt, nameScore, corroborating });
    }
  }

  // Greedy assignment: best combined score first
  pairs.sort((a, b) => {
    const scoreA = a.nameScore + a.corroborating * 0.15;
    const scoreB = b.nameScore + b.corroborating * 0.15;
    return scoreB - scoreA;
  });

  for (const pair of pairs) {
    if (usedEntryIds.has(pair.entry.entry_id) || usedApptIds.has(pair.appt.appointment_id)) {
      continue;
    }

    await execute(
      `UPDATE ops.clinic_day_entries
       SET matched_appointment_id = $2,
           match_confidence = 'medium',
           match_reason = 'fuzzy_name_rescue',
           match_score = $3,
           match_signals = $4,
           matched_at = NOW(),
           cds_run_id = $5,
           cds_method = $6
       WHERE entry_id = $1
         AND (matched_appointment_id IS NULL OR match_confidence = 'unmatched')`,
      [
        pair.entry.entry_id,
        pair.appt.appointment_id,
        pair.nameScore,
        JSON.stringify({
          name_token_score: pair.nameScore,
          corroborating_signals: pair.corroborating,
          entry_owner: pair.entry.parsed_owner_name,
          appt_client: pair.appt.client_name,
        }),
        runId,
        CDS_METHODS.FUZZY_NAME_RESCUE,
      ]
    );

    usedEntryIds.add(pair.entry.entry_id);
    usedApptIds.add(pair.appt.appointment_id);
    matched++;
  }

  return matched;
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
        system: `You are a TNR (Trap-Neuter-Return) clinic data matching assistant for Forgotten Felines of Sonoma County. Match handwritten master list entries to digital ClinicHQ booking records. Names often differ (typos, phone suffixes, trapper aliases). Foster cats are booked under "Forgotten Felines Fosters" — match by cat name. Return valid JSON only.`,
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

  return `Match these master list entries to ClinicHQ appointments for a TNR spay/neuter clinic day.

MASTER LIST ENTRIES (unmatched — handwritten surgery log):
${entryLines}

CLINICHQ APPOINTMENTS (available — digital booking system):
${apptLines}

Return JSON array:
[{ "entry_id": "...", "appointment_id": "...", "confidence": 0.0-1.0, "reasoning": "..." }]

Rules:
- Each entry maps to exactly one appointment (1:1), or to nothing if no match
- Names may differ between systems: typos ("Suzie"/"Suzi"), phone suffixes ("Name - call 707-555-1234"), trapper aliases ("Name - Trp Christina" means Christina booked, not the owner)
- Foster cats: ML says "Foster" or person name, CHQ says "Forgotten Felines Fosters". Match by cat name, not owner.
- Use weight, sex, color, breed as disambiguation signals for multi-cat owners
- Confidence 0.9+ = strong evidence, 0.7-0.9 = reasonable, <0.7 = skip
- If genuinely ambiguous or no plausible match, set confidence < 0.7 to skip
- Do NOT force matches — unmatched is a valid outcome (rechecks, no-shows, cancelled surgeries have no booking)`;
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

/**
 * Generic match tagger — sets cds_run_id + cds_method on entries matched
 * by a specific match_reason prefix. Used by CDN-first and other phases.
 */
async function tagMethodMatches(
  clinicDate: string,
  runId: string,
  reasonPrefix: string,
  method: string
): Promise<void> {
  await execute(
    `UPDATE ops.clinic_day_entries e
     SET cds_run_id = $2,
         cds_method = $4
     FROM ops.clinic_days cd
     WHERE cd.clinic_day_id = e.clinic_day_id
       AND cd.clinic_date = $1
       AND e.match_reason LIKE $3 || '%'
       AND e.cds_run_id IS NULL`,
    [clinicDate, runId, reasonPrefix, method]
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

// ── Phase 11.5: Waiver Cat Rescue ────────────────────────────────────

/**
 * For entries with no appointment match, look up the waiver at their
 * line_number. If the waiver identifies a cat (via chip match), set
 * cat_id directly on the entry.
 *
 * This enables:
 * - Photo linkage for cats without bookings (rechecks, cancelled, walk-ins)
 * - Cat identity on the clinic day page even without an appointment
 * - Future: weight/procedure data attached to the cat record
 *
 * Safety: only sets cat_id, never creates fake appointments or matches.
 * The entry stays unmatched (no matched_appointment_id). cat_id is purely
 * "we know which cat this was" without implying a booking existed.
 */
async function rescueCatsFromWaivers(clinicDate: string): Promise<number> {
  const rescued = await queryOne<{ count: number }>(
    `WITH rescued AS (
       UPDATE ops.clinic_day_entries e
       SET cat_id = w.matched_cat_id,
           waiver_scan_id = COALESCE(e.waiver_scan_id, w.waiver_id)
       FROM ops.clinic_days cd,
            ops.waiver_scans w
       WHERE cd.clinic_day_id = e.clinic_day_id
         AND cd.clinic_date = $1
         AND w.parsed_date = cd.clinic_date
         AND w.ocr_clinic_number = e.line_number
         AND w.matched_cat_id IS NOT NULL
         -- Only rescue entries that have no cat yet
         AND e.cat_id IS NULL
         -- Don't touch matched entries (they get cat_id via propagation)
         AND e.matched_appointment_id IS NULL
       RETURNING 1
     )
     SELECT COUNT(*)::int AS count FROM rescued`,
    [clinicDate]
  );

  return rescued?.count ?? 0;
}

// ── Phase 8: Classify unmatched entries via notes ──────────────────

const UNMATCHED_REASONS = [
  "surgery_cancelled",     // explicitly cancelled
  "no_show",               // didn't show up
  "redirected",            // sent to another clinic/org (HS, vet, etc.)
  "owner_withdrew",        // owner took cat home without surgery
  "medical_hold",          // pregnant, in heat, medical reason
  "rescheduled",           // moved to another date
  "duplicate_entry",       // same cat on another ML line that matched
  "recheck_no_booking",    // follow-up/bandage change/update with no CHQ booking
  "foster_name_mismatch",  // booked under foster org, not owner
  "spelling_mismatch",     // owner name typo prevented match
  "no_chq_booking",        // cat was at clinic (has weight/sex) but no CHQ appointment
  "unknown",               // can't determine
] as const;

type UnmatchedReason = (typeof UNMATCHED_REASONS)[number];

interface UnmatchedEntry {
  entry_id: string;
  line_number: number;
  parsed_owner_name: string | null;
  parsed_cat_name: string | null;
  raw_client_name: string | null;
  notes: string | null;
  female_count: number;
  male_count: number;
  weight_lbs: number | null;
  is_recheck: boolean;
  is_foster: boolean;
}

/**
 * Classify unmatched entries using a combination of deterministic rules
 * and LLM interpretation of notes. Sets cancellation_reason on classified entries.
 */
export async function classifyUnmatchedEntries(
  clinicDate: string
): Promise<{ classified: number; llm_calls: number }> {
  const entries = await queryRows<UnmatchedEntry>(`
    SELECT e.entry_id::text, e.line_number, e.parsed_owner_name, e.parsed_cat_name,
      e.raw_client_name, e.notes, e.female_count, e.male_count, e.weight_lbs,
      COALESCE(e.is_recheck, false) AS is_recheck,
      COALESCE(e.is_foster, false) AS is_foster
    FROM ops.clinic_day_entries e
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE cd.clinic_date = $1
      AND e.matched_appointment_id IS NULL
      AND e.cancellation_reason IS NULL
    ORDER BY e.line_number
  `, [clinicDate]);

  if (entries.length === 0) return { classified: 0, llm_calls: 0 };

  // Pass 1: Deterministic classification
  const needsLLM: UnmatchedEntry[] = [];
  let classified = 0;

  for (const entry of entries) {
    const reason = classifyDeterministic(entry);
    if (reason) {
      await execute(
        `UPDATE ops.clinic_day_entries SET cancellation_reason = $2 WHERE entry_id = $1::UUID`,
        [entry.entry_id, reason]
      );
      classified++;
    } else if (entry.notes && entry.notes.trim() !== "") {
      needsLLM.push(entry);
    }
  }

  // Pass 2: LLM classification for entries with notes we can't parse deterministically
  let llmCalls = 0;
  if (needsLLM.length > 0 && process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const results = await classifyNotesWithLLM(client, needsLLM);
    llmCalls = 1; // batch call

    for (const result of results) {
      if (result.reason !== "unknown") {
        await execute(
          `UPDATE ops.clinic_day_entries SET cancellation_reason = $2 WHERE entry_id = $1::UUID`,
          [result.entry_id, result.reason]
        );
        classified++;
      }
    }
  }

  return { classified, llm_calls: llmCalls };
}

function classifyDeterministic(entry: UnmatchedEntry): UnmatchedReason | null {
  const notes = (entry.notes || "").toLowerCase();
  const raw = (entry.raw_client_name || "").toLowerCase();
  const hasSurgery = entry.female_count + entry.male_count > 0;

  // NOTE: "xxxxxxxxx" in notes does NOT mean crossed-out/cancelled.
  // It means "ditto" / "see above" — same owner, second cat, details on previous line.

  // Master list status annotations from ML parser
  // NOTE: At a TNR clinic, Preg and Heat are NOT medical holds — cats still get
  // spayed. These annotations note the condition, not defer surgery.
  // Only explicit Cancel/No Show are actionable.
  if (notes.includes("master_list_status=cancel")) return "surgery_cancelled";
  if (notes.includes("master_list_status=no show")) return "no_show";

  // Recheck/follow-up with no booking
  if (entry.is_recheck) return "recheck_no_booking";
  if (raw.includes("bandage change") || raw.includes("(updates)") || raw.includes("(update)"))
    return "recheck_no_booking";
  if (raw.includes("enucleation") || raw.includes("pinnectomy") || raw.includes("cryotorchid"))
    return "recheck_no_booking";

  // Had surgery but no CHQ booking (data gap, not a cancellation)
  if (hasSurgery && entry.weight_lbs != null) return "no_chq_booking";

  // No surgery, no notes, no weight → blank placeholder
  if (!hasSurgery && !entry.notes && !entry.weight_lbs) return "no_show";

  // Explicit patterns in notes
  if (notes.includes("cancel")) return "surgery_cancelled";
  if (notes.includes("no show") || notes.includes("no call")) return "no_show";
  if (notes.includes("took home") || notes.includes("owner declined")) return "owner_withdrew";
  if (notes.includes("sent appt") || notes.includes("sent to") || notes.includes("referred"))
    return "redirected";
  if (notes.includes("reschedul")) return "rescheduled";
  if (notes.includes("preg") || notes.includes("heat") || notes.includes("in season"))
    return "medical_hold";

  // Foster name mismatch
  if (entry.is_foster) return "foster_name_mismatch";

  // Has surgery mark but no weight (partial data) → treated but data gap
  if (hasSurgery) return "no_chq_booking";

  return null; // needs LLM
}

async function classifyNotesWithLLM(
  client: Anthropic,
  entries: UnmatchedEntry[]
): Promise<Array<{ entry_id: string; reason: UnmatchedReason }>> {
  const entrySummaries = entries.map((e) =>
    `LINE ${e.line_number}: owner="${e.parsed_owner_name || "?"}", cat="${e.parsed_cat_name || "?"}", ` +
    `raw="${e.raw_client_name || ""}", notes="${e.notes || ""}", ` +
    `sex_mark=${e.female_count + e.male_count > 0 ? "yes" : "no"}, weight=${e.weight_lbs ?? "none"}`
  ).join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `You are classifying unmatched master list entries from a TNR (Trap-Neuter-Return) spay/neuter clinic.

Each entry was on the clinic's master list but couldn't be matched to a ClinicHQ appointment. The NOTES column from the Excel sheet explains why.

Classify each entry with ONE of these reasons:
- surgery_cancelled: explicitly cancelled
- no_show: didn't show up, no call
- redirected: sent to another clinic/org (humane society, vet, etc.)
- owner_withdrew: owner took cat home without surgery
- medical_hold: pregnant, in heat, medical reason preventing surgery
- rescheduled: moved to another date
- recheck_no_booking: follow-up visit (bandage change, weight check, updates)
- no_chq_booking: cat appears to have been at clinic but no booking exists
- unknown: cannot determine from available data

Common abbreviations: STO = Sent To Owner (pickup), PU = pickup, DNC = Did Not Complete, HS = Humane Society, Relo = Relocation

Entries:
${entrySummaries}

Return JSON array: [{"line": NUMBER, "reason": "REASON", "explanation": "brief why"}]
Return ONLY the JSON, no other text.`,
    }],
  });

  try {
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      line: number;
      reason: string;
      explanation: string;
    }>;

    return parsed
      .map((r) => {
        const entry = entries.find((e) => e.line_number === r.line);
        const reason = UNMATCHED_REASONS.includes(r.reason as UnmatchedReason)
          ? (r.reason as UnmatchedReason)
          : "unknown";
        return entry ? { entry_id: entry.entry_id, reason } : null;
      })
      .filter((r): r is { entry_id: string; reason: UnmatchedReason } => r !== null);
  } catch {
    return [];
  }
}
