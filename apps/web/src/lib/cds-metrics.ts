/**
 * CDS Metrics — Shared data layer for benchmark + verification reports
 *
 * Compares CDS automated matches against ground truth (Ben's 508 manual
 * clinic_day_number assignments, flagged by MIG_3082).
 *
 * Ground truth key: line_number (master list) = clinic_day_number (appointment)
 * An appointment is "ground truth" when manually_overridden_fields @> '{clinic_day_number}'
 */

import { queryRows, queryOne } from "@/lib/db";

// ── Types ──────────────────────────────────────────────────────────────

export interface MatchPair {
  line_number: number;
  entry_id: string;
  parsed_owner_name: string | null;
  cds_appointment_id: string | null;
  cds_method: string | null;
  ground_truth_appointment_id: string | null;
  agreement: "agree" | "disagree" | "cds_unmatched" | "gt_unmatched";
}

export interface GapEntry {
  line_number: number;
  parsed_owner_name: string | null;
  type: "sx_cancelled" | "cross_date" | "no_appointment" | "foster_rename" | "dedup_merged";
  detail: string | null;
}

export interface CancelledEntryRow {
  line_number: number;
  parsed_owner_name: string | null;
  appointment_number: string | null;
  reason: string;
}

export interface DateMetrics {
  date: string;
  entries: {
    total: number;
    matched: number;
    unmatched: number;
    manual: number;
  };
  appointments: {
    total: number;
    with_cdn: number;
    ground_truth_count: number;
  };
  pairs: MatchPair[];
  agreement: {
    total_pairs: number;
    agree: number;
    disagree: number;
    cds_unmatched: number;
  };
  gaps: GapEntry[];
  cancelled: CancelledEntryRow[];
}

export interface MethodAccuracy {
  agree: number;
  disagree: number;
}

export interface AggregateMetrics {
  dates_with_ground_truth: number;
  total_pairs: number;
  agree: number;
  disagree: number;
  cds_unmatched: number;
  agreement_rate_pct: number;
  by_method: Record<string, MethodAccuracy>;
  per_date: Array<{
    date: string;
    pairs: number;
    agree: number;
    disagree: number;
    cds_unmatched: number;
    agreement_rate_pct: number;
  }>;
}

// ── Single-date metrics ────────────────────────────────────────────────

