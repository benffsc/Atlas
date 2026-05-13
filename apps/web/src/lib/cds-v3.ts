/**
 * Cat Determining System v3 — Score Matrix + Global Assignment
 *
 * Architecture: separate scoring from assignment.
 *
 *   Phase 1: Clean Inputs
 *     - Load entries, appointments, waivers
 *     - Dedup appointments (cancel/rebook ghosts)
 *     - CDN candidates: validate-before-commit (kept from v2)
 *     - Exclude: cancelled entries, no-shows, header rows
 *     - Pre-assign: manual matches + CDN deterministic matches
 *
 *   Phase 2: Build Score Matrix
 *     - For EVERY (entry, appointment) pair, compute composite score
 *     - Signals: owner_name, cat_name, sex, weight, waiver_chip,
 *       shelter_id, time_order, chip_direct, appt_number
 *     - Foster adjustment: zero owner_name, double cat_name
 *     - Output: N×M matrix of scored pairs
 *
 *   Phase 3: Solve Global Assignment
 *     - Hungarian algorithm on score matrix
 *     - Hard constraints: CDN + manual pre-assigned
 *     - Minimum threshold: below = unmatched
 *     - Globally optimal: no entry steals from another
 *
 *   Phase 4: Write + Classify
 *     - Propagate cat_id + appointment_id
 *     - Waiver cat rescue (entries without appointments)
 *     - Classify unmatched (deterministic + LLM)
 *
 * Key improvement over v2: no cascading errors from greedy sequential
 * matching. The assignment algorithm considers ALL pairings simultaneously.
 */

import Anthropic from "@anthropic-ai/sdk";
import { queryRows, queryOne, execute } from "@/lib/db";

// ── Types ──────────────────────────────────────────────────────────────

interface CDSEntry {
  entry_id: string;
  line_number: number;
  parsed_owner_name: string | null;
  parsed_cat_name: string | null;
  parsed_cat_color: string | null;
  female_count: number;
  male_count: number;
  weight_lbs: number | null;
  sx_end_time: string | null;
  is_foster: boolean;
  is_recheck: boolean;
  notes: string | null;
  raw_client_name: string | null;
  // Pre-existing state
  matched_appointment_id: string | null;
  match_confidence: string | null;
  cds_method: string | null;
  cancellation_reason: string | null;
}

interface CDSAppointment {
  appointment_id: string;
  appointment_number: string | null;
  client_name: string | null;
  account_owner_name: string | null;
  cat_id: string | null;
  cat_name: string | null;
  cat_sex: string | null;
  cat_weight: number | null;
  microchip: string | null;
  cat_color: string | null;
  cat_breed: string | null;
  appointment_date: string;
  surgery_start_time: string | null;
  clinic_day_number: number | null;
  shelterluv_names: string[];
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
  ocr_weight_lbs: number | null;
}

interface CDSConfig {
  min_match_threshold: number;       // Minimum score to accept a match (default 0.25)
  min_cross_client_threshold: number; // Higher bar for cross-client (default 0.30)
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
  waiver_id: string | null;
  confidence: number;
}

// Score breakdown for a single (entry, appointment) pair
interface SignalBreakdown {
  owner_name: number;     // 0-1 — trigram + Levenshtein (best of)
  cat_name: number;       // 0-1 — name similarity + ShelterLuv aliases
  sex: number;            // -1 (mismatch), 0 (unknown), 1 (match)
  weight: number;         // 0-1 — distance-based
  waiver_chip: number;    // 0 or 1 — chip bridge via waiver
  chip_direct: number;    // 0 or 1 — direct chip last4 match
  shelter_id: number;     // 0 or 1 — previous shelter ID bridge
  appt_number: number;    // 0 or 1 — appointment number cross-ref
  time_order: number;     // 0-1 — surgery time rank correlation
  cdn_match: number;      // 0 or 1 — deterministic CDN match (hard constraint)
}

interface ScoredPair {
  entry_id: string;
  appointment_id: string;
  score: number;
  signals: SignalBreakdown;
  is_foster: boolean;
  is_cross_client: boolean;
}

interface Assignment {
  entry_id: string;
  appointment_id: string;
  score: number;
  signals: SignalBreakdown;
  confidence: "high" | "medium" | "low";
  method: string;
}

interface PhaseResult {
  phase: string;
  matched: number;
  details?: Record<string, unknown>;
}

