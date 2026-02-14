import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

/**
 * GET /api/beacon/demographics
 *
 * Returns Sonoma County demographic reference data.
 *
 * Query params:
 *   - zone: filter by service_zone (optional)
 *   - zip: filter by specific zip code (optional)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const zone = searchParams.get("zone");
  const zip = searchParams.get("zip");

  try {
    // If requesting a specific zip
    if (zip) {
      const row = await queryOne<{
        zip: string;
        city: string;
        service_zone: string;
        population_2023: number;
        households_2023: number;
        median_household_income_2023: number;
        housing_units: number;
        pct_renter_occupied: number;
        pct_owner_occupied: number;
        urbanization: string;
        notes: string;
      }>(
        `SELECT * FROM ops.sonoma_zip_demographics WHERE zip = $1`,
        [zip]
      );

      if (!row) {
        return NextResponse.json(
          { error: "Zip code not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ data: row });
    }

    // Get all or by zone
    const rows = await queryRows<{
      zip: string;
      city: string;
      service_zone: string;
      population_2023: number;
      households_2023: number;
      median_household_income_2023: number;
      urbanization: string;
      notes: string;
    }>(
      `SELECT zip, city, service_zone, population_2023, households_2023,
              median_household_income_2023, urbanization, notes
       FROM ops.sonoma_zip_demographics
       ${zone ? "WHERE service_zone = $1" : ""}
       ORDER BY service_zone, population_2023 DESC`,
      zone ? [zone] : []
    );

    // Calculate zone summary if no zone filter
    const summary = zone
      ? null
      : await queryRows<{
          service_zone: string;
          total_population: number;
          total_households: number;
          avg_median_income: number;
          zip_count: number;
        }>(
          `SELECT
           service_zone,
           SUM(population_2023) as total_population,
           SUM(households_2023) as total_households,
           ROUND(AVG(median_household_income_2023), 0) as avg_median_income,
           COUNT(*) as zip_count
         FROM ops.sonoma_zip_demographics
         GROUP BY service_zone
         ORDER BY total_population DESC`
        );

    return NextResponse.json({
      data: rows,
      summary: summary || undefined,
      total_zips: rows.length,
      total_population: rows.reduce((sum, r) => sum + (r.population_2023 || 0), 0),
    });
  } catch (error) {
    console.error("Error fetching demographics:", error);
    return NextResponse.json(
      { error: "Failed to fetch demographics data" },
      { status: 500 }
    );
  }
}
