import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { getConnectedAccounts, disconnectAccount, isOutlookConfigured } from "@/lib/outlook";
import { apiSuccess, apiBadRequest, apiError, apiServerError } from "@/lib/api-response";

/**
 * GET /api/admin/email-settings/accounts
 *
 * Get all connected Outlook email accounts.
 * Admin-only endpoint.
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["admin"]);

    const configured = isOutlookConfigured();
    const accounts = configured ? await getConnectedAccounts() : [];

    return apiSuccess({
      configured,
      accounts,
    });
  } catch (error) {
    console.error("Get email accounts error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return apiError(authError.message, authError.statusCode);
    }

    return apiServerError("Failed to get email accounts");
  }
}

/**
 * DELETE /api/admin/email-settings/accounts
 *
 * Disconnect an Outlook email account.
 * Admin-only endpoint.
 */
export async function DELETE(request: NextRequest) {
  try {
    await requireRole(request, ["admin"]);

    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");

    if (!accountId) {
      return apiBadRequest("Account ID is required");
    }

    await disconnectAccount(accountId);

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("Disconnect account error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return apiError(authError.message, authError.statusCode);
    }

    return apiServerError("Failed to disconnect account");
  }
}
