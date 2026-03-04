import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  exchangeCodeForTokens,
  getGraphUser,
  saveOutlookAccount,
  isOutlookConfigured,
} from "@/lib/outlook";

/**
 * GET /api/auth/outlook/callback
 *
 * Handles the OAuth callback from Microsoft after user authorization.
 * Exchanges the authorization code for tokens and saves the connected account.
 */
export async function GET(request: NextRequest) {
  // Extract base URL for redirects
  const baseUrl = new URL(request.url).origin;

  try {
    // Check if Outlook integration is configured
    if (!isOutlookConfigured()) {
      return redirectWithError("Outlook integration is not configured", baseUrl);
    }

    // Get the authorization code and state from the URL
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    // Handle error from Microsoft
    if (error) {
      console.error("Microsoft OAuth error:", error, errorDescription);
      return redirectWithError(errorDescription || error, baseUrl);
    }

    // Validate we have a code
    if (!code) {
      return redirectWithError("No authorization code received", baseUrl);
    }

    // Validate and parse the state parameter
    if (!state) {
      return redirectWithError("Invalid state parameter", baseUrl);
    }

    let stateData: { staffId: string; timestamp: number };
    try {
      stateData = JSON.parse(Buffer.from(state, "base64url").toString());
    } catch {
      return redirectWithError("Invalid state parameter", baseUrl);
    }

    // Check state timestamp (10 minute expiry)
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return redirectWithError("Authorization request expired. Please try again.", baseUrl);
    }

    // Verify the user is still logged in and is the one who started the flow
    const session = await getSession(request);
    if (!session) {
      return redirectWithError("Session expired. Please log in and try again.", baseUrl);
    }

    if (session.staff_id !== stateData.staffId) {
      return redirectWithError("Session mismatch. Please try again.", baseUrl);
    }

    // Verify admin role
    if (session.auth_role !== "admin") {
      return redirectWithError("Admin access required to connect email accounts.", baseUrl);
    }

    // Build the redirect URI (must match exactly what was used in connect)
    const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
    const host = request.headers.get("host") || "localhost:3000";
    const redirectUri = `${protocol}://${host}/api/auth/outlook/callback`;

    // Exchange the code for tokens
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Get user profile from Microsoft Graph
    const graphUser = await getGraphUser(tokens.access_token);

    // Save the connected account
    const accountId = await saveOutlookAccount(
      graphUser.mail || graphUser.userPrincipalName,
      graphUser.displayName,
      graphUser.id,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in,
      session.staff_id
    );

    console.error(`[OUTLOOK] Account connected: ${graphUser.mail || graphUser.userPrincipalName} (${accountId})`);

    // Redirect to email settings with success message
    return NextResponse.redirect(
      new URL(`/admin/email-settings?connected=${encodeURIComponent(graphUser.mail || graphUser.userPrincipalName)}`, request.url)
    );
  } catch (error) {
    console.error("Outlook callback error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const baseUrl = new URL(request.url).origin;
    return redirectWithError(message, baseUrl);
  }
}

/**
 * Helper to create a redirect response with an error message
 */
function redirectWithError(error: string, baseUrl?: string): NextResponse {
  // Use the provided base URL or fall back to production URL
  const base = baseUrl || process.env.NEXT_PUBLIC_BASE_URL || "https://atlas.forgottenfelines.org";
  const url = new URL("/admin/email-settings", base);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url.toString());
}
