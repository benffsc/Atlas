import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface CatDetailRow {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  altered_by_clinic: boolean | null; // TRUE if we performed the spay/neuter
  breed: string | null;
  color: string | null;
  coat_pattern: string | null;
  microchip: string | null;
  data_source: string | null; // clinichq, petlink, or legacy_import
  ownership_type: string | null; // Community Cat (Feral), Community Cat (Friendly), Owned, Foster
  quality_tier: string | null;
  quality_reason: string | null;
  notes: string | null;
  identifiers: object[];
  owners: object[];
  places: object[];
  created_at: string;
  updated_at: string;
}

interface ClinicVisit {
  visit_date: string;
  appt_number: string;
  client_name: string;
  client_address: string | null;
  client_email: string | null;
  client_phone: string | null;
  ownership_type: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Cat ID is required" },
      { status: 400 }
    );
  }

  try {
    const sql = `
      SELECT
        cat_id,
        display_name,
        sex,
        altered_status,
        altered_by_clinic,
        breed,
        color,
        coat_pattern,
        microchip,
        data_source,
        ownership_type,
        quality_tier,
        quality_reason,
        notes,
        identifiers,
        owners,
        places,
        created_at,
        updated_at
      FROM trapper.v_cat_detail
      WHERE cat_id = $1
    `;

    const cat = await queryOne<CatDetailRow>(sql, [id]);

    if (!cat) {
      return NextResponse.json(
        { error: "Cat not found" },
        { status: 404 }
      );
    }

    // Fetch clinic history (who brought this cat to clinic)
    const clinicHistorySql = `
      SELECT
        visit_date::TEXT,
        appt_number,
        client_name,
        client_address,
        client_email,
        client_phone,
        ownership_type
      FROM trapper.v_cat_clinic_history
      WHERE cat_id = $1
      ORDER BY visit_date DESC
    `;

    const clinicHistory = await queryRows<ClinicVisit>(clinicHistorySql, [id]);

    return NextResponse.json({
      ...cat,
      clinic_history: clinicHistory,
    });
  } catch (error) {
    console.error("Error fetching cat detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch cat detail" },
      { status: 500 }
    );
  }
}
