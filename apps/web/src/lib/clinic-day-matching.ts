/**
 * Clinic Day Composite Matching Engine
 *
 * Multi-signal scoring system for matching master list entries to ClinicHQ appointments.
 * Runs AFTER the existing SQL passes (MIG_2330), catching what they miss —
 * especially within-client-group disambiguation when one owner has multiple cats.
 *
 * Signal weights:
 *   client_name  0.30  — already established by client grouping
 *   cat_name     0.20  — fuzzy similarity on parsed_cat_name vs cat.name
 *   sex          0.10  — entry F/M matches cat sex
 *   weight       0.10  — abs(entry.weight - cat_weight) < 1.0 lbs
 *   chip4        0.10  — waiver with matching last name + date has same chip4
 *   chip_direct  0.15  — waiver chip4 matches appointment cat's microchip directly
 *   appt_number  0.10  — waiver's linked appointment_number matches appointment
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
  is_foster: boolean;
  // Already matched by SQL passes
  matched_appointment_id: string | null;
  match_confidence: string | null;
}

interface Appointment {
  appointment_id: string;
  appointment_number: string | null;
  client_name: string | null;
  account_owner_name: string | null;
  account_type: string | null;
  cat_id: string | null;
  cat_name: string | null;
  cat_sex: string | null;
  cat_weight: number | null;
  microchip: string | null;
  appointment_date: string;
  surgery_start_time: string | null;
  shelterluv_names: string[];  // Alternative names from ShelterLuv (foster renames, aliases)
}

interface WaiverInfo {
  waiver_id: string;
  parsed_last_name: string | null;
  parsed_last4_chip: string | null;
  matched_appointment_id: string | null;
  matched_cat_id: string | null;
  appointment_number: string | null;
}

interface ScoredPair {
  entry_id: string;
  appointment_id: string;
  score: number;
  signals: Record<string, number>;
}

interface CancelledEntry {
  entry_id: string;
  line_number: number;
  parsed_owner_name: string | null;
  appointment_number: string | null;
  reason: string;
}

export interface MatchResult {
  total_entries: number;
  total_appointments: number;
  already_matched: number;
  newly_matched: number;
  unmatched: number;
  cancelled: CancelledEntry[];
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
  // 1. Load entries, appointments, waivers, and cancellations for this date
  const [entries, appointments, waivers, cancelledNumbers] = await Promise.all([
    loadEntries(clinicDate),
    loadAppointments(clinicDate),
    loadWaivers(clinicDate),
    loadCancelledNumbers(clinicDate),
  ]);

  const result: MatchResult = {
    total_entries: entries.length,
    total_appointments: appointments.length,
    already_matched: 0,
    newly_matched: 0,
    unmatched: 0,
    cancelled: [],
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

  // 3. Build waiver lookups: by appointment, by owner last name, and by appointment_number
  const waiverByAppointment = new Map<string, WaiverInfo>();
  const waiversByOwnerLast = new Map<string, WaiverInfo[]>();
  const waiverByApptNumber = new Map<string, WaiverInfo>();
  for (const w of waivers) {
    if (w.matched_appointment_id) {
      waiverByAppointment.set(w.matched_appointment_id, w);
    }
    if (w.appointment_number) {
      waiverByApptNumber.set(w.appointment_number, w);
    }
    if (w.parsed_last_name) {
      const key = w.parsed_last_name.toLowerCase();
      const existing = waiversByOwnerLast.get(key) || [];
      existing.push(w);
      waiversByOwnerLast.set(key, existing);
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
        waiverByAppointment,
        waiversByOwnerLast,
        waiverByApptNumber
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
      waiverByAppointment,
      waiversByOwnerLast,
      waiverByApptNumber
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

  // 9. Detect cancellations among remaining unmatched
  // Entries whose owner name matches a cancelled Number in staged_records
  // (cat_info exists but no appointment_info = surgery cancelled)
  const finallyUnmatched = unmatchedEntries.filter(
    (e) => !matchedEntryIds.has(e.entry_id)
  );

  for (const entry of finallyUnmatched) {
    const cancelled = findCancelledMatch(entry, cancelledNumbers);
    if (cancelled) {
      result.cancelled.push({
        entry_id: entry.entry_id,
        line_number: entry.line_number,
        parsed_owner_name: entry.parsed_owner_name,
        appointment_number: cancelled.number,
        reason: cancelled.reason,
      });
    }
  }

  result.newly_matched = assignedPairs.length;
  result.unmatched = finallyUnmatched.length - result.cancelled.length;
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
       COALESCE(e.is_foster, false) AS is_foster,
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
  const rows = await queryRows<Appointment & { shelterluv_names_raw: string | null }>(
    `SELECT
       a.appointment_id,
       a.appointment_number,
       a.client_name,
       NULLIF(TRIM(COALESCE(ca.owner_first_name, '') || ' ' || COALESCE(ca.owner_last_name, '')), '') as account_owner_name,
       ca.account_type,
       a.cat_id,
       c.name as cat_name,
       c.sex as cat_sex,
       COALESCE(a.cat_weight_lbs, cv.weight_lbs) as cat_weight,
       ci.id_value as microchip,
       a.appointment_date::text as appointment_date,
       a.surgery_start_time::text as surgery_start_time,
       -- ShelterLuv names: all names this cat has been known by (foster renames, aliases)
       (SELECT string_agg(DISTINCT sl.payload->>'Name', '|')
        FROM source.shelterluv_raw sl
        WHERE sl.payload->>'Type' = 'Cat'
          AND c.shelterluv_animal_id IS NOT NULL
          AND sl.payload->>'ID' = c.shelterluv_animal_id::text
       ) as shelterluv_names_raw
     FROM ops.appointments a
     LEFT JOIN ops.clinic_accounts ca
       ON ca.account_id = a.owner_account_id
       AND ca.merged_into_account_id IS NULL
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

  // Parse ShelterLuv names into array
  return rows.map((r) => ({
    ...r,
    shelterluv_names: r.shelterluv_names_raw
      ? r.shelterluv_names_raw.split("|").filter(Boolean)
      : [],
  }));
}

async function loadWaivers(clinicDate: string): Promise<WaiverInfo[]> {
  return queryRows<WaiverInfo>(
    `SELECT
       w.waiver_id,
       w.parsed_last_name,
       w.parsed_last4_chip,
       w.matched_appointment_id,
       w.matched_cat_id::text,
       a.appointment_number
     FROM ops.waiver_scans w
     LEFT JOIN ops.appointments a ON a.appointment_id = w.matched_appointment_id
     WHERE w.parsed_date = $1
       AND w.parsed_last4_chip IS NOT NULL`,
    [clinicDate]
  );
}

// Cancelled entries: Numbers that appear in cat_info but NOT in appointment_info
// (surgery cancelled — cat was checked in but not operated on)
interface CancelledNumber {
  number: string;
  owner_name: string | null;
  cat_name: string | null;
  sex: string | null;
  reason: string;
}

async function loadCancelledNumbers(clinicDate: string): Promise<CancelledNumber[]> {
  return queryRows<CancelledNumber>(
    `SELECT
       ci.payload->>'Number' as number,
       NULLIF(TRIM(
         COALESCE(oi.payload->>'Owner First Name', '') || ' ' ||
         COALESCE(oi.payload->>'Owner Last Name', '')
       ), '') as owner_name,
       ci.payload->>'Animal Name' as cat_name,
       ci.payload->>'Sex' as sex,
       CASE
         WHEN ci.payload->>'Spay Neuter Status' = 'No' THEN 'sx_cancelled'
         ELSE 'no_appointment_record'
       END as reason
     FROM ops.staged_records ci
     LEFT JOIN ops.staged_records oi ON
       oi.source_system = 'clinichq'
       AND oi.source_table = 'owner_info'
       AND oi.payload->>'Number' = ci.payload->>'Number'
       AND oi.file_upload_id = ci.file_upload_id
     WHERE ci.source_system = 'clinichq'
       AND ci.source_table = 'cat_info'
       AND ci.payload->>'Date' = TO_CHAR($1::date, 'MM/DD/YYYY')
       AND ci.payload->>'Number' IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM ops.staged_records ai
         WHERE ai.source_system = 'clinichq'
           AND ai.source_table = 'appointment_info'
           AND ai.payload->>'Number' = ci.payload->>'Number'
           AND ai.file_upload_id = ci.file_upload_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM ops.appointments a
         WHERE a.appointment_number = ci.payload->>'Number'
           AND a.merged_into_appointment_id IS NULL
       )`,
    [clinicDate]
  );
}

function findCancelledMatch(
  entry: ClinicDayEntry,
  cancelledNumbers: CancelledNumber[]
): CancelledNumber | null {
  if (!entry.parsed_owner_name || cancelledNumbers.length === 0) return null;

  const entryOwner = normalizeForGrouping(entry.parsed_owner_name);

  // Match by owner name + sex agreement
  for (const cn of cancelledNumbers) {
    const cnOwner = normalizeForGrouping(cn.owner_name);
    if (!cnOwner || cnOwner !== entryOwner) continue;

    // Sex check: entry sex should match cancelled cat sex
    const cnIsMale = cn.sex?.toLowerCase() === "male" || cn.sex?.toLowerCase() === "m";
    const cnIsFemale = cn.sex?.toLowerCase() === "female" || cn.sex?.toLowerCase() === "f";
    if (entry.male_count > 0 && cnIsMale) return cn;
    if (entry.female_count > 0 && cnIsFemale) return cn;
    // If no sex info on either side, match by owner alone
    if (!cn.sex && entry.male_count === 0 && entry.female_count === 0) return cn;
  }

  return null;
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

    // Also index by account_owner_name if it differs from client_name
    // (who booked vs who resolved to — may differ after identity resolution)
    const accountKey = normalizeForGrouping(appt.account_owner_name);
    if (accountKey && accountKey !== key) {
      const acctExisting = groups.get(accountKey) || [];
      // Only add if not already in this group
      if (!acctExisting.includes(appt)) {
        acctExisting.push(appt);
        groups.set(accountKey, acctExisting);
      }
    }
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

  // Fuzzy: find best match among appointment groups
  let bestKey: string | null = null;
  let bestSim = 0;

  for (const clientKey of appointmentGroups.keys()) {
    if (clientKey === "__no_client__") continue;

    // Trigram similarity
    let sim = stringSimilarity(ownerKey, clientKey);

    // Substring boost: if entry name is a meaningful substring of client name
    // (handles "foster" → "forgottenfelinesfosters", abbreviations)
    if (ownerKey.length >= 4 && clientKey.includes(ownerKey)) {
      sim = Math.max(sim, 0.7);
    }

    // Token-level Levenshtein rescue: catches typos that trigrams miss
    // "Elise Gonzalez" vs "Elsie Gonsalves" — trigrams score ~0.4, tokens score ~0.8
    if (sim < 0.6 && ownerKey.length >= 4 && clientKey.length >= 4) {
      const tokenScore = scoreNameTokens(ownerKey, clientKey);
      if (tokenScore >= 0.75) {
        sim = Math.max(sim, tokenScore * 0.85); // Scale down slightly — token match is good but not perfect
      }
    }

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
  waiverByAppointment: Map<string, WaiverInfo>,
  waiversByOwnerLast: Map<string, WaiverInfo[]>,
  waiverByApptNumber: Map<string, WaiverInfo>
): ScoredPair[] {
  const pairs: ScoredPair[] = [];

  // Pre-compute ordinal positions for time_order scoring.
  // Entries are already sorted by line_number (from query ORDER BY).
  // Appointments sorted by surgery_start_time (null → end).
  const apptsSorted = [...appointments].sort((a, b) => {
    if (!a.surgery_start_time && !b.surgery_start_time) return 0;
    if (!a.surgery_start_time) return 1;
    if (!b.surgery_start_time) return -1;
    return a.surgery_start_time.localeCompare(b.surgery_start_time);
  });
  const entryRank = new Map<string, number>();
  const apptRank = new Map<string, number>();
  entries.forEach((e, i) => entryRank.set(e.entry_id, i));
  apptsSorted.forEach((a, i) => apptRank.set(a.appointment_id, i));

  const groupSize = Math.max(entries.length, appointments.length);

  for (const entry of entries) {
    for (const appt of appointments) {
      const signals: Record<string, number> = {};
      let score = 0;

      // Client name match — already established by grouping (0.30)
      signals.client_name = 0.3;
      score += 0.3;

      // Cat name similarity (0.20 max)
      const catNameScore = scoreCatName(entry.parsed_cat_name, appt.cat_name, appt.shelterluv_names);
      signals.cat_name = +(catNameScore * 0.2).toFixed(3);
      score += signals.cat_name;

      // Sex match (0.10)
      const sexScore = scoreSex(entry, appt.cat_sex);
      signals.sex = +(sexScore * 0.1).toFixed(3);
      score += signals.sex;

      // Weight match (0.10)
      const weightScore = scoreWeight(entry.weight_lbs, appt.cat_weight);
      signals.weight = +(weightScore * 0.1).toFixed(3);
      score += signals.weight;

      // Chip4 via waiver already linked to appointment (0.10)
      const chip4Score = scoreChip4(entry, appt, waiverByAppointment);
      signals.chip4 = +(chip4Score * 0.1).toFixed(3);
      score += signals.chip4;

      // Direct chip match: entry owner → waiver chip4 → appointment cat microchip (0.15)
      // This bridges the "different booker" problem: master list says "Donal Machine"
      // but ClinicHQ has "Paul Emis" — the microchip is the ground truth
      const chipDirectScore = scoreChipDirect(entry, appt, waiversByOwnerLast);
      signals.chip_direct = +(chipDirectScore * 0.15).toFixed(3);
      score += signals.chip_direct;

      // Appointment number bridge (0.10) — waiver linked to an appointment whose
      // Number (e.g. "26-1251") matches this appointment. Definitive cross-source key.
      const apptNumScore = scoreApptNumber(entry, appt, waiverByApptNumber, waiversByOwnerLast);
      signals.appt_number = +(apptNumScore * 0.1).toFixed(3);
      score += signals.appt_number;

      // Surgery time order (0.05) — bonus if line_number rank matches
      // surgery_start_time rank within the group. This helps disambiguate
      // multi-cat owners: entry #1 likely maps to the earliest surgery.
      const timeOrderScore = scoreTimeOrder(
        entry.entry_id, appt.appointment_id,
        entryRank, apptRank, groupSize
      );
      signals.time_order = +(timeOrderScore * 0.05).toFixed(3);
      score += signals.time_order;

      // Foster-aware adjustment: owner name is meaningless for fosters
      // (ML says "Foster" or a person name, CHQ says "Forgotten Felines Fosters")
      if (entry.is_foster) {
        score -= signals.client_name; // Remove client_name contribution
        signals.client_name = 0;
        score -= signals.cat_name;    // Remove old cat_name contribution
        signals.cat_name = +(catNameScore * 0.40).toFixed(3); // Double weight (was 0.20)
        score += signals.cat_name;
      }

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
  waiverByAppointment: Map<string, WaiverInfo>,
  waiversByOwnerLast: Map<string, WaiverInfo[]>,
  waiverByApptNumber: Map<string, WaiverInfo>
): ScoredPair[] {
  const pairs: ScoredPair[] = [];

  // For cross-client, time_order is less meaningful (different owners),
  // but still provides a small signal for sequential processing order
  const apptsSorted = [...appointments].sort((a, b) => {
    if (!a.surgery_start_time && !b.surgery_start_time) return 0;
    if (!a.surgery_start_time) return 1;
    if (!b.surgery_start_time) return -1;
    return a.surgery_start_time.localeCompare(b.surgery_start_time);
  });
  const entryRank = new Map<string, number>();
  const apptRank = new Map<string, number>();
  entries.forEach((e, i) => entryRank.set(e.entry_id, i));
  apptsSorted.forEach((a, i) => apptRank.set(a.appointment_id, i));
  const groupSize = Math.max(entries.length, appointments.length);

  for (const entry of entries) {
    for (const appt of appointments) {
      const signals: Record<string, number> = {};
      let score = 0;

      // Client name — fuzzy match (not pre-grouped, so score it)
      // Checks both client_name and account_owner_name (who booked vs who resolved to)
      const clientScore = scoreClientName(
        entry.parsed_owner_name,
        appt.client_name,
        appt.account_owner_name
      );
      signals.client_name = +(clientScore * 0.3).toFixed(3);
      score += signals.client_name;

      // Cat name
      const catNameScore = scoreCatName(entry.parsed_cat_name, appt.cat_name, appt.shelterluv_names);
      signals.cat_name = +(catNameScore * 0.2).toFixed(3);
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

      // Direct chip match (critical for cross-client — names don't match)
      const chipDirectScore = scoreChipDirect(entry, appt, waiversByOwnerLast);
      signals.chip_direct = +(chipDirectScore * 0.15).toFixed(3);
      score += signals.chip_direct;

      // Appointment number bridge (critical for cross-client — definitive match key)
      const apptNumScore = scoreApptNumber(entry, appt, waiverByApptNumber, waiversByOwnerLast);
      signals.appt_number = +(apptNumScore * 0.1).toFixed(3);
      score += signals.appt_number;

      // Time order (reduced weight in cross-client context)
      const timeOrderScore = scoreTimeOrder(
        entry.entry_id, appt.appointment_id,
        entryRank, apptRank, groupSize
      );
      signals.time_order = +(timeOrderScore * 0.05).toFixed(3);
      score += signals.time_order;

      // Foster-aware adjustment
      if (entry.is_foster) {
        score -= signals.client_name;
        signals.client_name = 0;
        score -= signals.cat_name;
        signals.cat_name = +(catNameScore * 0.40).toFixed(3);
        score += signals.cat_name;
      }

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

function normalizeCatName(name: string): string {
  // Strip punctuation (G.G. → GG, Mr. Whiskers → Mr Whiskers)
  // and collapse whitespace for consistent comparison
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function scoreCatName(
  entryName: string | null,
  apptCatName: string | null,
  shelterluvNames?: string[]
): number {
  if (!entryName) return 0;

  const normEntry = normalizeCatName(entryName);

  // Check primary cat name + all ShelterLuv aliases (foster renames like Waverly→Wyatt)
  const allNames = [apptCatName, ...(shelterluvNames || [])].filter(Boolean) as string[];
  if (allNames.length === 0) return 0;

  let best = 0;
  for (const name of allNames) {
    const norm = normalizeCatName(name);

    // Exact match after normalization (handles GG vs G.G., etc.)
    if (normEntry === norm) return 1.0;

    // Check if entry name appears inside a compound ShelterLuv name
    // e.g., "Wyatt" inside "Wyatt (Waverly)" or "Waverly" inside "Waverly 5305"
    if (norm.includes(normEntry) || normEntry.includes(norm)) {
      best = Math.max(best, 0.9);
      continue;
    }

    const sim = stringSimilarity(normEntry, norm);
    if (sim > 0.5) best = Math.max(best, sim);
  }

  return best;
}

function scoreClientName(
  ownerName: string | null,
  clientName: string | null,
  accountOwnerName?: string | null
): number {
  if (!ownerName) return 0;
  const ownerNorm = ownerName.toLowerCase();

  let best = 0;
  for (const name of [clientName, accountOwnerName]) {
    if (!name) continue;
    const norm = name.toLowerCase();
    let sim = stringSimilarity(ownerNorm, norm);
    // Substring boost for abbreviations (e.g., "Foster" in "Forgotten Felines Fosters")
    const ownerStripped = ownerNorm.replace(/[^a-z]/g, "");
    const nameStripped = norm.replace(/[^a-z]/g, "");
    if (ownerStripped.length >= 4 && nameStripped.includes(ownerStripped)) {
      sim = Math.max(sim, 0.7);
    }
    // Token-level Levenshtein rescue for typos
    // "Elise Gonzalez" vs "Elsie Gonsalves" — trigrams miss, tokens catch
    if (sim < 0.5) {
      const tokenScore = scoreNameTokens(ownerName, name);
      if (tokenScore >= 0.70) {
        sim = Math.max(sim, tokenScore);
      }
    }
    best = Math.max(best, sim);
  }
  return best;
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

function scoreTimeOrder(
  entryId: string,
  apptId: string,
  entryRank: Map<string, number>,
  apptRank: Map<string, number>,
  groupSize: number,
): number {
  const eRank = entryRank.get(entryId);
  const aRank = apptRank.get(apptId);
  if (eRank == null || aRank == null) return 0;
  if (groupSize <= 1) return 1; // Singleton — trivially matches

  // Score based on how close the ranks are (0 = perfect match, 1 = max distance)
  const maxDist = groupSize - 1;
  const dist = Math.abs(eRank - aRank);
  // Perfect rank match = 1.0, off by 1 in a group of 4 = 0.67, opposite = 0
  return maxDist > 0 ? 1 - dist / maxDist : 1;
}

/**
 * Appointment number bridge: if a waiver linked to this appointment's Number (e.g. "26-1251")
 * also has an owner last name matching the entry, it confirms the entry↔appointment pair.
 * The Number field is the only stable ID across all three ClinicHQ export files.
 */
