import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession, hashPassword, verifyPassword } from "@/lib/auth";

/**
 * POST /api/auth/change-password
 * Change the current user's password
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { current_password, new_password, confirm_password } = body;

    // Validate inputs
    if (!current_password || !new_password || !confirm_password) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    if (new_password !== confirm_password) {
      return NextResponse.json(
        { error: "New passwords do not match" },
        { status: 400 }
      );
    }

    if (new_password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Get current password hash
    const staff = await queryOne<{ password_hash: string | null }>(
      `SELECT password_hash FROM trapper.staff WHERE staff_id = $1`,
      [session.staff_id]
    );

    if (!staff || !staff.password_hash) {
      return NextResponse.json(
        { error: "Staff not found or password not set" },
        { status: 400 }
      );
    }

    // Verify current password
    const isValid = await verifyPassword(current_password, staff.password_hash);
    if (!isValid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 }
      );
    }

    // Hash new password
    const newHash = await hashPassword(new_password);

    // Update password and clear change requirement
    await queryOne(
      `UPDATE trapper.staff
       SET password_hash = $1,
           password_change_required = FALSE,
           password_set_at = NOW(),
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL
       WHERE staff_id = $2`,
      [newHash, session.staff_id]
    );

    return NextResponse.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    return NextResponse.json(
      { error: "Failed to change password" },
      { status: 500 }
    );
  }
}
