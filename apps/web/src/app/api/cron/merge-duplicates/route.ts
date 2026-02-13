import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, query } from "@/lib/db";

// Duplicate People Auto-Merge Cron Job
//
// Identifies and merges exact name duplicate people that are safe to merge:
// - Same normalized name (lowercase, trimmed)
// - No conflicting identifiers (different emails/phones)
// - Not already merged
//
// People with conflicting identifiers are flagged for manual review.
// Runs conservatively to avoid false positives.
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

interface PersonIdentifier {
  person_id: string;
  emails: string[];
  phones: string[];
}

interface MergeResult {
  source_id: string;
  target_id: string;
  success: boolean;
  error?: string;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const dryRun = request.nextUrl.searchParams.get("dry_run") === "true";
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "100", 10);

  try {
    // Step 1: Find exact name duplicates
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
          AND trapper.is_valid_person_name(display_name)
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

    if (duplicateGroups.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No duplicate groups found",
        duration_ms: Date.now() - startTime,
      });
    }

    // Step 2: Get identifiers for all people in duplicate groups
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

    // Build a map of person_id -> { emails, phones }
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

    // Step 3: Determine which groups are safe to auto-merge
    const safeMerges: { source_id: string; target_id: string; name: string }[] = [];
    const needsReview: { name: string; reason: string; person_ids: string[] }[] = [];

    for (const group of duplicateGroups) {
      const { normalized_name, person_ids } = group;

      // Get all identifiers for this group
      const groupIdentifiers = person_ids.map(id => ({
        person_id: id,
        emails: identifierMap.get(id)?.emails || new Set<string>(),
        phones: identifierMap.get(id)?.phones || new Set<string>(),
      }));

      // Check for conflicts: different emails or phones
      const allEmails = new Set<string>();
      const allPhones = new Set<string>();
      let hasConflict = false;

      for (const p of groupIdentifiers) {
        for (const email of p.emails) {
          if (allEmails.has(email)) continue; // Same email is fine
          for (const otherEmail of allEmails) {
            // If different emails exist, might be different people
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

      // Safe to merge: pick the oldest (smallest UUID or earliest created) as target
      // Merge all others into the first one
      const [target_id, ...source_ids] = person_ids;
      for (const source_id of source_ids) {
        safeMerges.push({
          source_id,
          target_id,
          name: normalized_name,
        });
      }
    }

    // Step 4: Execute merges (unless dry run)
    const mergeResults: MergeResult[] = [];
    let mergedCount = 0;
    let errorCount = 0;

    if (!dryRun && safeMerges.length > 0) {
      for (const merge of safeMerges) {
        try {
          const result = await queryOne<{ merge_people: object }>(`
            SELECT sot.merge_people($1, $2, $3, $4)
          `, [merge.source_id, merge.target_id, "auto_merge_exact_name_duplicate", "cron_merge_duplicates"]);

          mergeResults.push({
            source_id: merge.source_id,
            target_id: merge.target_id,
            success: true,
          });
          mergedCount++;
        } catch (err) {
          mergeResults.push({
            source_id: merge.source_id,
            target_id: merge.target_id,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
          errorCount++;
        }
      }
    }

    // Step 5: Log any groups needing review
    if (needsReview.length > 0 && !dryRun) {
      // Insert into a review table if it exists, or just log
      for (const review of needsReview.slice(0, 50)) { // Limit logging
        console.log(`[merge-duplicates] Needs review: "${review.name}" - ${review.reason} - ${review.person_ids.length} people`);
      }
    }

    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      stats: {
        duplicate_groups_found: duplicateGroups.length,
        safe_merges_identified: safeMerges.length,
        needs_review: needsReview.length,
        merged: mergedCount,
        errors: errorCount,
      },
      safe_merges: dryRun ? safeMerges.slice(0, 20) : undefined, // Show preview in dry run
      needs_review: needsReview.slice(0, 20), // Always show some that need review
      merge_results: mergeResults.length > 0 ? mergeResults.slice(0, 20) : undefined,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Merge duplicates error:", error);
    return NextResponse.json(
      {
        error: "Merge duplicates check failed",
        details: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// POST endpoint for manual triggers with same behavior
export async function POST(request: NextRequest) {
  return GET(request);
}