function scoreApptNumber(
  entry: ClinicDayEntry,
  appt: Appointment,
  waiverByApptNumber: Map<string, WaiverInfo>,
  waiversByOwnerLast: Map<string, WaiverInfo[]>
): number {
  if (!appt.appointment_number) return 0;

  // Check if any waiver is linked to this appointment via its Number
  const waiver = waiverByApptNumber.get(appt.appointment_number);
  if (!waiver) return 0;

  // Waiver exists for this appointment_number — check if owner name matches entry
  if (waiver.parsed_last_name && entry.parsed_owner_name) {
    const waiverLast = waiver.parsed_last_name.toLowerCase();
    const nameParts = entry.parsed_owner_name.trim().split(/\s+/);
    const entryLast = nameParts[nameParts.length - 1].toLowerCase();

    if (entryLast === waiverLast || entryLast.includes(waiverLast) || waiverLast.includes(entryLast)) {
      return 1.0; // Strong: appointment_number + owner name agreement
    }
  }

  // Fallback: check if any waiver matching entry's owner last name
  // also has this appointment_number via its matched appointment
  if (entry.parsed_owner_name) {
    const nameParts = entry.parsed_owner_name.trim().split(/\s+/);
    const entryLast = nameParts[nameParts.length - 1].toLowerCase();
    const ownerWaivers = waiversByOwnerLast.get(entryLast);

    if (ownerWaivers) {
      for (const w of ownerWaivers) {
        if (w.appointment_number === appt.appointment_number) {
          return 1.0;
        }
      }
    }
  }

  return 0;
}

