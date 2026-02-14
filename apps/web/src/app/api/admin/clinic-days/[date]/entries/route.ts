import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ date: string }>;
}

/**
 * GET /api/admin/clinic-days/[date]/entries
 * V2: No separate entries table - return empty array
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // V2: Clinic day entries are derived from appointments, not stored separately
    return NextResponse.json({ entries: [] });
  } catch (error) {
    console.error("Clinic day entries error:", error);
    return NextResponse.json(
      { error: "Failed to fetch entries" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/clinic-days/[date]/entries
 * V2: Not supported - entries come from ClinicHQ uploads
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // V2: Manual entry creation not supported - data comes from ClinicHQ uploads
    return NextResponse.json(
      { error: "Manual entry creation not available in V2. Upload ClinicHQ data instead." },
      { status: 400 }
    );
  } catch (error) {
    console.error("Clinic day entry create error:", error);
    return NextResponse.json(
      { error: "Failed to create entry" },
      { status: 500 }
    );
  }
}
