import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { apiSuccess, apiUnauthorized, apiServerError } from "@/lib/api-response";

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
      return apiUnauthorized("Not authenticated");
    }

    return apiSuccess({
      authenticated: true,
      staff: {
        staff_id: staff.staff_id,
        display_name: staff.display_name,
        email: staff.email,
        auth_role: staff.auth_role,
        person_id: staff.person_id || null,
        password_change_required: staff.password_change_required || false,
      },
    });
  } catch (error) {
    console.error("Auth check error:", error);
    return apiServerError("Failed to check authentication");
  }
}
