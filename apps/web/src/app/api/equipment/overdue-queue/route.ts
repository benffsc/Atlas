import { queryRows } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling } from "@/lib/api-validation";
import { NextRequest } from "next/server";

/**
 * GET /api/equipment/overdue-queue
 *
 * Person-centric overdue equipment call queue.
 * Returns rows from ops.v_equipment_overdue_queue with filtering.
 *
 * FFS-1333 (Equipment Follow-Up Call Queue epic FFS-1331).
 */

// OverdueQueueRow type is in @/lib/types/view-contracts.ts
import type { OverdueQueueRow } from "@/lib/types/view-contracts";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);

  const tier = searchParams.get("tier"); // critical, warning, new, all
  const type = searchParams.get("type"); // public, trapper, all
  const search = searchParams.get("search")?.trim();

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (tier && tier !== "all") {
    conditions.push(`urgency_tier = $${idx}`);
    params.push(tier);
    idx++;
  }

  if (type === "public") {
    conditions.push(`is_trapper = false`);
  } else if (type === "trapper") {
    conditions.push(`is_trapper = true`);
  }

  if (search) {
    conditions.push(`(holder_name ILIKE $${idx} OR phone ILIKE $${idx} OR email ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await queryRows<OverdueQueueRow>(
    `SELECT * FROM ops.v_equipment_overdue_queue ${where}
     ORDER BY priority_score DESC`,
    params,
  );

  // Compute tier summary counts (always from the full view, unfiltered)
  const summary = await queryRows<{ urgency_tier: string; people: number; traps: number }>(
    `SELECT urgency_tier, COUNT(*)::int AS people, SUM(trap_count)::int AS traps
     FROM ops.v_equipment_overdue_queue
     GROUP BY urgency_tier`,
  );

  const tierCounts: Record<string, { people: number; traps: number }> = {};
  for (const row of summary) {
    tierCounts[row.urgency_tier] = { people: row.people, traps: row.traps };
  }

  return apiSuccess({
    queue: rows,
    summary: tierCounts,
    total: rows.length,
  });
});
