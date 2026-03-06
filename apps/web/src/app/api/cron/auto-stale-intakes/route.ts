import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError, apiError } from "@/lib/api-response";

// Auto-Stale Intakes Cron (FFS-127)
//
// Marks old intakes as archived when they've gone stale:
// - Status 'new' with no activity for 30+ days
// - Status 'in_progress' with no contact for 14+ days
//
// Creates a journal entry for each auto-staled intake.
// Runs daily at 6 AM UTC.

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

// Thresholds
const NEW_STALE_DAYS = 30;
const IN_PROGRESS_STALE_DAYS = 14;
const BATCH_LIMIT = 200;

interface StaleSubmission {
  submission_id: string;
  submission_status: string;
  submitter_name: string | null;
  days_idle: number;
  reason: string;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return apiError("Unauthorized", 401);
  }

  const startTime = Date.now();

  try {
    // Find stale intakes
    const staleSubmissions = await queryRows<StaleSubmission>(
      `
      SELECT
        s.submission_id,
        s.submission_status,
        s.submitter_name,
        EXTRACT(DAY FROM NOW() - COALESCE(s.last_contacted_at, s.submitted_at, s.created_at))::INT AS days_idle,
        CASE
          WHEN s.submission_status = 'new'
            THEN 'No activity for ' || EXTRACT(DAY FROM NOW() - COALESCE(s.last_contacted_at, s.submitted_at, s.created_at))::INT || ' days (threshold: ${NEW_STALE_DAYS})'
          WHEN s.submission_status = 'in_progress'
            THEN 'No contact for ' || EXTRACT(DAY FROM NOW() - COALESCE(s.last_contacted_at, s.submitted_at, s.created_at))::INT || ' days (threshold: ${IN_PROGRESS_STALE_DAYS})'
        END AS reason
      FROM ops.intake_submissions s
      WHERE s.submission_status IN ('new', 'in_progress')
        AND COALESCE(s.is_test, FALSE) = FALSE
        AND s.converted_to_request_id IS NULL
        AND (
          (s.submission_status = 'new'
            AND COALESCE(s.last_contacted_at, s.submitted_at, s.created_at) < NOW() - INTERVAL '${NEW_STALE_DAYS} days')
          OR
          (s.submission_status = 'in_progress'
            AND COALESCE(s.last_contacted_at, s.submitted_at, s.created_at) < NOW() - INTERVAL '${IN_PROGRESS_STALE_DAYS} days')
        )
      ORDER BY COALESCE(s.last_contacted_at, s.submitted_at, s.created_at) ASC
      LIMIT ${BATCH_LIMIT}
      `,
      []
    );

    if (staleSubmissions.length === 0) {
      return apiSuccess({
        message: "No stale intakes found",
        processed: 0,
        staled: 0,
        errors: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    let staledCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const sub of staleSubmissions) {
      try {
        // Mark as archived
        await queryOne(
          `UPDATE ops.intake_submissions
           SET submission_status = 'archived',
               updated_at = NOW()
           WHERE submission_id = $1`,
          [sub.submission_id]
        );

        // Create journal entry for audit trail
        await queryOne(
          `INSERT INTO ops.journal_entries (
            primary_submission_id,
            entry_kind,
            title,
            body,
            contact_method,
            contact_result,
            created_by,
            occurred_at,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          [
            sub.submission_id,
            "system",
            "Auto-archived: stale intake",
            `Automatically archived after ${sub.days_idle} days without activity. ${sub.reason}. Previous status: ${sub.submission_status}.`,
            "system",
            "auto_archived",
            "system_auto_stale",
          ]
        );

        staledCount++;
      } catch (err) {
        errorCount++;
        errors.push(`${sub.submission_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.log(`[auto-stale-intakes] Processed ${staleSubmissions.length}, archived ${staledCount}, errors ${errorCount}`);

    return apiSuccess({
      message: `Archived ${staledCount} stale intakes`,
      processed: staleSubmissions.length,
      staled: staledCount,
      errors: errorCount,
      error_details: errors.length > 0 ? errors : undefined,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Auto-stale intakes cron error:", error);
    return apiServerError(error instanceof Error ? error.message : "Failed to process stale intakes");
  }
}

// Support POST for manual triggering
export async function POST(request: NextRequest) {
  return GET(request);
}
