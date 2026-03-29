import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiServerError } from "@/lib/api-response";

interface ReadinessResult {
  readiness_score: number;
  readiness_label: string;
  dimension_scores: {
    alteration: { score: number; max: number; rate_pct: number | null };
    breeding_absence: { score: number; max: number; has_recent_breeding: boolean };
    stability: { score: number; max: number; trend: string };
    recency: { score: number; max: number; days_since_activity: number | null };
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "place");

    const result = await queryOne<ReadinessResult>(
      `SELECT readiness_score, readiness_label, dimension_scores
       FROM ops.compute_place_readiness($1)`,
      [id]
    );

    if (!result) {
      return apiSuccess({
        readiness_score: 0,
        readiness_label: "needs_work",
        dimension_scores: {
          alteration: { score: 0, max: 25, rate_pct: null },
          breeding_absence: { score: 25, max: 25, has_recent_breeding: false },
          stability: { score: 10, max: 25, trend: "insufficient_data" },
          recency: { score: 0, max: 25, days_since_activity: null },
        },
      });
    }

    return apiSuccess(result);
  } catch (error) {
    console.error("Error fetching place readiness:", error);
    return apiServerError("Failed to fetch place readiness");
  }
}
