import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * Unified Identity Review API
 *
 * Consolidates data from:
 * - v_person_dedup_candidates (person-dedup)
 * - v_tier4_pending_review (merge-review)
 * - data_engine_match_decisions (data-engine/review)
 *
 * Returns a unified format for the identity review page.
 */

export interface UnifiedReviewItem {
  id: string;
  source: "dedup" | "tier4" | "data_engine";
  tier: number;
  tierLabel: string;
  tierColor: string;
  similarity: number;
  matchReason: string;
  queueHours: number;
  // Fellegi-Sunter fields (MIG_949)
  matchProbability: number | null;
  compositeScore: number | null;
  fieldScores: Record<string, number> | null;
  comparisonVector: Record<string, string> | null;
  left: {
    id: string;
    name: string;
    emails: string[] | null;
    phones: string[] | null;
    address: string | null;
    createdAt: string | null;
    cats: number;
    requests: number;
    appointments: number;
    places: number;
  };
  right: {
    id: string | null;
    name: string;
    emails: string[] | null;
    phones: string[] | null;
    address: string | null;
    source: string | null;
  };
}

const TIER_CONFIG: Record<number, { label: string; color: string }> = {
  1: { label: "Email Match", color: "#198754" },
  2: { label: "Phone + Name", color: "#0d6efd" },
  3: { label: "Phone Only", color: "#fd7e14" },
  4: { label: "Name + Address", color: "#6f42c1" },
  5: { label: "Name Only", color: "#dc3545" },
  6: { label: "Uncertain", color: "#6c757d" },
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const offset = parseInt(searchParams.get("offset") || "0");
  const filter = searchParams.get("filter") || null; // tier1, tier2, tier3, tier4, tier5, uncertain, all

  try {
    const items: UnifiedReviewItem[] = [];

    // Determine which tiers to fetch based on filter
    const fetchDedup = !filter || filter === "all" || ["tier1", "tier2", "tier3", "tier5"].includes(filter);
    const fetchTier4 = !filter || filter === "all" || filter === "tier4";
    const fetchDataEngine = !filter || filter === "all" || filter === "uncertain";

    // Get tier filter for dedup query
    let tierFilter = "";
    if (filter === "tier1") tierFilter = "AND match_tier = 1";
    else if (filter === "tier2") tierFilter = "AND match_tier = 2";
    else if (filter === "tier3") tierFilter = "AND match_tier = 3";
    else if (filter === "tier5") tierFilter = "AND match_tier = 5";

    // 1. Fetch from person_dedup_candidates (excludes tier 4 which we get from tier4 view)
    // Note: v_person_dedup_candidates is a VIEW that already filters for unmerged people
    // It doesn't have a status column - all rows are implicitly pending
    if (fetchDedup) {
      const dedupRows = await queryRows<{
        canonical_person_id: string;
        duplicate_person_id: string;
        match_tier: number;
        shared_email: string | null;
        shared_phone: string | null;
        canonical_name: string;
        duplicate_name: string;
        name_similarity: number;
        canonical_created_at: string;
        duplicate_created_at: string;
      }>(`
        SELECT
          canonical_person_id::text,
          duplicate_person_id::text,
          match_tier,
          shared_email,
          shared_phone,
          canonical_name,
          duplicate_name,
          name_similarity,
          canonical_created_at::text,
          duplicate_created_at::text
        FROM sot.v_person_dedup_candidates
        WHERE match_tier != 4  -- We get tier 4 from the dedicated view
          ${tierFilter}
        ORDER BY canonical_created_at ASC
        LIMIT ${limit} OFFSET ${offset}
      `, []);

      for (const row of dedupRows) {
        const tier = row.match_tier;
        const config = TIER_CONFIG[tier] || TIER_CONFIG[5];
        // Dedup items don't have F-S scores yet (they use legacy matching)
        // We estimate probability based on tier for display consistency
        const estimatedProbability = tier === 1 ? 0.99 : tier === 2 ? 0.90 : tier === 3 ? 0.75 : 0.60;
        items.push({
          id: `dedup:${row.canonical_person_id}:${row.duplicate_person_id}`,
          source: "dedup",
          tier,
          tierLabel: config.label,
          tierColor: config.color,
          similarity: row.name_similarity,
          matchReason: row.shared_email
            ? `Email: ${row.shared_email}`
            : row.shared_phone
              ? `Phone: ${row.shared_phone}`
              : "Name similarity",
          queueHours: (Date.now() - new Date(row.canonical_created_at).getTime()) / (1000 * 60 * 60),
          matchProbability: estimatedProbability,
          compositeScore: null,
          fieldScores: null,
          comparisonVector: null,
          left: {
            id: row.canonical_person_id,
            name: row.canonical_name,
            emails: row.shared_email ? [row.shared_email] : null,
            phones: row.shared_phone ? [row.shared_phone] : null,
            address: null,
            createdAt: row.canonical_created_at,
            cats: 0,
            requests: 0,
            appointments: 0,
            places: 0,
          },
          right: {
            id: row.duplicate_person_id,
            name: row.duplicate_name,
            emails: null,
            phones: null,
            address: null,
            source: null,
          },
        });
      }
    }

    // 2. Fetch from tier4_pending_review
    if (fetchTier4) {
      const tier4Rows = await queryRows<{
        duplicate_id: string;
        existing_person_id: string;
        potential_match_id: string;
        name_similarity: number;
        detected_at: string;
        existing_name: string;
        existing_created_at: string;
        existing_emails: string[] | null;
        existing_phones: string[] | null;
        new_name: string;
        new_source: string | null;
        shared_address: string | null;
        existing_cat_count: number;
        existing_request_count: number;
        existing_appointment_count: number;
        incoming_email: string | null;
        incoming_phone: string | null;
        incoming_address: string | null;
        hours_in_queue: number;
        decision_reason: string | null;
      }>(`
        SELECT
          duplicate_id::text,
          existing_person_id::text,
          potential_match_id::text,
          COALESCE(name_similarity, 0)::float as name_similarity,
          detected_at::text,
          existing_name,
          existing_created_at::text,
          existing_emails,
          existing_phones,
          new_name,
          new_source,
          shared_address,
          COALESCE(existing_cat_count, 0)::int as existing_cat_count,
          COALESCE(existing_request_count, 0)::int as existing_request_count,
          COALESCE(existing_appointment_count, 0)::int as existing_appointment_count,
          incoming_email,
          incoming_phone,
          incoming_address,
          COALESCE(hours_in_queue, 0)::float as hours_in_queue,
          decision_reason
        FROM ops.v_tier4_pending_review
        ORDER BY hours_in_queue DESC
        LIMIT ${limit} OFFSET ${offset}
      `, []);

      for (const row of tier4Rows) {
        const config = TIER_CONFIG[4];
        // Tier 4 has name+address agreement - estimate probability ~85%
        items.push({
          id: `tier4:${row.duplicate_id}`,
          source: "tier4",
          tier: 4,
          tierLabel: config.label,
          tierColor: config.color,
          similarity: row.name_similarity,
          matchReason: row.shared_address
            ? `Same address: ${row.shared_address}`
            : row.decision_reason || "Same name + address",
          queueHours: row.hours_in_queue,
          matchProbability: 0.85,
          compositeScore: null,
          fieldScores: null,
          comparisonVector: { name_similar_high: "agree", address_exact: "agree" },
          left: {
            id: row.existing_person_id,
            name: row.existing_name,
            emails: row.existing_emails,
            phones: row.existing_phones,
            address: row.shared_address,
            createdAt: row.existing_created_at,
            cats: row.existing_cat_count,
            requests: row.existing_request_count,
            appointments: row.existing_appointment_count,
            places: 0,
          },
          right: {
            id: row.potential_match_id,
            name: row.new_name,
            emails: row.incoming_email ? [row.incoming_email] : null,
            phones: row.incoming_phone ? [row.incoming_phone] : null,
            address: row.incoming_address,
            source: row.new_source,
          },
        });
      }
    }

    // 3. Fetch from data_engine_match_decisions (uncertain matches)
    if (fetchDataEngine) {
      const engineRows = await queryRows<{
        decision_id: string;
        source_system: string;
        incoming_email: string | null;
        incoming_phone: string | null;
        incoming_name: string | null;
        incoming_address: string | null;
        top_candidate_person_id: string | null;
        top_candidate_name: string | null;
        top_candidate_score: number | null;
        decision_reason: string | null;
        processed_at: string;
        // F-S fields (MIG_949)
        fs_composite_score: number | null;
        fs_match_probability: number | null;
        fs_field_scores: Record<string, number> | null;
        comparison_vector: Record<string, string> | null;
      }>(`
        SELECT
          decision_id::text,
          source_system,
          incoming_email,
          incoming_phone,
          incoming_name,
          incoming_address,
          top_candidate_person_id::text,
          (SELECT display_name FROM sot.people WHERE person_id = demd.top_candidate_person_id) as top_candidate_name,
          top_candidate_score,
          decision_reason,
          created_at::text as processed_at,
          fs_composite_score::numeric,
          fs_match_probability::numeric,
          fs_field_scores,
          comparison_vector
        FROM sot.data_engine_match_decisions demd
        WHERE decision_type = 'review_pending'
          AND review_status = 'needs_review'
        ORDER BY created_at ASC
        LIMIT ${limit} OFFSET ${offset}
      `, []);

      for (const row of engineRows) {
        const config = TIER_CONFIG[6];
        // Use F-S probability if available, otherwise fall back to legacy score
        const probability = row.fs_match_probability ?? row.top_candidate_score ?? 0;
        items.push({
          id: `engine:${row.decision_id}`,
          source: "data_engine",
          tier: 6,
          tierLabel: config.label,
          tierColor: config.color,
          similarity: row.top_candidate_score || 0,
          matchReason: row.decision_reason || "Uncertain match",
          queueHours: (Date.now() - new Date(row.processed_at).getTime()) / (1000 * 60 * 60),
          matchProbability: probability,
          compositeScore: row.fs_composite_score,
          fieldScores: row.fs_field_scores,
          comparisonVector: row.comparison_vector,
          left: {
            id: row.top_candidate_person_id || "",
            name: row.top_candidate_name || "(no match found)",
            emails: null,
            phones: null,
            address: null,
            createdAt: null,
            cats: 0,
            requests: 0,
            appointments: 0,
            places: 0,
          },
          right: {
            id: null,
            name: row.incoming_name || "(no name)",
            emails: row.incoming_email ? [row.incoming_email] : null,
            phones: row.incoming_phone ? [row.incoming_phone] : null,
            address: row.incoming_address,
            source: row.source_system,
          },
        });
      }
    }

    // Sort by queue hours descending (oldest first)
    items.sort((a, b) => b.queueHours - a.queueHours);

    // Get stats
    // Note: v_person_dedup_candidates is a VIEW that already filters for unmerged people
    // It doesn't have a status column - all rows are implicitly pending
    const stats = await queryOne<{
      total: number;
      tier1: number;
      tier2: number;
      tier3: number;
      tier4: number;
      tier5: number;
      uncertain: number;
    }>(`
      SELECT
        (
          (SELECT COUNT(*) FROM sot.v_person_dedup_candidates) +
          (SELECT COUNT(*) FROM ops.v_tier4_pending_review) +
          (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'review_pending' AND reviewed_at IS NULL)
        )::int as total,
        (SELECT COUNT(*) FROM sot.v_person_dedup_candidates WHERE match_tier = 1)::int as tier1,
        (SELECT COUNT(*) FROM sot.v_person_dedup_candidates WHERE match_tier = 2)::int as tier2,
        (SELECT COUNT(*) FROM sot.v_person_dedup_candidates WHERE match_tier = 3)::int as tier3,
        (SELECT COUNT(*) FROM ops.v_tier4_pending_review)::int as tier4,
        (SELECT COUNT(*) FROM sot.v_person_dedup_candidates WHERE match_tier = 5)::int as tier5,
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'review_pending' AND reviewed_at IS NULL)::int as uncertain
    `, []);

    return NextResponse.json({
      items: items.slice(0, limit),
      stats: stats || { total: 0, tier1: 0, tier2: 0, tier3: 0, tier4: 0, tier5: 0, uncertain: 0 },
      pagination: {
        limit,
        offset,
        hasMore: items.length > limit,
      },
    });
  } catch (error) {
    console.error("Error fetching identity reviews:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * POST: Resolve a review item
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action, notes } = body;

    if (!id || !action) {
      return NextResponse.json(
        { error: "id and action are required" },
        { status: 400 }
      );
    }

    const validActions = ["merge", "keep_separate", "dismiss"];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
        { status: 400 }
      );
    }

    // Parse the composite ID: source:id1:id2 or source:id
    const [source, ...idParts] = id.split(":");

    if (source === "dedup") {
      // Call person-dedup resolution
      const [canonicalId, duplicateId] = idParts;
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/admin/person-dedup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            canonical_person_id: canonicalId,
            duplicate_person_id: duplicateId,
            action,
          }),
        }
      );
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } else if (source === "tier4") {
      // Call merge-review resolution
      const duplicateId = idParts[0];
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/admin/merge-review/${duplicateId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, notes, resolved_by: "unified_review" }),
        }
      );
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } else if (source === "engine") {
      // Call data-engine review resolution
      const decisionId = idParts[0];
      const engineAction = action === "merge" ? "merge" : action === "keep_separate" ? "approve" : "reject";
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/admin/data-engine/review/${decisionId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: engineAction }),
        }
      );
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json({ error: "Unknown source type" }, { status: 400 });
  } catch (error) {
    console.error("Error resolving review:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
