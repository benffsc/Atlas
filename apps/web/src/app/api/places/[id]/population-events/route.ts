import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiSuccess, apiServerError } from "@/lib/api-response";

type LifecycleEventType =
  | "birth" | "death"
  | "tnr_procedure" | "adoption" | "return_to_field"
  | "transfer" | "foster_start" | "foster_end" | "intake";

interface PopulationEvent {
  event_type: LifecycleEventType;
  event_id: string;
  event_date: string | null;
  cat_id: string;
  cat_name: string | null;
  details: string | null;
  source_system: string;
  created_at: string;
}

interface OutcomeSummary {
  tnr_count: number;
  adoption_count: number;
  mortality_count: number;
  rtf_count: number;
  transfer_count: number;
  foster_count: number;
  intake_count: number;
  total_events: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    requireValidUUID(id, "place");
    // Fetch birth events for cats at this place
    const birthsSql = `
      SELECT
        'birth' AS event_type,
        be.birth_event_id AS event_id,
        COALESCE(be.birth_date, be.created_at)::TEXT AS event_date,
        be.cat_id,
        c.display_name AS cat_name,
        CASE
          WHEN be.kitten_count_in_litter IS NOT NULL THEN 'Litter of ' || be.kitten_count_in_litter
          WHEN be.birth_season IS NOT NULL THEN 'Born in ' || be.birth_season
          ELSE NULL
        END AS details,
        be.source_system,
        be.created_at::TEXT
      FROM sot.cat_birth_events be
      JOIN sot.cats c ON c.cat_id = be.cat_id
      WHERE be.place_id = $1
        AND be.deleted_at IS NULL
      ORDER BY COALESCE(be.birth_date, be.created_at) DESC
      LIMIT 50
    `;

    // Fetch death events for cats at this place
    const deathsSql = `
      SELECT
        'death' AS event_type,
        me.mortality_event_id AS event_id,
        COALESCE(me.death_date, me.created_at)::TEXT AS event_date,
        me.cat_id,
        c.display_name AS cat_name,
        CASE
          WHEN me.death_cause IS NOT NULL THEN me.death_cause::TEXT
          ELSE NULL
        END AS details,
        me.source_system,
        me.created_at::TEXT
      FROM sot.cat_mortality_events me
      JOIN sot.cats c ON c.cat_id = me.cat_id
      -- V2: Uses sot.cat_place instead of sot.cat_place_relationships
      JOIN sot.cat_place cpr ON cpr.cat_id = me.cat_id AND cpr.place_id = $1
      WHERE me.deleted_at IS NULL
      ORDER BY COALESCE(me.death_date, me.created_at) DESC
      LIMIT 50
    `;

    // MIG_3009: Lifecycle events query (tnr_procedure, adoption, transfer, etc.)
    const lifecycleSql = `
      SELECT
        le.event_type,
        le.event_id,
        le.event_at::TEXT AS event_date,
        le.cat_id,
        c.display_name AS cat_name,
        COALESCE(le.event_subtype, le.event_type)::TEXT AS details,
        le.source_system,
        le.created_at::TEXT
      FROM sot.cat_lifecycle_events le
      JOIN sot.cats c ON c.cat_id = le.cat_id
      WHERE le.place_id = $1
        AND le.event_type NOT IN ('mortality')
      UNION ALL
      SELECT
        le.event_type,
        le.event_id,
        le.event_at::TEXT AS event_date,
        le.cat_id,
        c.display_name AS cat_name,
        COALESCE(le.event_subtype, le.event_type)::TEXT AS details,
        le.source_system,
        le.created_at::TEXT
      FROM sot.cat_lifecycle_events le
      JOIN sot.cats c ON c.cat_id = le.cat_id
      JOIN sot.cat_place cp ON cp.cat_id = le.cat_id AND cp.place_id = $1
      WHERE le.place_id IS NULL
        AND le.event_type NOT IN ('mortality')
      ORDER BY event_date DESC NULLS LAST
      LIMIT 100
    `;

    // MIG_3009: Outcome summary from view
    const outcomeSql = `
      SELECT
        COALESCE(tnr_count, 0) AS tnr_count,
        COALESCE(adoption_count, 0) AS adoption_count,
        COALESCE(mortality_count, 0) AS mortality_count,
        COALESCE(rtf_count, 0) AS rtf_count,
        COALESCE(transfer_count, 0) AS transfer_count,
        COALESCE(foster_count, 0) AS foster_count,
        COALESCE(intake_count, 0) AS intake_count,
        COALESCE(total_events, 0) AS total_events
      FROM ops.v_place_lifecycle_summary
      WHERE place_id = $1
    `;

    const [births, deaths, lifecycleEvents, outcomeSummary] = await Promise.all([
      queryRows<PopulationEvent>(birthsSql, [id]),
      queryRows<PopulationEvent>(deathsSql, [id]),
      queryRows<PopulationEvent>(lifecycleSql, [id]).catch(() => [] as PopulationEvent[]),
      queryOne<OutcomeSummary>(outcomeSql, [id]).catch(() => null),
    ]);

    // Combine and sort by date
    const events = [...births, ...deaths, ...lifecycleEvents].sort((a, b) => {
      const dateA = new Date(a.event_date || a.created_at);
      const dateB = new Date(b.event_date || b.created_at);
      return dateB.getTime() - dateA.getTime();
    });

    // Calculate summary
    const summary = {
      total_births: births.length,
      total_deaths: deaths.length,
      births_this_year: births.filter((b) => {
        const date = new Date(b.event_date || b.created_at);
        return date.getFullYear() === new Date().getFullYear();
      }).length,
      deaths_this_year: deaths.filter((d) => {
        const date = new Date(d.event_date || d.created_at);
        return date.getFullYear() === new Date().getFullYear();
      }).length,
    };

    return apiSuccess({
      events,
      summary,
      outcome_summary: outcomeSummary || {
        tnr_count: 0, adoption_count: 0, mortality_count: 0,
        rtf_count: 0, transfer_count: 0, foster_count: 0,
        intake_count: 0, total_events: 0,
      },
    });
  } catch (error) {
    console.error("Error fetching population events:", error);
    return apiServerError("Failed to fetch population events");
  }
}