interface CDSRunResult {
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

// ── Signal weights ─────────────────────────────────────────────────────
// These define how much each signal contributes to the composite score.
// Foster entries get adjusted weights (zero owner_name, double cat_name).

const SIGNAL_WEIGHTS = {
  owner_name: 0.25,
  cat_name: 0.20,
  sex: 0.12,
  weight: 0.15,
  waiver_chip: 0.08,
  chip_direct: 0.08,
  shelter_id: 0.04,
  appt_number: 0.04,
  time_order: 0.04,
} as const;

const FOSTER_WEIGHTS = {
  ...SIGNAL_WEIGHTS,
  owner_name: 0.00,  // "Foster" vs "Forgotten Felines Fosters" — meaningless
  cat_name: 0.40,    // Cat identity is the only reliable signal
  weight: 0.20,      // Weight becomes more important
} as const;

// ── Main entry point ───────────────────────────────────────────────────

export async function runCDS(
  clinicDate: string,
  triggeredBy: "import" | "rematch" | "manual"
): Promise<CDSRunResult> {
  const phases: PhaseResult[] = [];

  // Create run record
  const run = await queryOne<{ run_id: string }>(
    `INSERT INTO ops.cds_runs (clinic_date, triggered_by, started_at)
     VALUES ($1, $2, NOW()) RETURNING run_id`,
    [clinicDate, triggeredBy]
  );
  const runId = run!.run_id;

  // ── Phase 1: Clean Inputs ──────────────────────────────────────────

  // 1a. Load all data sources
  const entries = await loadEntries(clinicDate);
  const appointments = await loadAppointments(clinicDate);
  let waivers = await loadWaivers(clinicDate);
  const config = await loadCDSConfig();

  const totalEntries = entries.length;
  const manualCount = entries.filter(
    (e) => e.match_confidence === "manual"
  ).length;
  const hasWaivers = waivers.length > 0;
  const hasWeights = entries.some((e) => e.weight_lbs != null);

  phases.push({
    phase: "1a_assembly",
    matched: 0,
    details: {
      entries: totalEntries,
      appointments: appointments.length,
      waivers: waivers.length,
      manual: manualCount,
      has_weights: hasWeights,
    },
  });

  if (totalEntries === 0 || appointments.length === 0) {
    return await finalizeCDSRun(runId, clinicDate, {
      totalEntries, matchedBefore: manualCount, matchedAfter: manualCount,
      manualPreserved: manualCount, llmSuggestions: 0,
      unmatchedRemaining: totalEntries - manualCount,
      hasWaivers, hasWeights, phases,
    });
  }

  // 1b. Dedup appointments (cancel/rebook ghosts)
  const dedupResult = await dedupeAppointments(clinicDate);
  phases.push({
    phase: "1b_appointment_dedup",
    matched: dedupResult.merged,
    details: dedupResult.details,
  });

  // 1c. CDN candidates (validate-before-commit, kept from v2)
  const { candidates: cdnCandidates, suspiciousCdnsRemoved } =
    await buildCDNCandidates(clinicDate, waivers);
  const { verified: verifiedCdns, rejected: rejectedCdns } =
    validateCDNCandidates(cdnCandidates, entries, appointments);
  const cdnsCommitted = await commitVerifiedCDNs(verifiedCdns, clinicDate);

  // Update waivers if weight-bridged
  for (const c of verifiedCdns) {
    if (c.source === "waiver_weight") {
      try {
        await execute(
          `UPDATE ops.waiver_scans SET
             matched_appointment_id = $1,
             matched_cat_id = (SELECT cat_id FROM ops.appointments WHERE appointment_id = $1),
             match_method = 'ocr_weight_composite_validated',
             match_confidence = $2
           WHERE waiver_id = $3 AND matched_appointment_id IS NULL`,
          [c.appointment_id, c.confidence, c.waiver_id]
        );
      } catch { /* non-fatal */ }
    }
  }

  // Reload waivers if any were weight-bridged
  if (verifiedCdns.some((c) => c.source === "waiver_weight")) {
    waivers = await loadWaivers(clinicDate);
  }

  phases.push({
    phase: "1c_cdn_candidates",
    matched: cdnsCommitted,
    details: {
      total_candidates: cdnCandidates.length,
      verified: verifiedCdns.length,
      rejected: rejectedCdns.length,
      committed: cdnsCommitted,
      suspicious_removed: suspiciousCdnsRemoved,
    },
  });

  // 1d. Detect cancelled entries — HARD EXCLUSION
  // These entries are removed from the matching pool entirely.
  const cancelledCount = await detectCancelledEntries(clinicDate);
  phases.push({
    phase: "1d_cancelled_exclusion",
    matched: 0,
    details: { excluded: cancelledCount },
  });

  // 1e. Clear stale matches (for rematch mode)
  let cleared = 0;
  if (triggeredBy === "rematch") {
    cleared = await clearAutoMatches(clinicDate);
  }
  if (cleared > 0) {
    phases.push({
      phase: "1e_clear",
      matched: 0,
      details: { cleared, mode: "full" },
    });
  }

  // Reload entries after clears/exclusions
  const freshEntries = await loadEntries(clinicDate);
  const freshAppointments = await loadAppointments(clinicDate);

  // Separate the pools
  // Cancelled entries are INCLUDED in matching (cancellation is a label,
  // not a gate — the cat was still at the clinic). They get a score
  // penalty so they don't steal appointments from non-cancelled entries,
  // but the Hungarian algorithm can still link them for data cohesion.
  const matchableEntries = freshEntries.filter(
    (e) =>
      e.match_confidence !== "manual" &&
      e.matched_appointment_id == null
  );

  // Appointments already consumed by manual or CDN matches
  const consumedApptIds = new Set(
    freshEntries
      .filter((e) => e.matched_appointment_id != null)
      .map((e) => e.matched_appointment_id!)
  );
  const availableAppointments = freshAppointments.filter(
    (a) => !consumedApptIds.has(a.appointment_id)
  );

  // ── Phase 2: Build Score Matrix ────────────────────────────────────

  const scoreMatrix = buildScoreMatrix(
    matchableEntries,
    availableAppointments,
    waivers,
    freshEntries // full list for time_order context
  );

  phases.push({
    phase: "2_score_matrix",
    matched: 0,
    details: {
      matchable_entries: matchableEntries.length,
      available_appointments: availableAppointments.length,
      pairs_scored: scoreMatrix.length,
      above_threshold: scoreMatrix.filter(
        (p) => p.score >= config.min_match_threshold
      ).length,
    },
  });

  // ── Phase 3: Solve Global Assignment ───────────────────────────────

  const assignments = solveAssignment(
    scoreMatrix,
    matchableEntries,
    availableAppointments,
    config
  );

  // Write assignments to DB
  let matched = 0;
  for (const a of assignments) {
    await execute(
      `UPDATE ops.clinic_day_entries
       SET matched_appointment_id = $1,
           match_confidence = $2,
           cds_method = $3,
           match_score = $4,
           match_signals = $5,
           matched_at = NOW(),
           cds_run_id = $6
       WHERE entry_id = $7
         AND matched_appointment_id IS NULL
         AND match_confidence IS DISTINCT FROM 'manual'`,
      [
        a.appointment_id,
        a.confidence,
        a.method,
        a.score,
        JSON.stringify(a.signals),
        runId,
        a.entry_id,
      ]
    );
    matched++;
  }

  phases.push({
    phase: "3_global_assignment",
    matched,
    details: {
      assignments: assignments.length,
      high: assignments.filter((a) => a.confidence === "high").length,
      medium: assignments.filter((a) => a.confidence === "medium").length,
      low: assignments.filter((a) => a.confidence === "low").length,
      unassigned:
        matchableEntries.length - assignments.length,
    },
  });

  // ── Phase 4: Write + Classify ──────────────────────────────────────

  // 4a. Propagate cat_id + appointment_id
  const propagated = await propagateMatches(clinicDate);
  // Also link cancelled entries to their cats
  await linkCancelledEntriesToCats(clinicDate);

  phases.push({
    phase: "4a_propagation",
    matched: propagated,
    details: {},
  });

  // 4b. Waiver cat rescue (entries without appointments get cat_id from waiver)
  const rescued = await rescueCatsFromWaivers(clinicDate);
  if (rescued > 0) {
    phases.push({
      phase: "4b_waiver_cat_rescue",
      matched: rescued,
      details: {},
    });
  }

  // 4c. LLM tiebreaker for remaining unmatched (gated)
  let llmSuggestions = 0;
  if (config.llm_enabled) {
    llmSuggestions = await runLLMTiebreaker(clinicDate, runId, config);
    if (llmSuggestions > 0) {
      phases.push({
        phase: "4c_llm_suggestions",
        matched: llmSuggestions,
        details: {},
      });
    }
  }

  // 4d. Classify unmatched
  const classified = await classifyUnmatchedEntries(clinicDate, config);
  phases.push({
    phase: "4d_classify_unmatched",
    matched: 0,
    details: { classified },
  });

  // ── Finalize ──────────────────────────────────────────────────────

  const matchedAfter = (
    await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM ops.clinic_day_entries e
       JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
       WHERE cd.clinic_date = $1
         AND e.matched_appointment_id IS NOT NULL
         AND e.match_confidence IS NOT NULL
         AND e.match_confidence != 'unmatched'`,
      [clinicDate]
    )
  )?.count ?? 0;

  const unmatchedAfter = (
    await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM ops.clinic_day_entries e
       JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
       WHERE cd.clinic_date = $1
         AND (e.matched_appointment_id IS NULL OR e.match_confidence = 'unmatched')
         AND e.cancellation_reason IS NULL`,
      [clinicDate]
    )
  )?.count ?? 0;

