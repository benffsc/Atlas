import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

export async function GET(_request: NextRequest) {
  try {
    const status = await queryRows<{
      sync_type: string;
      last_sync_at: string | null;
      last_record_time: string | null;
      last_batch_size: number | null;
      pending_processing: number;
      sync_health: string;
    }>(
      `SELECT sync_type, last_sync_at, last_record_time,
              last_batch_size, pending_processing::int, sync_health
       FROM trapper.v_shelterluv_sync_status
       ORDER BY sync_type`
    );

    return NextResponse.json({ status });
  } catch (error) {
    console.error("Error fetching ShelterLuv status:", error);
    return NextResponse.json(
      { error: "Failed to fetch status", status: [] },
      { status: 500 }
    );
  }
}
