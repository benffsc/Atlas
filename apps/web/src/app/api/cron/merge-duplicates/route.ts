import { NextRequest } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";

// Duplicate People Auto-Merge Cron Job
//
// Phase 1B: Enhanced auto-resolution with multiple merge patterns:
//
// Pattern 1 (existing): Exact name match + no conflicting identifiers
// Pattern 2 (new): Same phone + name sim >= 0.85 + same address (FFS-902)
// Pattern 3 (new): Same email + different name + same address (household)
//
// Also runs:
// - Auto-blacklist identifiers shared by 5+ people (FFS-898)
// - Detect and flag proxy identifiers (FFS-1045)
// - Mark stale relationships (2+ years, FFS-899)
//
// Uses sot.merge_person_into() (NOT sot.merge_people which doesn't exist).
// Safety gates: sot.person_safe_to_merge() checked before every merge.
//
// Vercel Cron: "0 3 * * *" (daily at 3 AM)

export const maxDuration = 120; // 2 minutes for batch processing

const CRON_SECRET = process.env.CRON_SECRET;

interface DuplicateGroup {
  normalized_name: string;
  count: number;
  person_ids: string[];
  display_names: string[];
}

interface MergeResult {
  source_id: string;
  target_id: string;
  pattern: string;
  success: boolean;
  error?: string;
}