  return await finalizeCDSRun(runId, clinicDate, {
    totalEntries,
    matchedBefore: manualCount,
    matchedAfter,
    manualPreserved: manualCount,
    llmSuggestions,
    unmatchedRemaining: unmatchedAfter,
    hasWaivers,
    hasWeights,
    phases,
  });
}

// ── Phase 2: Score Matrix ──────────────────────────────────────────────

function buildScoreMatrix(
  entries: CDSEntry[],
  appointments: CDSAppointment[],
  waivers: CDSWaiver[],
  allEntries: CDSEntry[] // full entry list for time_order context
): ScoredPair[] {
  const pairs: ScoredPair[] = [];

  // Build waiver lookup: chip4 → waiver, lastName → waiver
  const waiverByChip4 = new Map<string, CDSWaiver[]>();
  const waiverByLastName = new Map<string, CDSWaiver[]>();
  for (const w of waivers) {
    if (w.parsed_last4_chip) {
      const arr = waiverByChip4.get(w.parsed_last4_chip) || [];
      arr.push(w);
      waiverByChip4.set(w.parsed_last4_chip, arr);
    }
    if (w.parsed_last_name) {
      const key = w.parsed_last_name.toLowerCase();
      const arr = waiverByLastName.get(key) || [];
      arr.push(w);
      waiverByLastName.set(key, arr);
    }
  }

  // Build shelter ID lookup from entry names
  const shelterIdPattern = /\b[A-Z]\d{4,8}\b/;

  // Time order: rank entries and appointments by position/time
  const entryRanks = new Map<string, number>();
  const sortedEntries = [...allEntries]
    .filter((e) => e.cancellation_reason == null)
    .sort((a, b) => a.line_number - b.line_number);
  sortedEntries.forEach((e, i) => entryRanks.set(e.entry_id, i));

  const apptRanks = new Map<string, number>();
  const sortedAppts = [...appointments].sort((a, b) => {
    if (a.surgery_start_time && b.surgery_start_time)
      return a.surgery_start_time.localeCompare(b.surgery_start_time);
    return (a.appointment_number || "").localeCompare(b.appointment_number || "");
  });
  sortedAppts.forEach((a, i) => apptRanks.set(a.appointment_id, i));

  for (const entry of entries) {
    for (const appt of appointments) {
      const signals = scoreSignals(
        entry,
        appt,
        waiverByChip4,
        waiverByLastName,
        shelterIdPattern,
        entryRanks,
        apptRanks,
        entries.length
      );

      // Check if this is a CDN (deterministic) match
      if (
        appt.clinic_day_number != null &&
        appt.clinic_day_number === entry.line_number
      ) {
        signals.cdn_match = 1.0;
      }

      // Compute weighted score
      const weights = entry.is_foster ? FOSTER_WEIGHTS : SIGNAL_WEIGHTS;
      let score = 0;
      score += signals.owner_name * weights.owner_name;
      score += signals.cat_name * weights.cat_name;
      score += Math.max(0, signals.sex) * weights.sex; // Only positive contribution to score
      score += signals.weight * weights.weight;
      score += signals.waiver_chip * weights.waiver_chip;
      score += signals.chip_direct * weights.chip_direct;
      score += signals.shelter_id * weights.shelter_id;
      score += signals.appt_number * weights.appt_number;
      score += signals.time_order * weights.time_order;

      // Sex mismatch penalty (applied after weighting)
      if (signals.sex < 0) {
        score -= 0.15; // Hard penalty for sex mismatch
      }

      // CDN match is a hard override — always top score
      if (signals.cdn_match > 0) {
        score = 10.0; // Guaranteed assignment
      }

      // Cancelled entries get a score penalty — they shouldn't steal
      // appointments from non-cancelled entries, but can still be linked
      // for data cohesion if no better match exists.
      if (entry.cancellation_reason != null) {
        score *= 0.5;
      }

      // Determine if cross-client
      const isCrossClient =
        entry.parsed_owner_name != null &&
        appt.client_name != null &&
        stringSimilarity(
          normalizeForGrouping(entry.parsed_owner_name),
          normalizeForGrouping(appt.client_name)
        ) < 0.3;

      pairs.push({
        entry_id: entry.entry_id,
        appointment_id: appt.appointment_id,
        score,
        signals,
        is_foster: entry.is_foster,
        is_cross_client: isCrossClient,
      });
    }
  }

  return pairs;
}

