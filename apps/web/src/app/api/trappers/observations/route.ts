import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface TrapperSite {
  place_id: string;
  place_name: string;
  full_address: string;
  request_id: string;
  request_status: string;
  request_notes: string | null;
  assigned_at: string;
  last_observation_date: string | null;
  observation_count: number;
  total_cats_from_clinic: number;
  latest_cats_seen: number | null;
  latest_eartips_seen: number | null;
}

interface RecentObservation {
  estimate_id: string;
  place_id: string;
  place_name: string;
  full_address: string;
  total_cats_observed: number;
  eartip_count_observed: number;
  observation_date: string;
  notes: string | null;
}

// GET /api/trappers/observations
// Fetches all sites a trapper can observe (from their assignments)
// and their recent observations
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trapperId = searchParams.get("trapper_id");

  try {
    // Get sites from active request assignments
    const sitesSql = `
      WITH trapper_sites AS (
        SELECT DISTINCT
          p.place_id,
          COALESCE(p.display_name, p.formatted_address) AS place_name,
          p.formatted_address AS full_address,
          r.request_id,
          r.status AS request_status,
          r.notes AS request_notes,
          rta.assigned_at
        FROM trapper.request_trapper_assignments rta
        JOIN ops.requests r ON r.request_id = rta.request_id
        JOIN sot.places p ON p.place_id = r.place_id
        WHERE rta.assignment_status = 'active'
          AND r.status NOT IN ('completed', 'cancelled')
          ${trapperId ? "AND rta.trapper_person_id = $1" : ""}
      ),
      site_observations AS (
        SELECT
          ts.place_id,
          MAX(pce.observation_date) AS last_observation_date,
          COUNT(pce.estimate_id) AS observation_count,
          (
            SELECT pce2.total_cats_observed
            FROM sot.place_colony_estimates pce2
            WHERE pce2.place_id = ts.place_id
              AND pce2.source_type = 'trapper_site_visit'
            ORDER BY pce2.observation_date DESC
            LIMIT 1
          ) AS latest_cats_seen,
          (
            SELECT pce2.eartip_count_observed
            FROM sot.place_colony_estimates pce2
            WHERE pce2.place_id = ts.place_id
              AND pce2.source_type = 'trapper_site_visit'
            ORDER BY pce2.observation_date DESC
            LIMIT 1
          ) AS latest_eartips_seen
        FROM trapper_sites ts
        LEFT JOIN sot.place_colony_estimates pce
          ON pce.place_id = ts.place_id
          AND pce.source_type = 'trapper_site_visit'
        GROUP BY ts.place_id
      ),
      site_clinic_cats AS (
        SELECT
          ts.place_id,
          COUNT(DISTINCT c.cat_id) AS total_cats_from_clinic
        FROM trapper_sites ts
        LEFT JOIN sot.cat_place_relationships cpr ON cpr.place_id = ts.place_id
        LEFT JOIN sot.cats c ON c.cat_id = cpr.cat_id
          AND c.altered_status IN ('spayed', 'neutered')
        GROUP BY ts.place_id
      )
      SELECT
        ts.place_id,
        ts.place_name,
        ts.full_address,
        ts.request_id,
        ts.request_status,
        ts.request_notes,
        ts.assigned_at::TEXT,
        so.last_observation_date::TEXT,
        COALESCE(so.observation_count, 0)::INT AS observation_count,
        COALESCE(scc.total_cats_from_clinic, 0)::INT AS total_cats_from_clinic,
        so.latest_cats_seen::INT,
        so.latest_eartips_seen::INT
      FROM trapper_sites ts
      LEFT JOIN site_observations so ON so.place_id = ts.place_id
      LEFT JOIN site_clinic_cats scc ON scc.place_id = ts.place_id
      ORDER BY
        so.last_observation_date ASC NULLS FIRST,
        ts.assigned_at DESC
    `;

    const sites = await queryRows<TrapperSite>(
      sitesSql,
      trapperId ? [trapperId] : []
    );

    // Get recent observations
    const recentSql = `
      SELECT
        pce.estimate_id,
        pce.place_id,
        COALESCE(p.display_name, p.formatted_address) AS place_name,
        p.formatted_address AS full_address,
        pce.total_cats_observed::INT,
        pce.eartip_count_observed::INT,
        pce.observation_date::TEXT,
        pce.notes
      FROM sot.place_colony_estimates pce
      JOIN sot.places p ON p.place_id = pce.place_id
      WHERE pce.source_type = 'trapper_site_visit'
        AND pce.total_cats_observed IS NOT NULL
      ORDER BY pce.observation_date DESC, pce.created_at DESC
      LIMIT 10
    `;

    const recentObservations = await queryRows<RecentObservation>(recentSql);

    // Get aggregates
    const totalSites = sites.length;
    const sitesNeedingObservation = sites.filter(
      (s) => !s.last_observation_date ||
        new Date(s.last_observation_date) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    ).length;
    const totalObservations = sites.reduce((sum, s) => sum + s.observation_count, 0);

    return NextResponse.json({
      sites,
      recent_observations: recentObservations,
      stats: {
        total_sites: totalSites,
        sites_needing_observation: sitesNeedingObservation,
        total_observations: totalObservations,
      },
    });
  } catch (error) {
    console.error("Error fetching trapper observations:", error);
    return NextResponse.json(
      { error: "Failed to fetch observation data" },
      { status: 500 }
    );
  }
}
