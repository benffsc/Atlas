import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/**
 * GET /api/auth/me
 *
 * Get the currently authenticated user's information.
 * Returns 401 if not authenticated.
 */
export async function GET(request: NextRequest) {
  try {
    const staff = await getSession(request);

    if (!staff) {
      return NextResponse.json(
        { authenticated: false },
        { status: 401 }
      );
    }

    return NextResponse.json({
      authenticated: true,
      staff: {
        staff_id: staff.staff_id,
        display_name: staff.display_name,
        email: staff.email,
        auth_role: staff.auth_role,
        password_change_required: staff.password_change_required || false,
      },
    });
  } catch (error) {
    console.error("Auth check error:", error);
    return NextResponse.json(
      { authenticated: false, error: "Failed to check authentication" },
      { status: 500 }
    );
  }
}
