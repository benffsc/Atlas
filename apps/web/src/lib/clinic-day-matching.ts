/**
 * Clinic Day Composite Matching Engine
 *
 * Multi-signal scoring system for matching master list entries to ClinicHQ appointments.
 * Runs AFTER the existing SQL passes (MIG_2330), catching what they miss —
 * especially within-client-group disambiguation when one owner has multiple cats.
 *
 * Signal weights:
 *   client_name  0.40  — already established by client grouping
 *   cat_name     0.25  — fuzzy similarity on parsed_cat_name vs cat.name
 *   sex          0.10  — entry F/M matches cat sex
 *   weight       0.10  — abs(entry.weight - cat_weight) < 1.0 lbs
 *   chip4        0.10  — waiver with matching last name + date has same chip4
 *   time_order   0.05  — relative surgery time ordering preserved within group
 *
 * MIG_3043 adds the columns this engine writes to.
 */

import { queryRows, queryOne, execute } from "@/lib/db";

// ── Types ──────────────────────────────────────────────────────────────

interface ClinicDayEntry {
  entry_id: string;
  line_number: number;
  parsed_owner_name: string | null;
  parsed_cat_name: string | null;
  female_count: number;
  male_count: number;
  weight_lbs: number | null;
  sx_end_time: string | null;
  // Already matched by SQL passes
  matched_appointment_id: string | null;
  match_confidence: string | null;
}

interface Appointment {
  appointment_id: string;
  client_name: string | null;
  cat_id: string | null;
  cat_name: string | null;
  cat_sex: string | null;
  cat_weight: number | null;
  microchip: string | null;
  appointment_date: string;
}

interface WaiverInfo {
  waiver_id: string;
  parsed_last_name: string | null;
  parsed_last4_chip: string | null;
  matched_appointment_id: string | null;
}

interface ScoredPair {
  entry_id: string;
  appointment_id: string;
  score: number;
  signals: Record<string, number>;
}

export interface MatchResult {
  total_entries: number;
  already_matched: number;
  newly_matched: number;
  unmatched: number;
  pairs: Array<{
    entry_id: string;
    appointment_id: string;
    score: number;
    signals: Record<string, number>;
  }>;
}

// ── Main entry point ───────────────────────────────────────────────────

export async function runClinicDayMatching(
  clinicDate: string
): Promise<MatchResult> {
  // 1. Load entries, appointments, and waivers for this date
  const [entries, appointments, waivers] = await Promise.all([
    loadEntries(clinicDate),
    loadAppointments(clinicDate),
    loadWaivers(clinicDate),
  ]);

  const result: MatchResult = {
    total_entries: entries.length,
    already_matched: 0,
    newly_matched: 0,
    unmatched: 0,
    pairs: [],
  };

  if (entries.length === 0 || appointments.length === 0) {
    result.unmatched = entries.length;
    return result;
  }

  // 2. Separate already-matched (by SQL passes) from unmatched
  const unmatchedEntries: ClinicDayEntry[] = [];
  const usedAppointmentIds = new Set<string>();

  for (const entry of entries) {
    if (entry.matched_appointment_id && entry.match_confidence !== "unmatched") {
      result.already_matched++;
      usedAppointmentIds.add(entry.matched_appointment_id);
    } else {
      unmatchedEntries.push(entry);
    }
  }

  if (unmatchedEntries.length === 0) {
    return result;
  }

  const availableAppointments = appointments.filter(
    (a) => !usedAppointmentIds.has(a.appointment_id)
  );

  if (availableAppointments.length === 0) {
    result.unmatched = unmatchedEntries.length;
    return result;
  }

  // 3. Build waiver chip4 lookup
  const waiverByAppointment = new Map<string, WaiverInfo>();
  for (const w of waivers) {
    if (w.matched_appointment_id) {
      waiverByAppointment.set(w.matched_appointment_id, w);
    }
  }

  // 4. Group entries by owner name for within-client disambiguation
  const entryGroups = groupByOwner(unmatchedEntries);
  const appointmentGroups = groupAppointmentsByClient(availableAppointments);

  // 5. Score within matching client groups first
  const allPairs: ScoredPair[] = [];
  const matchedEntryIds = new Set<string>();
  const matchedApptIds = new Set<string>();

  for (const [ownerKey, groupEntries] of entryGroups) {
    // Find matching appointment group
    const matchingApptGroup = findMatchingClientGroup(
      ownerKey,
      appointmentGroups
    );

    if (matchingApptGroup) {
      const pairs = scoreWithinGroup(
        groupEntries,
        matchingApptGroup,
        waiverByAppointment
      );
      allPairs.push(...pairs);
    }
  }

  // 6. Greedy assignment — sort by score descending, assign without conflicts
  allPairs.sort((a, b) => b.score - a.score);

  const assignedPairs: ScoredPair[] = [];
  for (const pair of allPairs) {
    if (matchedEntryIds.has(pair.entry_id) || matchedApptIds.has(pair.appointment_id)) {
      continue;
    }
    // Minimum threshold — don't assign garbage matches
    if (pair.score < 0.30) continue;

    assignedPairs.push(pair);
    matchedEntryIds.add(pair.entry_id);
    matchedApptIds.add(pair.appointment_id);
  }

  // 7. Cross-client fallback for remaining unmatched
  const stillUnmatched = unmatchedEntries.filter(
    (e) => !matchedEntryIds.has(e.entry_id)
  );
  const stillAvailable = availableAppointments.filter(
    (a) => !matchedApptIds.has(a.appointment_id)
  );

  if (stillUnmatched.length > 0 && stillAvailable.length > 0) {
    const crossPairs = scoreCrossClient(
      stillUnmatched,
      stillAvailable,
      waiverByAppointment
    );
    crossPairs.sort((a, b) => b.score - a.score);

    for (const pair of crossPairs) {
      if (matchedEntryIds.has(pair.entry_id) || matchedApptIds.has(pair.appointment_id)) {
        continue;
      }
      if (pair.score < 0.35) continue; // Higher threshold for cross-client

      assignedPairs.push(pair);
      matchedEntryIds.add(pair.entry_id);
      matchedApptIds.add(pair.appointment_id);
    }
  }

  // 8. Write results to database
  for (const pair of assignedPairs) {
    await writeMatch(pair);
  }

  result.newly_matched = assignedPairs.length;
  result.unmatched = unmatchedEntries.length - assignedPairs.length;
  result.pairs = assignedPairs;

  return result;
}

