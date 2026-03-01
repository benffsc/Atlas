import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getAuthUrl, isOutlookConfigured } from "@/lib/outlook";
import { apiError, apiServerError } from "@/lib/api-response";

/**
 * GET /api/auth/outlook/connect
 *
 * Initiates the Microsoft OAuth flow to connect an Outlook account.
 * Redirects the user to Microsoft's authorization page.
 *
 * Admin-only endpoint.
 */
export async function GET(request: NextRequest) {
  try {
    // Require admin role to connect email accounts
    const staff = await requireRole(request, ["admin"]);

    // Check if Outlook integration is configured
    if (!isOutlookConfigured()) {
      return apiError(
        "Outlook integration is not configured. Please set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_TENANT_ID.",
        503
      );
    }

    // Build the redirect URI for the callback
    const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
    const host = request.headers.get("host") || "localhost:3000";
    const redirectUri = `${protocol}://${host}/api/auth/outlook/callback`;

    // Generate a state parameter with the staff ID for security
    // This prevents CSRF attacks and lets us know who initiated the flow
    const state = Buffer.from(JSON.stringify({
      staffId: staff.staff_id,
      timestamp: Date.now(),
    })).toString("base64url");

    // Get the Microsoft authorization URL
    const authUrl = getAuthUrl(redirectUri, state);

    // Redirect to Microsoft
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error("Outlook connect error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return apiError(authError.message, authError.statusCode);
    }

    return apiServerError("Failed to initiate Outlook connection");
  }
}