export async function loadCDSMetricsForDate(date: string): Promise<DateMetrics> {
  // 1. Load entries for this date
  const entries = await queryRows<{
    entry_id: string;
    line_number: number;
    parsed_owner_name: string | null;
    matched_appointment_id: string | null;
    match_confidence: string | null;
    cds_method: string | null;
  }>(`
    SELECT e.entry_id, e.line_number, e.parsed_owner_name,
           e.matched_appointment_id, e.match_confidence, e.cds_method
    FROM ops.clinic_day_entries e
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE cd.clinic_date = $1
    ORDER BY e.line_number
  `, [date]);

  // 2. Load ground truth appointments (manually assigned clinic_day_number)
  const groundTruthAppts = await queryRows<{
    appointment_id: string;
    clinic_day_number: number;
    appointment_number: string | null;
    client_name: string | null;
  }>(`
    SELECT appointment_id, clinic_day_number, appointment_number, client_name
    FROM ops.appointments
    WHERE appointment_date = $1
      AND merged_into_appointment_id IS NULL
      AND clinic_day_number IS NOT NULL
      AND manually_overridden_fields @> ARRAY['clinic_day_number']
  `, [date]);

  // 3. All appointments for counts
  const apptCounts = await queryOne<{
    total: number;
    with_cdn: number;
  }>(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE clinic_day_number IS NOT NULL)::int AS with_cdn
    FROM ops.appointments
    WHERE appointment_date = $1
      AND merged_into_appointment_id IS NULL
  `, [date]);

  // 4. Build ground truth lookup: line_number → appointment_id
  const gtByLine = new Map<number, string>();
  for (const gt of groundTruthAppts) {
    gtByLine.set(gt.clinic_day_number, gt.appointment_id);
  }

  // 5. Build match pairs
  const pairs: MatchPair[] = [];
  let agree = 0;
  let disagree = 0;
  let cdsUnmatched = 0;

  for (const entry of entries) {
    const gtApptId = gtByLine.get(entry.line_number) ?? null;

    // Only create pair if there's ground truth for this line
    if (!gtApptId) continue;

    let agreement: MatchPair["agreement"];
    if (!entry.matched_appointment_id) {
      agreement = "cds_unmatched";
      cdsUnmatched++;
    } else if (entry.matched_appointment_id === gtApptId) {
      agreement = "agree";
      agree++;
    } else {
      agreement = "disagree";
      disagree++;
    }

    pairs.push({
      line_number: entry.line_number,
      entry_id: entry.entry_id,
      parsed_owner_name: entry.parsed_owner_name,
      cds_appointment_id: entry.matched_appointment_id,
      cds_method: entry.cds_method,
      ground_truth_appointment_id: gtApptId,
      agreement,
    });
  }

  // 6. Classify gaps — entries that are unmatched and NOT in ground truth
  const gaps: GapEntry[] = [];
  for (const entry of entries) {
    if (entry.matched_appointment_id) continue;
    if (gtByLine.has(entry.line_number)) continue; // already covered by pairs

    gaps.push({
      line_number: entry.line_number,
      parsed_owner_name: entry.parsed_owner_name,
      type: "no_appointment",
      detail: null,
    });
  }

  // 7. Extract cancelled entries from latest CDS run phase_results
  const cancelled = await loadCancelledEntries(date);

  // Update gap types for cancelled entries
  const cancelledLines = new Set(cancelled.map((c) => c.line_number));
  for (const gap of gaps) {
    if (cancelledLines.has(gap.line_number)) {
      gap.type = "sx_cancelled";
      gap.detail = cancelled.find((c) => c.line_number === gap.line_number)?.reason ?? null;
    }
  }

  const totalEntries = entries.length;
  const matchedEntries = entries.filter(
    (e) => e.matched_appointment_id && e.match_confidence !== "unmatched"
  ).length;
  const manualEntries = entries.filter(
    (e) => e.match_confidence === "manual"
  ).length;

  return {
    date,
    entries: {
      total: totalEntries,
      matched: matchedEntries,
      unmatched: totalEntries - matchedEntries,
      manual: manualEntries,
    },
    appointments: {
      total: apptCounts?.total ?? 0,
      with_cdn: apptCounts?.with_cdn ?? 0,
      ground_truth_count: groundTruthAppts.length,
    },
    pairs,
    agreement: {
      total_pairs: pairs.length,
      agree,
      disagree,
      cds_unmatched: cdsUnmatched,
    },
    gaps,
    cancelled,
  };
}

// ── Cancelled entries from CDS run ────────────────────────────────────

export async function loadCancelledEntries(date: string): Promise<CancelledEntryRow[]> {
  const run = await queryOne<{
    phase_results: Array<{
      phase: string;
      details?: {
        cancelled_entries?: Array<{
          line: number;
          owner: string | null;
          number: string | null;
          reason: string;
        }>;
      };
    }>;
  }>(`
    SELECT phase_results
    FROM ops.cds_runs
    WHERE clinic_date = $1
      AND completed_at IS NOT NULL
    ORDER BY started_at DESC
    LIMIT 1
  `, [date]);

  if (!run?.phase_results) return [];

  // cancelled_entries are stored in composite phase details
  const compositePhase = run.phase_results.find(
    (p) => p.phase === "7_composite" || p.phase === "4_composite"
  );
  const raw = compositePhase?.details?.cancelled_entries ?? [];

  return raw.map((c) => ({
    line_number: c.line,
    parsed_owner_name: c.owner,
    appointment_number: c.number,
    reason: c.reason,
  }));
}

// ── Aggregate metrics across all ground truth dates ───────────────────

export async function loadCDSMetricsAggregate(): Promise<AggregateMetrics> {
  // Find all dates that have ground truth (manually assigned clinic_day_numbers)
  const dates = await queryRows<{ clinic_date: string }>(`
    SELECT DISTINCT cd.clinic_date::text AS clinic_date
    FROM ops.clinic_day_entries e
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE EXISTS (
      SELECT 1 FROM ops.appointments a
      WHERE a.appointment_date = cd.clinic_date
        AND a.merged_into_appointment_id IS NULL
        AND a.clinic_day_number IS NOT NULL
        AND a.manually_overridden_fields @> ARRAY['clinic_day_number']
    )
    ORDER BY cd.clinic_date
  `);

  const byMethod: Record<string, MethodAccuracy> = {};
  const perDate: AggregateMetrics["per_date"] = [];
  let totalPairs = 0;
  let totalAgree = 0;
  let totalDisagree = 0;
  let totalCdsUnmatched = 0;

  for (const { clinic_date } of dates) {
    const metrics = await loadCDSMetricsForDate(clinic_date);

    totalPairs += metrics.agreement.total_pairs;
    totalAgree += metrics.agreement.agree;
    totalDisagree += metrics.agreement.disagree;
    totalCdsUnmatched += metrics.agreement.cds_unmatched;

    // Per-method breakdown
    for (const pair of metrics.pairs) {
      if (!pair.cds_method) continue;
      if (!byMethod[pair.cds_method]) {
        byMethod[pair.cds_method] = { agree: 0, disagree: 0 };
      }
      if (pair.agreement === "agree") {
        byMethod[pair.cds_method].agree++;
      } else if (pair.agreement === "disagree") {
        byMethod[pair.cds_method].disagree++;
      }
    }

    perDate.push({
      date: clinic_date,
      pairs: metrics.agreement.total_pairs,
      agree: metrics.agreement.agree,
      disagree: metrics.agreement.disagree,
      cds_unmatched: metrics.agreement.cds_unmatched,
      agreement_rate_pct:
        metrics.agreement.total_pairs > 0
          ? Math.round(
              (metrics.agreement.agree / metrics.agreement.total_pairs) * 1000
            ) / 10
          : 0,
    });
  }

  return {
    dates_with_ground_truth: dates.length,
    total_pairs: totalPairs,
    agree: totalAgree,
    disagree: totalDisagree,
    cds_unmatched: totalCdsUnmatched,
    agreement_rate_pct:
      totalPairs > 0
        ? Math.round((totalAgree / totalPairs) * 1000) / 10
        : 0,
    by_method: byMethod,
    per_date: perDate,
  };
}
