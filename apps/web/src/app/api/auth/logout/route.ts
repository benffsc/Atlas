import { NextRequest } from "next/server";
import {
  getSessionToken,
  invalidateSession,
  clearSessionCookie,
} from "@/lib/auth";
import { apiSuccess } from "@/lib/api-response";

/**
 * POST /api/auth/logout
 *
 * Log out the current user by invalidating their session.
 */
export async function POST(request: NextRequest) {
  try {
    const token = getSessionToken(request);

    // Create response first
    const response = apiSuccess({ loggedOut: true });

    // Clear the cookie regardless of whether we have a token
    clearSessionCookie(response);

    // If we have a token, invalidate the session in the database
    if (token) {
      await invalidateSession(token, "logout");
    }

    return response;
  } catch (error) {
    console.error("Logout error:", error);

    // Still return success and clear cookie even on error
    const response = apiSuccess({ loggedOut: true });
    clearSessionCookie(response);
    return response;
  }
}