// ── Data loaders ───────────────────────────────────────────────────────

async function loadEntries(clinicDate: string): Promise<ClinicDayEntry[]> {
  return queryRows<ClinicDayEntry>(
    `SELECT
       e.entry_id,
       e.line_number,
       e.parsed_owner_name,
       e.parsed_cat_name,
       e.female_count,
       e.male_count,
       e.weight_lbs,
       e.sx_end_time::text as sx_end_time,
       e.matched_appointment_id,
       e.match_confidence
     FROM ops.clinic_day_entries e
     JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
     WHERE cd.clinic_date = $1
     ORDER BY e.line_number`,
    [clinicDate]
  );
}

async function loadAppointments(clinicDate: string): Promise<Appointment[]> {
  return queryRows<Appointment>(
    `SELECT
       a.appointment_id,
       a.client_name,
       a.cat_id,
       c.name as cat_name,
       c.sex as cat_sex,
       cv.weight_lbs as cat_weight,
       ci.id_value as microchip,
       a.appointment_date::text as appointment_date
     FROM ops.appointments a
     LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
     LEFT JOIN LATERAL (
       SELECT weight_lbs FROM ops.cat_vitals
       WHERE cat_id = a.cat_id
       ORDER BY recorded_at DESC LIMIT 1
     ) cv ON true
     LEFT JOIN sot.cat_identifiers ci
       ON ci.cat_id = a.cat_id
       AND ci.id_type = 'microchip'
     WHERE a.appointment_date = $1
       AND a.merged_into_appointment_id IS NULL`,
    [clinicDate]
  );
}

async function loadWaivers(clinicDate: string): Promise<WaiverInfo[]> {
  return queryRows<WaiverInfo>(
    `SELECT
       waiver_id,
       parsed_last_name,
       parsed_last4_chip,
       matched_appointment_id
     FROM ops.waiver_scans
     WHERE parsed_date = $1
       AND parsed_last4_chip IS NOT NULL`,
    [clinicDate]
  );
}

// ── Grouping helpers ───────────────────────────────────────────────────