interface AutoMergeCandidate {
  loser_id: string;
  winner_id: string;
  pattern: string;
  confidence: number;
  evidence: Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  const startTime = Date.now();
  const dryRun = request.nextUrl.searchParams.get("dry_run") === "true";
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "100", 10);

  try {
    // ====================================================================
    // Step 0: Auto-blacklist shared identifiers (FFS-898)
    // ====================================================================
    let blacklistResults: { identifier_type: string; identifier_norm: string; person_count: number; action: string }[] = [];
    try {
      blacklistResults = await queryRows<{
        identifier_type: string;
        identifier_norm: string;
        person_count: number;
        action: string;
      }>(
        "SELECT * FROM ops.auto_blacklist_shared_identifiers($1, $2)",
        [5, dryRun]
      );
    } catch {
      // MIG_3002 may not be applied yet — non-fatal
    }

    // ====================================================================
    // Step 0b: Mark stale relationships (FFS-899)
    // ====================================================================
    let staleResults: Record<string, unknown> = {};
    try {
      const staleRow = await queryOne<{ mark_stale_relationships: Record<string, unknown> }>(
        "SELECT ops.mark_stale_relationships($1, $2)",
        [2, dryRun]
      );
      staleResults = staleRow?.mark_stale_relationships || {};
    } catch {
      // MIG_3002 may not be applied yet — non-fatal
    }

    // ====================================================================
    // Step 0c: Detect proxy identifiers (FFS-1045)
    // ====================================================================
    let proxyResults: { detection_rule: string; person_id: string; id_type: string; id_value_norm: string }[] = [];
    try {
      proxyResults = await queryRows<{
        detection_rule: string;
        person_id: string;
        id_type: string;
        id_value_norm: string;
      }>(
        "SELECT detection_rule, person_id::TEXT, id_type, id_value_norm FROM ops.detect_proxy_identifiers($1)",
        [dryRun]
      );
    } catch {
      // MIG_3027 may not be applied yet — non-fatal
    }

    // ====================================================================
    // Step 1: Pattern-based auto-merge candidates (FFS-902)
    // ====================================================================
    let patternMerges: AutoMergeCandidate[] = [];
    try {
      patternMerges = await queryRows<AutoMergeCandidate>(
        "SELECT * FROM ops.find_auto_mergeable_people($1)",
        [limit]
      );
    } catch {
      // MIG_3002 may not be applied yet — fall through to legacy logic
    }

    // ====================================================================
    // Step 2: Exact name duplicate groups (existing logic, fixed)
    // ====================================================================
    const duplicateGroups = await queryRows<DuplicateGroup>(`
      WITH normalized_names AS (
        SELECT
          person_id,
          display_name,
          LOWER(TRIM(display_name)) AS normalized_name
        FROM sot.people
        WHERE merged_into_person_id IS NULL
          AND display_name IS NOT NULL
          AND display_name != ''
          AND sot.is_valid_person_name(display_name)
      ),
      duplicate_groups AS (
        SELECT
          normalized_name,
          COUNT(*) AS count,
          ARRAY_AGG(person_id ORDER BY person_id) AS person_ids,
          ARRAY_AGG(display_name ORDER BY person_id) AS display_names
        FROM normalized_names
        GROUP BY normalized_name
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
        LIMIT $1
      )
      SELECT * FROM duplicate_groups
    `, [limit]);

    // Build safe merges from exact name groups
    const safeMerges: { source_id: string; target_id: string; name: string }[] = [];
    const needsReview: { name: string; reason: string; person_ids: string[] }[] = [];

    if (duplicateGroups.length > 0) {
      const allPersonIds = duplicateGroups.flatMap(g => g.person_ids);
      const identifiers = await queryRows<{
        person_id: string;
        id_type: string;
        id_value_norm: string;
      }>(`
        SELECT person_id, id_type, id_value_norm
        FROM sot.person_identifiers
        WHERE person_id = ANY($1)
        ORDER BY person_id, id_type
      `, [allPersonIds]);

      const identifierMap = new Map<string, { emails: Set<string>; phones: Set<string> }>();
      for (const id of identifiers) {
        if (!identifierMap.has(id.person_id)) {
          identifierMap.set(id.person_id, { emails: new Set(), phones: new Set() });
        }
        const map = identifierMap.get(id.person_id)!;
        if (id.id_type === "email") {
          map.emails.add(id.id_value_norm);
        } else if (id.id_type === "phone") {
          map.phones.add(id.id_value_norm);
        }
      }

      for (const group of duplicateGroups) {
        const { normalized_name, person_ids } = group;

        const groupIdentifiers = person_ids.map(id => ({
          person_id: id,
          emails: identifierMap.get(id)?.emails || new Set<string>(),
          phones: identifierMap.get(id)?.phones || new Set<string>(),
        }));

        const allEmails = new Set<string>();
        const allPhones = new Set<string>();
        let hasConflict = false;

        for (const p of groupIdentifiers) {
          for (const email of p.emails) {
            if (allEmails.has(email)) continue;
            for (const otherEmail of allEmails) {
              if (email !== otherEmail) {
                hasConflict = true;
                break;
              }
            }
            allEmails.add(email);
          }
          for (const phone of p.phones) {
            if (allPhones.has(phone)) continue;
            for (const otherPhone of allPhones) {
              if (phone !== otherPhone) {
                hasConflict = true;
                break;
              }
            }
            allPhones.add(phone);
          }
        }

        if (hasConflict) {
          needsReview.push({
            name: normalized_name,
            reason: "conflicting_identifiers",
            person_ids,
          });
          continue;
        }

        const [target_id, ...source_ids] = person_ids;
        for (const source_id of source_ids) {
          safeMerges.push({
            source_id,
            target_id,
            name: normalized_name,
          });
        }
      }
    }

    // ====================================================================
    // Step 3: Execute merges (unless dry run)
    // ====================================================================
    const mergeResults: MergeResult[] = [];
    let mergedCount = 0;
    let errorCount = 0;

    if (!dryRun) {
      // Execute pattern-based merges first (higher confidence)
      for (const candidate of patternMerges) {
        const result = await executeSafeMerge(
          candidate.loser_id,
          candidate.winner_id,
          `auto_merge_${candidate.pattern}`,
          candidate.pattern
        );
        mergeResults.push(result);
        if (result.success) mergedCount++;
        else errorCount++;
      }

      // Execute exact name merges
      for (const merge of safeMerges) {
        const result = await executeSafeMerge(
          merge.source_id,
          merge.target_id,
          "auto_merge_exact_name_duplicate",
          "exact_name"
        );
        mergeResults.push(result);
        if (result.success) mergedCount++;
        else errorCount++;
      }
    }

    // ====================================================================
    // Step 4: Log groups needing review
    // ====================================================================
    if (needsReview.length > 0 && !dryRun) {
      for (const review of needsReview.slice(0, 50)) {
        console.error(`[merge-duplicates] Needs review: "${review.name}" - ${review.reason} - ${review.person_ids.length} people`);
      }
    }

    return apiSuccess({
      dry_run: dryRun,
      stats: {
        // Existing patterns
        duplicate_groups_found: duplicateGroups.length,
        safe_merges_identified: safeMerges.length,
        needs_review: needsReview.length,
        // New patterns (FFS-902)
        pattern_merges_identified: patternMerges.length,
        // Auto-blacklist (FFS-898)
        identifiers_blacklisted: blacklistResults.length,
        // Proxy detection (FFS-1045)
        proxy_identifiers_flagged: proxyResults.length,
        // Stale relationships (FFS-899)
        stale_results: staleResults,
        // Execution
        merged: mergedCount,
        errors: errorCount,
      },
      pattern_merges: dryRun ? patternMerges.slice(0, 20) : undefined,
      safe_merges: dryRun ? safeMerges.slice(0, 20) : undefined,
      needs_review: needsReview.slice(0, 20),
      blacklist_actions: blacklistResults.length > 0 ? blacklistResults.slice(0, 20) : undefined,
      proxy_detections: proxyResults.length > 0 ? proxyResults.slice(0, 20) : undefined,
      merge_results: mergeResults.length > 0 ? mergeResults.slice(0, 20) : undefined,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Merge duplicates error:", error);
    return apiServerError(error instanceof Error ? error.message : "Merge duplicates check failed");
  }
}

/**
 * Execute a single merge with safety gate check.
 * Uses sot.merge_person_into() (not the non-existent sot.merge_people()).
 * p_changed_by is UUID type — pass NULL for automated merges.
 */
async function executeSafeMerge(
  loserId: string,
  winnerId: string,
  reason: string,
  pattern: string
): Promise<MergeResult> {
  try {
    // Safety gate: check if merge is safe
    const safetyCheck = await queryOne<{ person_safe_to_merge: string }>(
      "SELECT sot.person_safe_to_merge($1, $2)",
      [loserId, winnerId]
    );

    if (safetyCheck?.person_safe_to_merge !== "safe") {
      return {
        source_id: loserId,
        target_id: winnerId,
        pattern,
        success: false,
        error: `Safety gate: ${safetyCheck?.person_safe_to_merge || "unknown"}`,
      };
    }

    // Execute merge — p_changed_by is UUID, pass NULL for automated merges
    await execute(
      "SELECT sot.merge_person_into($1, $2, $3, $4)",
      [loserId, winnerId, reason, null]
    );

    return {
      source_id: loserId,
      target_id: winnerId,
      pattern,
      success: true,
    };
  } catch (err) {
    return {
      source_id: loserId,
      target_id: winnerId,
      pattern,
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// POST endpoint for manual triggers with same behavior
export async function POST(request: NextRequest) {
  return GET(request);
}