function scoreSignals(
  entry: CDSEntry,
  appt: CDSAppointment,
  waiverByChip4: Map<string, CDSWaiver[]>,
  waiverByLastName: Map<string, CDSWaiver[]>,
  shelterIdPattern: RegExp,
  entryRanks: Map<string, number>,
  apptRanks: Map<string, number>,
  totalEntries: number
): SignalBreakdown {
  const signals: SignalBreakdown = {
    owner_name: 0,
    cat_name: 0,
    sex: 0,
    weight: 0,
    waiver_chip: 0,
    chip_direct: 0,
    shelter_id: 0,
    appt_number: 0,
    time_order: 0,
    cdn_match: 0,
  };

  // ── Owner name ──
  if (entry.parsed_owner_name && appt.client_name) {
    const entryName = normalizeForGrouping(entry.parsed_owner_name);
    const apptName = normalizeForGrouping(appt.client_name);

    // Best of trigram and fuzzy token matching
    const trigramScore = stringSimilarity(entryName, apptName);
    const fuzzyScore = scoreNameTokensFuzzy(
      normalizeNameAggressive(entry.parsed_owner_name),
      normalizeNameAggressive(appt.client_name)
    );
    signals.owner_name = Math.max(trigramScore, fuzzyScore);

    // Also check account_owner_name (clinic account may differ from client)
    if (appt.account_owner_name) {
      const accountScore = stringSimilarity(
        entryName,
        normalizeForGrouping(appt.account_owner_name)
      );
      signals.owner_name = Math.max(signals.owner_name, accountScore);
    }
  }

  // ── Cat name ──
  if (entry.parsed_cat_name && appt.cat_name) {
    const entryName = entry.parsed_cat_name.toLowerCase().trim();
    const apptName = appt.cat_name.toLowerCase().trim();

    // Direct substring match
    if (entryName.includes(apptName) || apptName.includes(entryName)) {
      signals.cat_name = 0.95;
    } else {
      signals.cat_name = stringSimilarity(entryName, apptName);
    }

    // Check ShelterLuv aliases
    if (signals.cat_name < 0.5 && appt.shelterluv_names?.length > 0) {
      for (const alias of appt.shelterluv_names) {
        const aliasScore = stringSimilarity(
          entryName,
          alias.toLowerCase().trim()
        );
        signals.cat_name = Math.max(signals.cat_name, aliasScore);
      }
    }
  }

  // ── Sex ──
  const entrySex =
    entry.female_count > 0 && entry.male_count === 0
      ? "female"
      : entry.male_count > 0 && entry.female_count === 0
        ? "male"
        : null;
  if (entrySex && appt.cat_sex) {
    const apptSex = appt.cat_sex.toLowerCase();
    if (entrySex === apptSex) {
      signals.sex = 1.0;
    } else if (apptSex !== "unknown") {
      signals.sex = -1.0; // Hard mismatch
    }
  }

  // ── Weight ──
  if (entry.weight_lbs != null && appt.cat_weight != null) {
    const diff = Math.abs(entry.weight_lbs - appt.cat_weight);
    if (diff < 0.5) signals.weight = 1.0;
    else if (diff < 1.0) signals.weight = 0.7;
    else if (diff < 2.0) signals.weight = 0.3;
    else signals.weight = 0;
  }

  // ── Waiver chip ── (waiver chip4 matched to appointment via microchip)
  if (appt.microchip) {
    const chip4 = appt.microchip.slice(-4);
    const matchingWaivers = waiverByChip4.get(chip4) || [];
    for (const w of matchingWaivers) {
      if (w.matched_appointment_id === appt.appointment_id) {
        signals.waiver_chip = 1.0;
        break;
      }
    }
  }

  // ── Chip direct ── (entry owner → waiver by last name → chip → appointment)
  if (entry.parsed_owner_name && appt.microchip) {
    const entryLastName = extractLastName(entry.parsed_owner_name);
    if (entryLastName) {
      const nameWaivers = waiverByLastName.get(entryLastName.toLowerCase()) || [];
      for (const w of nameWaivers) {
        if (
          w.parsed_last4_chip &&
          appt.microchip.endsWith(w.parsed_last4_chip)
        ) {
          signals.chip_direct = 1.0;
          break;
        }
      }
    }
  }

  // ── Shelter ID ──
  if (entry.raw_client_name) {
    const match = entry.raw_client_name.match(shelterIdPattern);
    if (match && appt.cat_name) {
      // Check if appointment cat has this shelter ID
      const shelterId = match[0];
      if (appt.cat_name.includes(shelterId)) {
        signals.shelter_id = 1.0;
      }
    }
  }

  // ── Appointment number ──
  if (appt.appointment_number && entry.parsed_owner_name) {
    // Check if any waiver matched to this appointment bridges to entry owner
    const matchingWaivers = waiverByChip4.get(
      appt.microchip?.slice(-4) || ""
    ) || [];
    for (const w of matchingWaivers) {
      if (
        w.matched_appointment_id === appt.appointment_id &&
        w.parsed_last_name &&
        entry.parsed_owner_name
          .toLowerCase()
          .includes(w.parsed_last_name.toLowerCase())
      ) {
        signals.appt_number = 1.0;
        break;
      }
    }
  }

  // ── Time order ──
  const entryRank = entryRanks.get(entry.entry_id);
  const apptRank = apptRanks.get(appt.appointment_id);
  if (entryRank != null && apptRank != null && totalEntries > 1) {
    const maxRank = Math.max(totalEntries - 1, 1);
    const entryNorm = entryRank / maxRank;
    const apptNorm = apptRank / Math.max(apptRanks.size - 1, 1);
    signals.time_order = 1.0 - Math.abs(entryNorm - apptNorm);
  }

  return signals;
}

// ── Phase 3: Global Assignment (Hungarian Algorithm) ───────────────────

function solveAssignment(
  scoreMatrix: ScoredPair[],
  entries: CDSEntry[],
  appointments: CDSAppointment[],
  config: CDSConfig
): Assignment[] {
  if (entries.length === 0 || appointments.length === 0) return [];

  // Build lookup: entry_id → index, appointment_id → index
  const entryIndex = new Map<string, number>();
  entries.forEach((e, i) => entryIndex.set(e.entry_id, i));
  const apptIndex = new Map<string, number>();
  appointments.forEach((a, i) => apptIndex.set(a.appointment_id, i));

  const n = entries.length;
  const m = appointments.length;

  // Build cost matrix (Hungarian minimizes, so use negative scores)
  // Size: max(n, m) x max(n, m) — padded to square
  const size = Math.max(n, m);
  const costMatrix: number[][] = Array.from({ length: size }, () =>
    Array(size).fill(0)
  );

  // Fill with negative scores (Hungarian minimizes cost)
  for (const pair of scoreMatrix) {
    const ei = entryIndex.get(pair.entry_id);
    const ai = apptIndex.get(pair.appointment_id);
    if (ei == null || ai == null) continue;
    costMatrix[ei][ai] = -pair.score; // Negate for minimization
  }

  // Solve
  const solution = hungarian(costMatrix);

  // Extract assignments, applying thresholds
  const assignments: Assignment[] = [];
  for (let i = 0; i < n; i++) {
    const j = solution[i];
    if (j >= m) continue; // Padded dummy column — unassigned

    const entry = entries[i];
    const appt = appointments[j];

    // Find the scored pair
    const pair = scoreMatrix.find(
      (p) => p.entry_id === entry.entry_id && p.appointment_id === appt.appointment_id
    );
    if (!pair) continue;

    // Apply threshold
    const threshold = pair.is_cross_client
      ? config.min_cross_client_threshold
      : config.min_match_threshold;

    if (pair.score < threshold && pair.signals.cdn_match === 0) continue;

    // Determine confidence and method
    const confidence = determineConfidence(pair);
    const method = determineMethod(pair);

    assignments.push({
      entry_id: entry.entry_id,
      appointment_id: appt.appointment_id,
      score: pair.score,
      signals: pair.signals,
      confidence,
      method,
    });
  }

  return assignments;
}

