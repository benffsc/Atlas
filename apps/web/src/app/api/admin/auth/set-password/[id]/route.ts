import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/auth/set-password/[id]
 * Set a staff member's password to a specific value (admin only)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id: staffId } = await params;
    const body = await request.json();
    const { password } = body;

    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);

    // Update staff password
    const result = await queryOne<{ display_name: string; email: string }>(
      `UPDATE ops.staff
       SET password_hash = $1,
           login_attempts = 0,
           locked_until = NULL
       WHERE staff_id = $2 AND is_active = TRUE
       RETURNING display_name, email`,
      [passwordHash, staffId]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Staff member not found or inactive" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Password set for ${result.display_name}`,
      staff: {
        display_name: result.display_name,
        email: result.email,
      },
    });
  } catch (error) {
    console.error("Set password error:", error);
    return NextResponse.json(
      { error: "Failed to set password" },
      { status: 500 }
    );
  }
}
