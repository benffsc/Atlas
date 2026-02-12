import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

export async function GET() {
  try {
    // Get counts from V2 tables
    const [
      sourceCount,
      opsAppointments,
      opsClinicAccounts,
      sotPeople,
      sotCats,
      sotPlaces,
      resolutionStats,
    ] = await Promise.all([
      queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM source.clinichq_raw`),
      queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM ops.appointments`),
      queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM ops.clinic_accounts`),
      queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM sot.people WHERE merged_into_person_id IS NULL`),
      queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM sot.cats WHERE merged_into_cat_id IS NULL`),
      queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM sot.places WHERE merged_into_place_id IS NULL`),
      queryOne<{ stats: Record<string, number> }>(`
        SELECT jsonb_object_agg(COALESCE(resolution_status, 'null'), count) as stats
        FROM (
          SELECT resolution_status, COUNT(*) as count
          FROM ops.appointments
          GROUP BY resolution_status
        ) sub
      `),
    ]);

    return NextResponse.json({
      source: {
        clinichq_raw: parseInt(sourceCount?.count || "0"),
      },
      ops: {
        appointments: parseInt(opsAppointments?.count || "0"),
        clinic_accounts: parseInt(opsClinicAccounts?.count || "0"),
      },
      sot: {
        people: parseInt(sotPeople?.count || "0"),
        cats: parseInt(sotCats?.count || "0"),
        places: parseInt(sotPlaces?.count || "0"),
      },
      resolution: resolutionStats?.stats || {},
    });

  } catch (error) {
    console.error("[V2 Stats] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