function determineConfidence(pair: ScoredPair): "high" | "medium" | "low" {
  if (pair.signals.cdn_match > 0) return "high";
  if (pair.score >= 0.60) return "high";
  if (pair.score >= 0.35) return "medium";
  return "low";
}

function determineMethod(pair: ScoredPair): string {
  if (pair.signals.cdn_match > 0) return "cdn_first";
  if (pair.signals.shelter_id > 0) return "shelter_id_bridge";
  if (pair.signals.waiver_chip > 0 || pair.signals.chip_direct > 0) return "waiver_bridge";

  // Determine primary signal
  const weights = pair.is_foster ? FOSTER_WEIGHTS : SIGNAL_WEIGHTS;
  const contributions: [string, number][] = [
    ["owner_name", pair.signals.owner_name * weights.owner_name],
    ["cat_name", pair.signals.cat_name * weights.cat_name],
    ["weight", pair.signals.weight * weights.weight],
    ["sex", Math.max(0, pair.signals.sex) * weights.sex],
  ];
  contributions.sort((a, b) => b[1] - a[1]);

  const primary = contributions[0][0];
  if (primary === "owner_name") return "owner_name";
  if (primary === "cat_name") return "cat_name";
  if (primary === "weight") return "weight_disambiguation";
  return "composite";
}

// ── Hungarian Algorithm ────────────────────────────────────────────────
// O(n³) implementation of the Kuhn-Munkres algorithm.
// Input: n×n cost matrix (minimize).
// Output: assignment[i] = j means row i assigned to column j.

function hungarian(costMatrix: number[][]): number[] {
  const n = costMatrix.length;
  const u = new Float64Array(n + 1); // potential for rows
  const v = new Float64Array(n + 1); // potential for columns
  const p = new Int32Array(n + 1); // assignment: p[j] = i
  const way = new Int32Array(n + 1); // way[j] = prev column in augmenting path

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);

    do {
      used[j0] = 1;
      let i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = costMatrix[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    // Augment path
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  // Convert: p[j] = i → result[i-1] = j-1
  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) {
    if (p[j] > 0) {
      result[p[j] - 1] = j - 1;
    }
  }
  return result;
}

// ── Helper: Cancelled Entry Detection ──────────────────────────────────

async function detectCancelledEntries(clinicDate: string): Promise<number> {
  // Call existing SQL function for header/recheck/notes detection
  const result = await queryOne<{ count: number }>(
    `SELECT ops.detect_cancelled_entries($1) AS count`,
    [clinicDate]
  );
  return result?.count ?? 0;
}

// ── Helper: Clear Auto Matches ─────────────────────────────────────────

async function clearAutoMatches(clinicDate: string): Promise<number> {
  const result = await queryOne<{ count: number }>(
    `WITH cleared AS (
       UPDATE ops.clinic_day_entries e
       SET matched_appointment_id = NULL,
           match_confidence = NULL,
           cds_method = NULL,
           match_score = NULL,
           match_signals = NULL,
           matched_at = NULL,
           cds_run_id = NULL
       FROM ops.clinic_days cd
       WHERE cd.clinic_day_id = e.clinic_day_id
         AND cd.clinic_date = $1
         AND e.match_confidence IS DISTINCT FROM 'manual'
         AND e.matched_appointment_id IS NOT NULL
       RETURNING e.entry_id
     )
     SELECT COUNT(*)::int AS count FROM cleared`,
    [clinicDate]
  );
  return result?.count ?? 0;
}

// ── Helper: Propagate Matches ──────────────────────────────────────────

async function propagateMatches(clinicDate: string): Promise<number> {
  const result = await queryOne<{ count: number }>(
    `SELECT ops.propagate_master_list_matches($1) AS count`,
    [clinicDate]
  );
  return result?.count ?? 0;
}

async function linkCancelledEntriesToCats(clinicDate: string): Promise<void> {
  try {
    await queryOne(
      `SELECT ops.link_cancelled_entries_to_cats($1)`,
      [clinicDate]
    );
  } catch { /* non-fatal */ }
}

// ── Helper: Waiver Cat Rescue ──────────────────────────────────────────

async function rescueCatsFromWaivers(clinicDate: string): Promise<number> {
  // Pass 1: Set cat_id from waiver when waiver has a matched cat (chipped cats)
  const catResult = await queryOne<{ count: number }>(
    `WITH rescued AS (
       UPDATE ops.clinic_day_entries e
       SET cat_id = ws.matched_cat_id
       FROM ops.clinic_days cd,
            ops.waiver_scans ws
       WHERE cd.clinic_day_id = e.clinic_day_id
         AND cd.clinic_date = $1
         AND ws.parsed_date = cd.clinic_date
         AND ws.ocr_clinic_number = e.line_number
         AND ws.matched_cat_id IS NOT NULL
         AND e.cat_id IS NULL
         AND e.matched_appointment_id IS NULL
       RETURNING e.entry_id
     )
     SELECT COUNT(*)::int AS count FROM rescued`,
    [clinicDate]
  );

  // Pass 2: Link waiver_scan_id by CDN match — works for unchipped cats too
  // (kittens taken to foster, wellness-only visits without microchip)
  const waiverResult = await queryOne<{ count: number }>(
    `WITH linked AS (
       UPDATE ops.clinic_day_entries e
       SET waiver_scan_id = ws.waiver_id
       FROM ops.clinic_days cd,
            ops.waiver_scans ws
       WHERE cd.clinic_day_id = e.clinic_day_id
         AND cd.clinic_date = $1
         AND ws.parsed_date = cd.clinic_date
         AND ws.ocr_clinic_number = e.line_number
         AND e.waiver_scan_id IS NULL
       RETURNING e.entry_id
     )
     SELECT COUNT(*)::int AS count FROM linked`,
    [clinicDate]
  );

  return (catResult?.count ?? 0) + (waiverResult?.count ?? 0);
}

// ── Helper: LLM Tiebreaker ─────────────────────────────────────────────

