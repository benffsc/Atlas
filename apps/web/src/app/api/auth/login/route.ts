import { NextRequest, NextResponse } from "next/server";
import { login, setSessionCookie } from "@/lib/auth";
import { queryOne } from "@/lib/db";

/**
 * POST /api/auth/login
 *
 * Authenticate a staff member with email and password.
 * Sets an HTTP-only session cookie on success.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Validate required fields
    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Get client info for session
    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0] ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const userAgent = request.headers.get("user-agent") || undefined;

    // Attempt login
    const result = await login(email, password, ipAddress, userAgent);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 401 }
      );
    }

    // Check if password change is required
    const staffInfo = await queryOne<{ password_change_required: boolean }>(
      `SELECT COALESCE(password_change_required, FALSE) as password_change_required
       FROM ops.staff WHERE staff_id = $1`,
      [result.staff!.staff_id]
    );

    // Create response with user data
    const response = NextResponse.json({
      success: true,
      staff: {
        staff_id: result.staff!.staff_id,
        display_name: result.staff!.display_name,
        email: result.staff!.email,
        auth_role: result.staff!.auth_role,
      },
      password_change_required: staffInfo?.password_change_required || false,
    });

    // Set session cookie
    setSessionCookie(response, result.session!.token, result.session!.expiresAt);

    return response;
  } catch (error) {
    console.error("Login error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorType = error instanceof Error ? error.name : typeof error;

    // In development, show more details
    const isDev = process.env.NODE_ENV === "development";

    return NextResponse.json(
      {
        success: false,
        error: isDev
          ? `Login failed: ${errorMessage}`
          : "An error occurred during login",
        // Include debug info in development
        ...(isDev && { debug: { type: errorType, message: errorMessage } }),
      },
      { status: 500 }
    );
  }
}
