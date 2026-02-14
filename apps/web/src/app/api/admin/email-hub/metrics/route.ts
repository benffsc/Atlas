import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

interface EmailHubMetrics {
  connected_accounts: number;
  active_templates: number;
  pending_jobs: number;
  pending_batches: number;
  pending_suggestions: number;
  emails_sent_30d: number;
  emails_failed_30d: number;
  success_rate_30d: number;
}

// Helper to safely query a count, returning 0 if table doesn't exist
async function safeCount(query: string): Promise<number> {
  try {
    const result = await queryOne<{ count: number }>(query);
    return result?.count ?? 0;
  } catch {
    return 0;
  }
}

// GET /api/admin/email-hub/metrics - Get email hub dashboard metrics
export async function GET(request: NextRequest) {
  try {
    // Both admin and staff can view metrics
    await requireRole(request, ["admin", "staff"]);

    // Query each metric separately so missing tables don't break everything
    const [
      connected_accounts,
      active_templates,
      pending_jobs,
      pending_batches,
      pending_suggestions,
      emails_sent_30d,
      emails_failed_30d,
      total_30d,
    ] = await Promise.all([
      safeCount(`SELECT COUNT(*)::INT as count FROM ops.outlook_email_accounts WHERE is_active = TRUE`),
      safeCount(`SELECT COUNT(*)::INT as count FROM ops.email_templates WHERE is_active = TRUE`),
      safeCount(`SELECT COUNT(*)::INT as count FROM ops.email_jobs WHERE status IN ('draft', 'queued')`),
      safeCount(`SELECT COUNT(*)::INT as count FROM ops.email_batches WHERE status = 'draft'`),
      safeCount(`SELECT COUNT(*)::INT as count FROM ops.email_template_suggestions WHERE status = 'pending'`),
      safeCount(`SELECT COUNT(*)::INT as count FROM ops.sent_emails WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '30 days'`),
      safeCount(`SELECT COUNT(*)::INT as count FROM ops.sent_emails WHERE status = 'failed' AND created_at > NOW() - INTERVAL '30 days'`),
      safeCount(`SELECT COUNT(*)::INT as count FROM ops.sent_emails WHERE created_at > NOW() - INTERVAL '30 days'`),
    ]);

    const success_rate_30d = total_30d === 0 ? 100 : Math.round((emails_sent_30d / total_30d) * 1000) / 10;

    const metrics: EmailHubMetrics = {
      connected_accounts,
      active_templates,
      pending_jobs,
      pending_batches,
      pending_suggestions,
      emails_sent_30d,
      emails_failed_30d,
      success_rate_30d,
    };

    return NextResponse.json({ metrics });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error fetching email hub metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}