async function runLLMTiebreaker(
  clinicDate: string,
  runId: string,
  config: CDSConfig
): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) return 0;

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
            e.female_count, e.male_count, e.weight_lbs
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
       AND e.matched_appointment_id IS NULL
       AND e.match_confidence IS DISTINCT FROM 'manual'
       AND e.cancellation_reason IS NULL
     ORDER BY e.line_number`,
    [clinicDate]
  );

  if (unmatched.length === 0) return 0;

  const available = await queryRows<{
    appointment_id: string;
    client_name: string | null;
    cat_name: string | null;
    cat_sex: string | null;
    cat_weight: number | null;
    microchip: string | null;
  }>(
    `SELECT a.appointment_id, a.client_name, c.name AS cat_name,
            c.sex AS cat_sex, cv.weight_lbs AS cat_weight,
            c.microchip
     FROM ops.appointments a
     LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
     LEFT JOIN LATERAL (
       SELECT weight_lbs FROM ops.cat_vitals
       WHERE cat_id = a.cat_id ORDER BY recorded_at DESC LIMIT 1
     ) cv ON true
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

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `Match these master list entries to ClinicHQ appointments for a TNR spay/neuter clinic.

ENTRIES (from handwritten master list):
${unmatched.map((e) => `  #${e.line_number}: owner="${e.parsed_owner_name}" cat="${e.parsed_cat_name}" sex=${e.female_count > 0 ? "F" : e.male_count > 0 ? "M" : "?"} weight=${e.weight_lbs ?? "?"}`).join("\n")}

APPOINTMENTS (from ClinicHQ):
${available.map((a) => `  ${a.appointment_id}: client="${a.client_name}" cat="${a.cat_name}" sex=${a.cat_sex} weight=${a.cat_weight ?? "?"} chip=${a.microchip?.slice(-4) ?? "none"}`).join("\n")}