/**
 * Direct microchip bridge: entry owner → waiver (by owner last name) → chip4 → appointment cat's microchip.
 * This is the key signal for "different booker" cases where the master list says "Donal Machine"
 * but ClinicHQ has "Paul Emis". The waiver has the owner's last name AND the microchip,
 * providing ground truth that bypasses name resolution entirely.
 */
function scoreChipDirect(
  entry: ClinicDayEntry,
  appt: Appointment,
  waiversByOwnerLast: Map<string, WaiverInfo[]>
): number {
  if (!appt.microchip || !entry.parsed_owner_name) return 0;
  const apptChip4 = appt.microchip.slice(-4);

  // Extract last name from entry owner (take last word)
  const nameParts = entry.parsed_owner_name.trim().split(/\s+/);
  const lastName = nameParts[nameParts.length - 1].toLowerCase();
  if (!lastName || lastName.length < 2) return 0;

  // Find waivers matching this owner's last name
  const matchingWaivers = waiversByOwnerLast.get(lastName);
  if (!matchingWaivers) return 0;

  // Check if any waiver's chip4 matches the appointment cat's microchip
  for (const waiver of matchingWaivers) {
    if (waiver.parsed_last4_chip === apptChip4) {
      return 1.0; // Strong match: waiver chip confirms this entry → this appointment
    }
  }

  return 0;
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

// ── Levenshtein edit distance ──────────────────────────────────────────

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
        matrix[i - 1][j] + 1,     // deletion
        matrix[i][j - 1] + 1,     // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Aggressive name normalization for fuzzy matching.
 * Strips phone suffixes, trapper aliases, honorifics, and formatting noise.
 */
function normalizeNameAggressive(name: string | null): string {
  if (!name) return "";
  let n = name.toLowerCase();
  // Strip phone suffixes: "Name - call 707-555-1234" → "Name"
  n = n.replace(/\s*[-–]\s*(call|text|phone|cell|home|work)\b.*$/i, "");
  // Strip phone numbers anywhere
  n = n.replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "");
  // Strip trapper suffix: "Name - Trp Christina" → "Name"
  n = n.replace(/\s*[-–]\s*trp\b.*$/i, "");
  // Strip parenthetical notes: "Name (updates)" → "Name"
  n = n.replace(/\s*\(.*?\)\s*/g, " ");
  // Strip honorifics
  n = n.replace(/\b(jr|sr|ii|iii|iv|mr|mrs|ms|dr)\b\.?/g, "");
  // Collapse whitespace and strip non-alpha
  return n.replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Token-level name comparison using Levenshtein distance.
 * Splits names into tokens and finds the best per-token match.
 * Returns 0-1 score (1 = all tokens match closely).
 *
 * "Elise Gonzalez" vs "Elsie Gonsalves" → high (edit distance 1+3 on 5+9 chars)
 * "Ngan Nguyen" vs "NGAN NGUYEN" → 1.0 (exact after normalization)
 */
function scoreNameTokens(a: string, b: string): number {
  const tokensA = normalizeNameAggressive(a).split(" ").filter((t) => t.length >= 2);
  const tokensB = normalizeNameAggressive(b).split(" ").filter((t) => t.length >= 2);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  // For each token in A, find best match in B
  let totalScore = 0;
  const usedB = new Set<number>();

  for (const tA of tokensA) {
    let bestScore = 0;
    let bestIdx = -1;
    for (let i = 0; i < tokensB.length; i++) {
      if (usedB.has(i)) continue;
      const tB = tokensB[i];
      const maxLen = Math.max(tA.length, tB.length);
      if (maxLen === 0) continue;
      const dist = levenshtein(tA, tB);
      // Normalize: 0 distance = 1.0, distance = maxLen = 0.0
      const score = 1 - dist / maxLen;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) usedB.add(bestIdx);
    totalScore += bestScore;
  }

  return totalScore / tokensA.length;
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
  // Three layers of protection — an entry is preserved if ANY of:
  //   (a) match_confidence = 'manual' (staff-assigned match)
  //   (b) verified_at IS NOT NULL (staff reviewed and confirmed, MIG_3081)
  //   (c) linked appointment has manually_overridden_fields for clinic_day_number or cat_id
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
         AND e.verified_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM ops.appointments a
           WHERE a.appointment_id = e.appointment_id
             AND (
               ops.is_field_manually_set(a.manually_overridden_fields, 'clinic_day_number')
               OR ops.is_field_manually_set(a.manually_overridden_fields, 'cat_id')
             )
         )
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
