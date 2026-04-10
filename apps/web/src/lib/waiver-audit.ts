/**
 * Waiver Cross-Reference Audit
 *
 * Compares waiver-extracted data against assigned cat attributes
 * across multiple independent signals. Catches staff assignment
 * errors where the wrong waiver was filed with the wrong cat.
 *
 * Checks (ordered by severity):
 * 1. chip_mismatch    — waiver chip ≠ cat's chip (Critical)
 * 2. date_mismatch    — waiver date ≠ clinic_date (Warning)
 * 3. source_disagreement — SP vs photo cat_id disagree (Warning)
 * 4. owner_mismatch   — owner name <20% similarity (Info)
 *
 * Linear: FFS-1220
 */

import { queryOne, queryRows } from "@/lib/db";

// ── Types ────────────────────────────────────────────────────

export interface AuditResult {
  audit_id: string;
  clinic_date: string;
  chunk_id: string | null;
  segment_id: string | null;
  check_type: string;
  severity: "critical" | "warning" | "info";
  expected_value: string | null;
  actual_value: string | null;
  details: Record<string, unknown> | null;
}

export interface AuditSummary {
  clinic_date: string;
  total_checks: number;
  critical: number;
  warning: number;
  info: number;
  results: AuditResult[];
}

// ── Similarity helper ───────────────────────────────────────

function nameSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;

  // Simple Jaccard similarity on character bigrams
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      set.add(s.substring(i, i + 2));
    }
    return set;
  };

  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return 0;

  let intersection = 0;
  for (const b of ba) {
    if (bb.has(b)) intersection++;
  }
  return intersection / (ba.size + bb.size - intersection);
}

// ── Main audit function ─────────────────────────────────────

/**
 * Run all audit checks for a clinic date. Returns newly created
 * audit results. Idempotent for the same date — re-running creates
 * new results (append-only).
 */
export async function runWaiverAudit(clinicDate: string): Promise<AuditSummary> {
  const results: AuditResult[] = [];

  // Load all assigned chunks with waiver data for this date
  const chunks = await queryRows<{
    chunk_id: string;
    segment_id: string;
    matched_cat_id: string;
    matched_via: string;
    extracted_data: Record<string, unknown> | null;
  }>(`
    SELECT
      s.chunk_id::text,
      s.segment_id::text,
      s.matched_cat_id::text,
      s.matched_via,
      s.extracted_data
    FROM ops.evidence_stream_segments s
    WHERE s.clinic_date = $1::DATE
      AND s.segment_role = 'waiver_photo'
      AND s.matched_cat_id IS NOT NULL
      AND s.chunk_id IS NOT NULL
    ORDER BY s.sequence_number
  `, [clinicDate]);

  for (const chunk of chunks) {
    const ed = chunk.extracted_data;
    if (!ed) continue;

    const waiverChipFull = (ed.microchip_number as string) ?? null;
    const waiverChipLast4 = (ed.microchip_last4 as string) ?? null;
    const waiverDate = (ed.date as string) ?? null;
    const waiverOwnerLast = (ed.owner_last_name as string) ?? null;

    // ── Check 1: Chip mismatch (Critical) ────────────────────
    if (waiverChipFull || waiverChipLast4) {
      const catChip = await queryOne<{ id_value: string }>(`
        SELECT ci.id_value
        FROM sot.cat_identifiers ci
        WHERE ci.cat_id = $1::UUID
          AND ci.id_type = 'microchip'
        LIMIT 1
      `, [chunk.matched_cat_id]);

      if (catChip) {
        let mismatch = false;
        if (waiverChipFull && catChip.id_value !== waiverChipFull) {
          mismatch = true;
        } else if (waiverChipLast4 && !catChip.id_value.endsWith(waiverChipLast4)) {
          mismatch = true;
        }

        if (mismatch) {
          const r = await insertAuditResult({
            clinic_date: clinicDate,
            chunk_id: chunk.chunk_id,
            segment_id: chunk.segment_id,
            check_type: "chip_mismatch",
            severity: "critical",
            expected_value: waiverChipFull || `...${waiverChipLast4}`,
            actual_value: catChip.id_value,
            details: {
              matched_cat_id: chunk.matched_cat_id,
              matched_via: chunk.matched_via,
            },
          });
          results.push(r);
        }
      }
    }

    // ── Check 2: Date mismatch (Warning) ─────────────────────
    if (waiverDate) {
      // Parse waiver date and compare to clinic_date
      const parsedDate = parseWaiverDate(waiverDate);
      if (parsedDate && parsedDate !== clinicDate) {
        const r = await insertAuditResult({
          clinic_date: clinicDate,
          chunk_id: chunk.chunk_id,
          segment_id: chunk.segment_id,
          check_type: "date_mismatch",
          severity: "warning",
          expected_value: clinicDate,
          actual_value: waiverDate,
          details: { parsed_as: parsedDate },
        });
        results.push(r);
      }
    }

    // ── Check 3: Source disagreement (Warning) ────────────────
    // Check if SharePoint waiver for the same owner/chip matched a different cat
    if (waiverChipLast4 || waiverOwnerLast) {
      const sp = await queryOne<{ matched_cat_id: string }>(`
        SELECT w.matched_cat_id::text
        FROM ops.waiver_scans w
        WHERE w.parsed_date = $1::DATE
          AND w.matched_cat_id IS NOT NULL
          AND (
            ($2::TEXT IS NOT NULL AND w.parsed_last4_chip = $2::TEXT)
            OR ($3::TEXT IS NOT NULL AND LOWER(w.parsed_last_name) = LOWER($3::TEXT))
          )
        LIMIT 1
      `, [clinicDate, waiverChipLast4, waiverOwnerLast]);

      if (sp && sp.matched_cat_id !== chunk.matched_cat_id) {
        const r = await insertAuditResult({
          clinic_date: clinicDate,
          chunk_id: chunk.chunk_id,
          segment_id: chunk.segment_id,
          check_type: "source_disagreement",
          severity: "warning",
          expected_value: `photo: ${chunk.matched_cat_id.substring(0, 8)}`,
          actual_value: `sharepoint: ${sp.matched_cat_id.substring(0, 8)}`,
          details: {
            photo_cat_id: chunk.matched_cat_id,
            sharepoint_cat_id: sp.matched_cat_id,
            matched_via: chunk.matched_via,
          },
        });
        results.push(r);
      }
    }

    // ── Check 4: Owner name mismatch (Info) ──────────────────
    if (waiverOwnerLast) {
      const catOwner = await queryOne<{ client_name: string }>(`
        SELECT a.client_name
        FROM ops.appointments a
        WHERE a.cat_id = $1::UUID
          AND a.appointment_date = $2::DATE
          AND a.merged_into_appointment_id IS NULL
          AND a.client_name IS NOT NULL
        LIMIT 1
      `, [chunk.matched_cat_id, clinicDate]);

      if (catOwner?.client_name) {
        const sim = nameSimilarity(waiverOwnerLast, catOwner.client_name);
        if (sim < 0.2) {
          const r = await insertAuditResult({
            clinic_date: clinicDate,
            chunk_id: chunk.chunk_id,
            segment_id: chunk.segment_id,
            check_type: "owner_mismatch",
            severity: "info",
            expected_value: waiverOwnerLast,
            actual_value: catOwner.client_name,
            details: { similarity: Math.round(sim * 100) / 100 },
          });
          results.push(r);
        }
      }
    }
  }

  return {
    clinic_date: clinicDate,
    total_checks: results.length,
    critical: results.filter((r) => r.severity === "critical").length,
    warning: results.filter((r) => r.severity === "warning").length,
    info: results.filter((r) => r.severity === "info").length,
    results,
  };
}