Return JSON array: [{"entry_id": "...", "appointment_id": "...", "confidence": 0.0-1.0, "reasoning": "..."}]
Only include matches with confidence >= ${config.llm_min_confidence}. Names may have typos or phone suffixes.`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: "You are a TNR clinic data matching assistant. Return valid JSON only.",
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return 0;

    const suggestions = JSON.parse(jsonMatch[0]) as Array<{
      entry_id: string;
      appointment_id: string;
      confidence: number;
      reasoning: string;
    }>;

    let count = 0;
    for (const s of suggestions) {
      if (s.confidence < config.llm_min_confidence) continue;
      await execute(
        `UPDATE ops.clinic_day_entries
         SET matched_appointment_id = $1,
             match_confidence = 'low',
             cds_method = 'cds_suggestion',
             match_score = $2,
             cds_llm_reasoning = $3,
             cds_run_id = $4
         WHERE entry_id = $5
           AND matched_appointment_id IS NULL
           AND match_confidence IS DISTINCT FROM 'manual'`,
        [s.appointment_id, s.confidence, s.reasoning, runId, s.entry_id]
      );
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

// ── Helper: Classify Unmatched ─────────────────────────────────────────

async function classifyUnmatchedEntries(
  clinicDate: string,
  config: CDSConfig
): Promise<number> {
  const unmatched = await queryRows<{
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
    was_altered: boolean;
  }>(
    `SELECT e.entry_id, e.line_number, e.parsed_owner_name, e.parsed_cat_name,
            e.raw_client_name, e.notes, e.female_count, e.male_count,
            e.weight_lbs, COALESCE(e.is_recheck, false) AS is_recheck,
            COALESCE(e.is_foster, false) AS is_foster,
            COALESCE(e.was_altered, false) AS was_altered
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
       AND e.matched_appointment_id IS NULL
       AND e.match_confidence IS DISTINCT FROM 'manual'
       AND e.cancellation_reason IS NULL`,
    [clinicDate]
  );

  let classified = 0;
  for (const entry of unmatched) {
    const reason = classifyDeterministic(entry);
    if (reason) {
      await execute(
        `UPDATE ops.clinic_day_entries
         SET cancellation_reason = $1
         WHERE entry_id = $2`,
        [reason, entry.entry_id]
      );
      classified++;
    }
  }

  return classified;
}

type UnmatchedReason =
  | "no_chq_booking"
  | "no_show"
  | "surgery_cancelled"
  | "recheck_no_booking"
  | "too_small";

function classifyDeterministic(entry: {
  notes: string | null;
  is_recheck: boolean;
  weight_lbs: number | null;
  was_altered: boolean;
  female_count: number;
  male_count: number;
}): UnmatchedReason | null {
  const notes = (entry.notes || "").toLowerCase();

  if (notes.includes("no show") || notes.includes("no-show")) return "no_show";
  if (notes.includes("cancel")) return "surgery_cancelled";
  if (notes.includes("too small") || notes.includes("too young")) return "too_small";
  if (entry.is_recheck) return "recheck_no_booking";

  // Has surgery evidence but no booking
  const hasSurgery = entry.was_altered || entry.weight_lbs != null;
  if (hasSurgery) return "no_chq_booking";

  // No surgery evidence, no notes — likely no-show
  if (!hasSurgery && !entry.notes && entry.weight_lbs == null) return "no_show";

  return "no_chq_booking";
}

// ── Data Loaders ───────────────────────────────────────────────────────

async function loadEntries(clinicDate: string): Promise<CDSEntry[]> {
  return queryRows<CDSEntry>(
    `SELECT e.entry_id, e.line_number, e.parsed_owner_name, e.parsed_cat_name,
            e.parsed_cat_color, COALESCE(e.female_count, 0) AS female_count,
            COALESCE(e.male_count, 0) AS male_count, e.weight_lbs,
            e.sx_end_time, COALESCE(e.is_foster, false) AS is_foster,
            COALESCE(e.is_recheck, false) AS is_recheck,
            e.notes, e.raw_client_name,
            e.matched_appointment_id, e.match_confidence, e.cds_method,
            e.cancellation_reason
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
     ORDER BY e.line_number`,
    [clinicDate]
  );
}

async function loadAppointments(clinicDate: string): Promise<CDSAppointment[]> {
  return queryRows<CDSAppointment>(
    `SELECT a.appointment_id, a.appointment_number, a.client_name,
            oa.display_name AS account_owner_name,
            c.name AS cat_name, c.cat_id, c.sex AS cat_sex,
            COALESCE(cv.weight_lbs, a.cat_weight_lbs, c.weight_lbs) AS cat_weight,
            c.microchip, c.color AS cat_color, c.breed AS cat_breed,
            a.appointment_date::text, a.surgery_start_time::text,
            a.clinic_day_number,
            COALESCE(
              (SELECT array_agg(DISTINCT sl.name)
               FROM sot.cat_identifiers ci
               JOIN sot.cats sl ON sl.cat_id = ci.cat_id AND sl.merged_into_cat_id IS NULL
               WHERE ci.cat_id = a.cat_id AND sl.name != c.name AND sl.name IS NOT NULL
              ), ARRAY[]::text[]
            ) AS shelterluv_names
     FROM ops.appointments a
     LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
     LEFT JOIN ops.clinic_accounts oa ON oa.account_id = a.owner_account_id
     LEFT JOIN LATERAL (
       SELECT weight_lbs FROM ops.cat_vitals
       WHERE cat_id = a.cat_id ORDER BY recorded_at DESC LIMIT 1
     ) cv ON true
     WHERE a.appointment_date = $1
       AND a.merged_into_appointment_id IS NULL
     ORDER BY a.appointment_number NULLS LAST`,
    [clinicDate]
  );
}

async function loadWaivers(clinicDate: string): Promise<CDSWaiver[]> {
  return queryRows<CDSWaiver>(
    `SELECT waiver_id, parsed_last_name, parsed_last4_chip,
            parsed_date::text, matched_appointment_id,
            ocr_clinic_number, ocr_microchip, ocr_status,
            ocr_weight_lbs
     FROM ops.waiver_scans
     WHERE parsed_date = $1::date`,
    [clinicDate]
  );
}

async function loadCDSConfig(): Promise<CDSConfig> {
  const getVal = async (key: string, def: string) => {
    const row = await queryOne<{ value: string }>(
      `SELECT value FROM ops.app_config WHERE key = $1`,
      [key]
    );
    return row?.value ?? def;
  };

  return {
    min_match_threshold: parseFloat(await getVal("cds.thresholds.min_match", "0.25")),
    min_cross_client_threshold: parseFloat(await getVal("cds.thresholds.min_cross_client", "0.30")),
    weight_gap_min: parseFloat(await getVal("cds.thresholds.weight_gap_min", "1.0")),
    waiver_bridge_threshold: parseFloat(await getVal("cds.thresholds.waiver_bridge", "0.90")),
    llm_enabled: (await getVal("cds.llm.enabled", "false")) === "true",
    llm_max_calls: parseInt(await getVal("cds.llm.max_calls_per_day", "5")),
    llm_min_confidence: parseFloat(await getVal("cds.llm.min_confidence", "0.70")),
  };
}

// ── CDN Candidate System (kept from v2) ────────────────────────────────
// This is the validate-before-commit system — CDNs proposed by waivers
// are validated against the ML before being written. This is solid
// architecture and doesn't change in v3.

async function buildCDNCandidates(
  clinicDate: string,
  waivers: CDSWaiver[]
): Promise<{ candidates: CDNCandidate[]; suspiciousCdnsRemoved: number }> {
  const candidates: CDNCandidate[] = [];

  // Source 1: chip-matched waivers with OCR clinic numbers
  for (const w of waivers) {
    if (
      w.ocr_status === "extracted" &&
      w.ocr_clinic_number != null &&
      w.matched_appointment_id != null
    ) {
      candidates.push({
        appointment_id: w.matched_appointment_id,
        cdn: w.ocr_clinic_number,
        source: "waiver_chip",
        waiver_id: w.waiver_id,
        confidence: 0.95,
      });
    }
  }

  // Source 2: weight bridge dry-run
  try {
    const weightCandidates = await queryRows<{
      appointment_id: string;
      cdn: number;
      waiver_id: string;
      score: number;
    }>(
      `SELECT * FROM ops.bridge_waivers_by_weight_candidates($1)`,
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
  } catch { /* non-fatal — function may not exist */ }

  // Suspicious CDN detection: 3+ different appointments claiming same CDN
  let suspiciousCdnsRemoved = 0;
  const cdnCounts = new Map<number, Set<string>>();
  for (const c of candidates) {
    const set = cdnCounts.get(c.cdn) || new Set();
    set.add(c.appointment_id);
    cdnCounts.set(c.cdn, set);
  }
  const suspiciousCdns = new Set<number>();
  cdnCounts.forEach((appts, cdn) => {
    if (appts.size >= 3) suspiciousCdns.add(cdn);
  });
  const cleaned = candidates.filter((c) => {
    if (suspiciousCdns.has(c.cdn)) {
      suspiciousCdnsRemoved++;
      return false;
    }
    return true;
  });

  return { candidates: cleaned, suspiciousCdnsRemoved };
}

function validateCDNCandidates(
  candidates: CDNCandidate[],
  entries: CDSEntry[],
  appointments: CDSAppointment[]
): { verified: CDNCandidate[]; rejected: CDNCandidate[] } {
  const verified: CDNCandidate[] = [];
  const rejected: CDNCandidate[] = [];

  // Bidirectional dedup: keep highest confidence per CDN and per appointment
  const bestByCdn = new Map<number, CDNCandidate>();
  const bestByAppt = new Map<string, CDNCandidate>();

  for (const c of candidates) {
    const existingCdn = bestByCdn.get(c.cdn);
    if (!existingCdn || c.confidence > existingCdn.confidence) {
      bestByCdn.set(c.cdn, c);
    }

    const existingAppt = bestByAppt.get(c.appointment_id);
    if (!existingAppt || c.confidence > existingAppt.confidence) {
      bestByAppt.set(c.appointment_id, c);
    }
  }

  // Verify each candidate
  for (const c of candidates) {
    // Check it's the best for both its CDN and its appointment
    if (
      bestByCdn.get(c.cdn) !== c ||
      bestByAppt.get(c.appointment_id) !== c
    ) {
      rejected.push(c);
      continue;
    }

    // Check CDN maps to a real entry
    const entry = entries.find((e) => e.line_number === c.cdn);
    if (!entry) {
      rejected.push(c);
      continue;
    }

    // Check appointment exists
    const appt = appointments.find((a) => a.appointment_id === c.appointment_id);
    if (!appt) {
      rejected.push(c);
      continue;
    }

    // Owner name sanity check (unless foster)
    if (entry.parsed_owner_name && appt.client_name) {
      const isFoster =
        entry.is_foster ||
        (appt.client_name || "").toLowerCase().includes("foster");

      if (!isFoster) {
        const sim = stringSimilarity(
          normalizeForGrouping(entry.parsed_owner_name),
          normalizeForGrouping(appt.client_name)
        );
        // Very low bar — just checking it's not completely wrong
        if (sim < 0.15) {
          // First name fallback
          const entryFirst = (entry.parsed_owner_name || "").split(/\s+/)[0]?.toLowerCase();
          const apptFirst = (appt.client_name || "").split(/\s+/)[0]?.toLowerCase();
          if (!entryFirst || !apptFirst || !apptFirst.includes(entryFirst)) {
            rejected.push(c);
            continue;
          }
        }
      }
    }

    verified.push(c);
  }

  return { verified, rejected };
}

async function commitVerifiedCDNs(
  verified: CDNCandidate[],
  clinicDate: string
): Promise<number> {
  let committed = 0;
  for (const c of verified) {
    try {
      const result = await queryOne<{ success: boolean }>(
        `SELECT ops.set_clinic_day_number($1, $2, 'waiver_ocr'::ops.clinic_day_number_source, NULL) AS success`,
        [c.appointment_id, c.cdn]
      );
      if (result?.success) committed++;
    } catch { /* collision or manual override — expected */ }
  }
  return committed;
}

// ── Dedup (kept from v2) ───────────────────────────────────────────────

async function dedupeAppointments(
  clinicDate: string
): Promise<{ merged: number; details: Record<string, unknown> }> {
  // Find duplicate appointments (same microchip, same date)
  const dupes = await queryRows<{
    microchip: string;
    appointment_ids: string[];
  }>(
    `SELECT c.microchip, array_agg(a.appointment_id ORDER BY
       (a.appointment_number IS NOT NULL) DESC,
       (a.client_name IS NOT NULL) DESC,
       a.appointment_number NULLS LAST,
       a.created_at
     ) AS appointment_ids
     FROM ops.appointments a
     JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
     WHERE a.appointment_date = $1
       AND a.merged_into_appointment_id IS NULL
       AND c.microchip IS NOT NULL
     GROUP BY c.microchip
     HAVING COUNT(*) > 1`,
    [clinicDate]
  );

  let merged = 0;
  for (const { appointment_ids } of dupes) {
    const [winnerId, ...loserIds] = appointment_ids;
    for (const loserId of loserIds) {
      try {
        // Re-point entries
        await execute(
          `UPDATE ops.clinic_day_entries
           SET matched_appointment_id = $1
           WHERE matched_appointment_id = $2`,
          [winnerId, loserId]
        );
        // Soft merge
        await execute(
          `UPDATE ops.appointments
           SET merged_into_appointment_id = $1, merged_at = NOW()
           WHERE appointment_id = $2`,
          [winnerId, loserId]
        );
        merged++;
      } catch { /* non-fatal */ }
    }
  }

  return { merged, details: { groups: dupes.length } };
}

// ── Finalize ───────────────────────────────────────────────────────────

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

// ── String Utilities ───────────────────────────────────────────────────

function normalizeForGrouping(name: string | null): string {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function normalizeNameAggressive(name: string | null): string {
  if (!name) return "";
  let n = name;
  // Strip phone suffixes: "Name - call 707-555-1234"
  n = n.replace(/\s*[-–]\s*(call|phone|cell|text)\s*.*/i, "");
  // Strip trapper aliases: "Name - Trp Christina"
  n = n.replace(/\s*[-–]\s*trp\s.*/i, "");
  // Strip parenthetical notes: "Name (updates)"
  n = n.replace(/\s*\(.*?\)\s*/g, " ");
  // Strip honorifics
  n = n.replace(/\b(jr|sr|iii|ii|iv)\b/gi, "");
  // Strip address prefix: "1234 Street - Name"
  n = n.replace(/^\d+\s+\w+\s+(st|dr|rd|ave|ln|ct|way|blvd)\b[.\s]*[-–]\s*/i, "");
  return n.trim();
}

function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const triA = trigrams(a);
  const triB = trigrams(b);
  let intersection = 0;
  triA.forEach((t) => {
    if (triB.has(t)) intersection++;
  });
  const union = triA.size + triB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const result = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    result.add(padded.slice(i, i + 3));
  }
  return result;
}

function scoreNameTokensFuzzy(a: string, b: string): number {
  if (!a || !b) return 0;
  const tokensA = a.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const tokensB = b.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  let totalScore = 0;
  let matches = 0;

  for (const ta of tokensA) {
    let bestScore = 0;
    for (const tb of tokensB) {
      const maxLen = Math.max(ta.length, tb.length);
      if (maxLen === 0) continue;
      const dist = levenshtein(ta, tb);
      const score = 1 - dist / maxLen;
      bestScore = Math.max(bestScore, score);
    }
    if (bestScore >= 0.65) {
      totalScore += bestScore;
      matches++;
    }
  }

  if (matches === 0) return 0;
  return totalScore / Math.max(tokensA.length, tokensB.length);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function extractLastName(name: string): string | null {
  if (!name) return null;
  const cleaned = normalizeNameAggressive(name);
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 1);
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

// ── Exports for testing / benchmarking ─────────────────────────────────

export { buildScoreMatrix, solveAssignment, hungarian, SIGNAL_WEIGHTS, FOSTER_WEIGHTS };
export type { CDSEntry, CDSAppointment, CDSWaiver, CDSConfig, ScoredPair, Assignment, SignalBreakdown };

// ── Re-exports for API compatibility ───────────────────────────────────

export { classifyUnmatchedEntries };

export async function reviewCDSSuggestion(
  entryId: string,
  action: "accept" | "reject",
  alternateAppointmentId?: string
): Promise<void> {
  if (action === "accept") {
    await execute(
      `UPDATE ops.clinic_day_entries
       SET match_confidence = 'manual', cds_method = 'manual', match_reason = 'cds_accepted'
       WHERE entry_id = $1 AND cds_method = 'cds_suggestion'`,
      [entryId]
    );
  } else if (action === "reject" && alternateAppointmentId) {
    await execute(
      `UPDATE ops.clinic_day_entries
       SET matched_appointment_id = $2, match_confidence = 'manual', cds_method = 'manual',
           match_reason = 'cds_rejected_manual_override', matched_at = NOW()
       WHERE entry_id = $1`,
      [entryId, alternateAppointmentId]
    );
  } else {
    await execute(
      `UPDATE ops.clinic_day_entries
       SET matched_appointment_id = NULL, match_confidence = NULL, match_reason = NULL,
           match_score = NULL, match_signals = NULL, matched_at = NULL,
           cds_method = NULL, cds_llm_reasoning = NULL
       WHERE entry_id = $1 AND cds_method = 'cds_suggestion'`,
      [entryId]
    );
  }
}

export async function hasClinicDayEntries(clinicDate: string): Promise<boolean> {
  const result = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM ops.clinic_day_entries e
       JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
       WHERE cd.clinic_date = $1
     ) AS exists`,
    [clinicDate]
  );
  return result?.exists ?? false;
}

export async function getLatestCDSRun(clinicDate: string) {
  return queryOne<CDSRunResult & { triggered_by: string; started_at: string; completed_at: string | null }>(
    `SELECT run_id, clinic_date::text, total_entries, matched_before,
            matched_after, manual_preserved, llm_suggestions,
            unmatched_remaining, has_waivers, has_weights,
            phase_results AS phases,
            triggered_by, started_at::text, completed_at::text
     FROM ops.cds_runs
     WHERE clinic_date = $1
     ORDER BY started_at DESC
     LIMIT 1`,
    [clinicDate]
  );
}
