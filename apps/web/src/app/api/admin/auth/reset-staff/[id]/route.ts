import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/auth/reset-staff/[id]
 * Reset a staff member's password to default
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id: staffId } = await params;

    // Default password from environment variable (secure)
    const DEFAULT_PASSWORD = process.env.STAFF_DEFAULT_PASSWORD;
    if (!DEFAULT_PASSWORD) {
      return NextResponse.json(
        { error: "STAFF_DEFAULT_PASSWORD environment variable is not configured" },
        { status: 500 }
      );
    }
    const passwordHash = await hashPassword(DEFAULT_PASSWORD);

    // Update staff password
    const result = await queryOne<{ display_name: string; email: string }>(
      `UPDATE ops.staff
       SET password_hash = $1,
           password_change_required = TRUE,
           password_set_at = NOW(),
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL,
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
      message: `Password reset for ${result.display_name}. They will need to change it on next login.`,
      staff: {
        display_name: result.display_name,
        email: result.email,
      },
      // Note: Password is NOT returned in response for security
    });
  } catch (error) {
    console.error("Reset staff password error:", error);
    return NextResponse.json(
      { error: "Failed to reset password" },
      { status: 500 }
    );
  }
}