function normalizeForGrouping(name: string | null): string {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function groupByOwner(
  entries: ClinicDayEntry[]
): Map<string, ClinicDayEntry[]> {
  const groups = new Map<string, ClinicDayEntry[]>();
  for (const entry of entries) {
    const key = normalizeForGrouping(entry.parsed_owner_name);
    if (!key) {
      // Entries with no owner go into a special group
      const existing = groups.get("__no_owner__") || [];
      existing.push(entry);
      groups.set("__no_owner__", existing);
      continue;
    }
    const existing = groups.get(key) || [];
    existing.push(entry);
    groups.set(key, existing);
  }
  return groups;
}

function groupAppointmentsByClient(
  appointments: Appointment[]
): Map<string, Appointment[]> {
  const groups = new Map<string, Appointment[]>();
  for (const appt of appointments) {
    const key = normalizeForGrouping(appt.client_name);
    if (!key) {
      const existing = groups.get("__no_client__") || [];
      existing.push(appt);
      groups.set("__no_client__", existing);
      continue;
    }
    const existing = groups.get(key) || [];
    existing.push(appt);
    groups.set(key, existing);
  }
  return groups;
}

function findMatchingClientGroup(
  ownerKey: string,
  appointmentGroups: Map<string, Appointment[]>
): Appointment[] | null {
  if (ownerKey === "__no_owner__") return null;

  // Exact normalized match
  if (appointmentGroups.has(ownerKey)) {
    return appointmentGroups.get(ownerKey)!;
  }

  // Fuzzy: find best substring/similarity match among appointment groups
  let bestKey: string | null = null;
  let bestSim = 0;

  for (const clientKey of appointmentGroups.keys()) {
    if (clientKey === "__no_client__") continue;
    const sim = stringSimilarity(ownerKey, clientKey);
    if (sim > bestSim && sim > 0.6) {
      bestSim = sim;
      bestKey = clientKey;
    }
  }

  return bestKey ? appointmentGroups.get(bestKey)! : null;
}

// ── Scoring ────────────────────────────────────────────────────────────

function scoreWithinGroup(
  entries: ClinicDayEntry[],
  appointments: Appointment[],
  waiverByAppointment: Map<string, WaiverInfo>
): ScoredPair[] {
  const pairs: ScoredPair[] = [];

  for (const entry of entries) {
    for (const appt of appointments) {
      const signals: Record<string, number> = {};
      let score = 0;

      // Client name match — already established by grouping (0.40)
      signals.client_name = 0.4;
      score += 0.4;

      // Cat name similarity (0.25 max)
      const catNameScore = scoreCatName(entry.parsed_cat_name, appt.cat_name);
      signals.cat_name = +(catNameScore * 0.25).toFixed(3);
      score += signals.cat_name;

      // Sex match (0.10)
      const sexScore = scoreSex(entry, appt.cat_sex);
      signals.sex = +(sexScore * 0.1).toFixed(3);
      score += signals.sex;

      // Weight match (0.10)
      const weightScore = scoreWeight(entry.weight_lbs, appt.cat_weight);
      signals.weight = +(weightScore * 0.1).toFixed(3);
      score += signals.weight;

      // Chip4 via waiver (0.10)
      const chip4Score = scoreChip4(entry, appt, waiverByAppointment);
      signals.chip4 = +(chip4Score * 0.1).toFixed(3);
      score += signals.chip4;

      // Surgery time order (0.05) — only useful when we have sx_end_time
      // For now, just give a small bonus if line_number ordering is consistent
      signals.time_order = 0;

      pairs.push({
        entry_id: entry.entry_id,
        appointment_id: appt.appointment_id,
        score: +score.toFixed(3),
        signals,
      });
    }
  }

  return pairs;
}

function scoreCrossClient(
  entries: ClinicDayEntry[],
  appointments: Appointment[],
  waiverByAppointment: Map<string, WaiverInfo>
): ScoredPair[] {
  const pairs: ScoredPair[] = [];

  for (const entry of entries) {
    for (const appt of appointments) {
      const signals: Record<string, number> = {};
      let score = 0;

      // Client name — fuzzy match (not pre-grouped, so score it)
      const clientScore = scoreClientName(
        entry.parsed_owner_name,
        appt.client_name
      );
      signals.client_name = +(clientScore * 0.4).toFixed(3);
      score += signals.client_name;

      // Cat name
      const catNameScore = scoreCatName(entry.parsed_cat_name, appt.cat_name);
      signals.cat_name = +(catNameScore * 0.25).toFixed(3);
      score += signals.cat_name;

      // Sex
      const sexScore = scoreSex(entry, appt.cat_sex);
      signals.sex = +(sexScore * 0.1).toFixed(3);
      score += signals.sex;

      // Weight
      const weightScore = scoreWeight(entry.weight_lbs, appt.cat_weight);
      signals.weight = +(weightScore * 0.1).toFixed(3);
      score += signals.weight;

      // Chip4
      const chip4Score = scoreChip4(entry, appt, waiverByAppointment);
      signals.chip4 = +(chip4Score * 0.1).toFixed(3);
      score += signals.chip4;

      signals.time_order = 0;

      pairs.push({
        entry_id: entry.entry_id,
        appointment_id: appt.appointment_id,
        score: +score.toFixed(3),
        signals,
      });
    }
  }

  return pairs;
}

// ── Individual signal scorers ──────────────────────────────────────────

function scoreCatName(
  entryName: string | null,
  apptCatName: string | null
): number {
  if (!entryName || !apptCatName) return 0;
  const sim = stringSimilarity(
    entryName.toLowerCase(),
    apptCatName.toLowerCase()
  );
  // Return 1.0 if similarity > 0.5, scaled between 0.5-1.0 range
  return sim > 0.5 ? sim : 0;
}

function scoreClientName(
  ownerName: string | null,
  clientName: string | null
): number {
  if (!ownerName || !clientName) return 0;
  return stringSimilarity(
    ownerName.toLowerCase(),
    clientName.toLowerCase()
  );
}

function scoreSex(entry: ClinicDayEntry, catSex: string | null): number {
  if (!catSex) return 0;
  const catIsFemale = catSex.toLowerCase() === "female" || catSex.toLowerCase() === "f";
  const catIsMale = catSex.toLowerCase() === "male" || catSex.toLowerCase() === "m";

  if (entry.female_count > 0 && catIsFemale) return 1;
  if (entry.male_count > 0 && catIsMale) return 1;
  // Sex mismatch is a negative signal
  if (entry.female_count > 0 && catIsMale) return -1;
  if (entry.male_count > 0 && catIsFemale) return -1;
  return 0;
}

function scoreWeight(
  entryWeight: number | null,
  catWeight: number | null
): number {
  if (entryWeight == null || catWeight == null) return 0;
  const diff = Math.abs(entryWeight - catWeight);
  if (diff < 0.5) return 1.0; // Very close — strong match
  if (diff < 1.0) return 0.7; // Close enough
  if (diff < 2.0) return 0.3; // Marginal
  return 0; // Too different
}

function scoreChip4(
  entry: ClinicDayEntry,
  appt: Appointment,
  waiverByAppointment: Map<string, WaiverInfo>
): number {
  if (!appt.microchip) return 0;

  const waiver = waiverByAppointment.get(appt.appointment_id);
  if (!waiver || !waiver.parsed_last4_chip) return 0;

  // Check if the waiver's chip4 matches the appointment's microchip last 4
  const apptChip4 = appt.microchip.slice(-4);
  if (waiver.parsed_last4_chip !== apptChip4) return 0;

  // Bonus: check if waiver last name matches entry owner name
  if (
    waiver.parsed_last_name &&
    entry.parsed_owner_name
  ) {
    const waiverLast = waiver.parsed_last_name.toLowerCase();
    const ownerName = entry.parsed_owner_name.toLowerCase();
    if (ownerName.includes(waiverLast) || waiverLast.includes(ownerName)) {
      return 1.0; // Strong chip4 + name match
    }
  }

  return 0.5; // Chip4 matches but name doesn't confirm
}

// ── String similarity (trigram-based) ──────────────────────────────────

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const result = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    result.add(padded.substring(i, i + 3));
  }
  return result;
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