// ── Get unresolved audits for a date ────────────────────────

export async function getUnresolvedAudits(clinicDate: string): Promise<AuditResult[]> {
  return queryRows<AuditResult>(`
    SELECT
      audit_id::text,
      clinic_date::text,
      chunk_id::text,
      segment_id::text,
      check_type,
      severity,
      expected_value,
      actual_value,
      details
    FROM ops.evidence_audit_results
    WHERE clinic_date = $1::DATE
      AND resolved_at IS NULL
    ORDER BY
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'warning' THEN 2
        WHEN 'info' THEN 3
      END,
      created_at
  `, [clinicDate]);
}

// ── Resolve an audit ────────────────────────────────────────

export async function resolveAudit(
  auditId: string,
  resolvedBy: string | null,
  note: string,
): Promise<void> {
  await queryOne(`
    UPDATE ops.evidence_audit_results
    SET resolved_at = NOW(),
        resolved_by = $2::UUID,
        resolution_note = $3
    WHERE audit_id = $1::UUID
  `, [auditId, resolvedBy, note]);
}

// ── Helpers ─────────────────────────────────────────────────

async function insertAuditResult(r: {
  clinic_date: string;
  chunk_id: string | null;
  segment_id: string | null;
  check_type: string;
  severity: string;
  expected_value: string | null;
  actual_value: string | null;
  details: Record<string, unknown> | null;
}): Promise<AuditResult> {
  const row = await queryOne<{ audit_id: string }>(`
    INSERT INTO ops.evidence_audit_results
      (clinic_date, chunk_id, segment_id, check_type, severity,
       expected_value, actual_value, details)
    VALUES ($1::DATE, $2::UUID, $3::UUID, $4, $5, $6, $7, $8::JSONB)
    RETURNING audit_id::text
  `, [
    r.clinic_date,
    r.chunk_id,
    r.segment_id,
    r.check_type,
    r.severity,
    r.expected_value,
    r.actual_value,
    r.details ? JSON.stringify(r.details) : null,
  ]);

  return {
    audit_id: row!.audit_id,
    clinic_date: r.clinic_date,
    chunk_id: r.chunk_id,
    segment_id: r.segment_id,
    check_type: r.check_type,
    severity: r.severity as "critical" | "warning" | "info",
    expected_value: r.expected_value,
    actual_value: r.actual_value,
    details: r.details,
  };
}

/**
 * Parse waiver date strings like "3/18/26", "March 18, 2026",
 * "03-18-2026" into YYYY-MM-DD format.
 */
function parseWaiverDate(dateStr: string): string | null {
  // Try M/D/YY or M/D/YYYY
  const slashMatch = dateStr.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1]);
    const day = parseInt(slashMatch[2]);
    let year = parseInt(slashMatch[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Try "Month Day, Year"
  const namedMatch = dateStr.match(/^(\w+)\s+(\d{1,2}),?\s*(\d{4})$/);
  if (namedMatch) {
    const months: Record<string, number> = {
      january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
      july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    };
    const month = months[namedMatch[1].toLowerCase()];
    if (month) {
      const day = parseInt(namedMatch[2]);
      const year = parseInt(namedMatch[3]);
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}
