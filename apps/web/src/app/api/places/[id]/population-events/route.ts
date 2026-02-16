import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface PopulationEvent {
  event_type: "birth" | "death";
  event_id: string;
  event_date: string | null;
  cat_id: string;
  cat_name: string | null;
  details: string | null;
  source_system: string;
  created_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
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
      ORDER BY COALESCE(me.death_date, me.created_at) DESC
      LIMIT 50
    `;

    const [births, deaths] = await Promise.all([
      queryRows<PopulationEvent>(birthsSql, [id]),
      queryRows<PopulationEvent>(deathsSql, [id]),
    ]);

    // Combine and sort by date
    const events = [...births, ...deaths].sort((a, b) => {
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

    return NextResponse.json({ events, summary });
  } catch (error) {
    console.error("Error fetching population events:", error);
    return NextResponse.json(
      { error: "Failed to fetch population events" },
      { status: 500 }
    );
  }
}