// ── Database write ─────────────────────────────────────────────────────

async function writeMatch(pair: ScoredPair): Promise<void> {
  await execute(
    `UPDATE ops.clinic_day_entries
     SET matched_appointment_id = $2,
         match_confidence = CASE
           WHEN $3::numeric >= 0.7 THEN 'high'
           WHEN $3::numeric >= 0.5 THEN 'medium'
           ELSE 'low'
         END,
         match_reason = 'composite_' || $3::text,
         match_score = $3,
         match_signals = $4,
         matched_at = NOW()
     WHERE entry_id = $1
       AND (matched_appointment_id IS NULL OR match_confidence = 'unmatched')`,
    [pair.entry_id, pair.appointment_id, pair.score, JSON.stringify(pair.signals)]
  );
}

// ── Clear auto-matches (for rematch) ───────────────────────────────────

export async function clearAutoMatches(clinicDate: string): Promise<number> {
  const result = await queryOne<{ cleared: number }>(
    `WITH cleared AS (
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
           cds_method = NULL,
           cds_llm_reasoning = NULL
       FROM ops.clinic_days cd
       WHERE cd.clinic_day_id = e.clinic_day_id
         AND cd.clinic_date = $1
         AND e.match_confidence != 'manual'
       RETURNING 1
     )
     SELECT COUNT(*)::int as cleared FROM cleared`,
    [clinicDate]
  );
  return result?.cleared ?? 0;
}

// ── Check if clinic day entries exist for a date ───────────────────────

export async function hasClinicDayEntries(clinicDate: string): Promise<boolean> {
  const result = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM ops.clinic_day_entries e
       JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
       WHERE cd.clinic_date = $1
     ) as exists`,
    [clinicDate]
  );
  return result?.exists ?? false;
}
