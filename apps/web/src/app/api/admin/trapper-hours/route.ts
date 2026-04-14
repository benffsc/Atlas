import { NextRequest } from "next/server";
import { queryRows, queryOne, execute } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import {
  withErrorHandling,
  ApiError,
  requireValidUUID,
  parsePagination,
  requireField,
} from "@/lib/api-validation";

const VALID_STATUSES = ["draft", "submitted", "approved"] as const;
const VALID_PERIOD_TYPES = ["weekly", "monthly"] as const;

type TimeEntryStatus = (typeof VALID_STATUSES)[number];
type PeriodType = (typeof VALID_PERIOD_TYPES)[number];

interface TimeEntry {
  entry_id: string;
  person_id: string;
  period_type: string;
  period_start: string;
  period_end: string;
  hours_total: number;
  hours_trapping: number | null;
  hours_admin: number | null;
  hours_transport: number | null;
  hours_training: number | null;
  hours_other: number | null;
  pay_type: string | null;
  hourly_rate: number | null;
  total_pay: number | null;
  notes: string | null;
  work_summary: string | null;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string | null;
}

interface TimeEntryStats {
  total_entries: number;
  total_hours: number;
  total_pay: number;
  draft_count: number;
  submitted_count: number;
  approved_count: number;
}

// GET: List time entries with stats
export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const { limit, offset } = parsePagination(searchParams);

  const personId = searchParams.get("person_id");
  const status = searchParams.get("status");
  const periodType = searchParams.get("period_type");

  // Validate optional filters
  if (personId) {
    requireValidUUID(personId, "person_id");
  }
  if (status && !VALID_STATUSES.includes(status as TimeEntryStatus)) {
    throw new ApiError(
      `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      400
    );
  }
  if (
    periodType &&
    !VALID_PERIOD_TYPES.includes(periodType as PeriodType)
  ) {
    throw new ApiError(
      `Invalid period_type. Must be one of: ${VALID_PERIOD_TYPES.join(", ")}`,
      400
    );
  }

  // Build WHERE clause
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (personId) {
    conditions.push(`person_id = $${paramIdx++}`);
    params.push(personId);
  }
  if (status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }
  if (periodType) {
    conditions.push(`period_type = $${paramIdx++}`);
    params.push(periodType);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Fetch entries
  const entries = await queryRows<TimeEntry>(
    `SELECT * FROM ops.v_trapper_time_summary
     ${whereClause}
     ORDER BY period_start DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset]
  );

  // Build stats query with same filters
  const statsParams: unknown[] = [];
  let statsParamIdx = 1;
  const statsConditions: string[] = [];

  if (personId) {
    statsConditions.push(`person_id = $${statsParamIdx++}`);
    statsParams.push(personId);
  }
  if (status) {
    statsConditions.push(`status = $${statsParamIdx++}`);
    statsParams.push(status);
  }
  if (periodType) {
    statsConditions.push(`period_type = $${statsParamIdx++}`);
    statsParams.push(periodType);
  }

  const statsWhereClause =
    statsConditions.length > 0
      ? `WHERE ${statsConditions.join(" AND ")}`
      : "";

  const stats = await queryOne<TimeEntryStats>(
    `SELECT
      COUNT(*)::int AS total_entries,
      COALESCE(SUM(hours_total), 0)::numeric AS total_hours,
      COALESCE(SUM(total_pay), 0)::numeric AS total_pay,
      COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_count,
      COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted_count,
      COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count
    FROM ops.trapper_time_entries
    ${statsWhereClause}`,
    statsParams
  );

  const hasMore = entries.length === limit;

  return apiSuccess({
    entries,
    stats: stats || {
      total_entries: 0,
      total_hours: 0,
      total_pay: 0,
      draft_count: 0,
      submitted_count: 0,
      approved_count: 0,
    },
    pagination: { limit, offset, hasMore },
  });
});

// POST: Create a new time entry
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();

  // Required fields
  requireField(body.person_id, "person_id");
  requireValidUUID(body.person_id, "person_id");
  requireField(body.period_type, "period_type");
  requireField(body.period_start, "period_start");
  requireField(body.period_end, "period_end");
  requireField(body.hours_total, "hours_total");

  if (!VALID_PERIOD_TYPES.includes(body.period_type)) {
    throw new ApiError(
      `Invalid period_type. Must be one of: ${VALID_PERIOD_TYPES.join(", ")}`,
      400
    );
  }

  if (typeof body.hours_total !== "number" || body.hours_total < 0) {
    throw new ApiError("hours_total must be a non-negative number", 400);
  }

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    throw new ApiError(
      `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      400
    );
  }

  // Auto-calculate total_pay if hourly_rate provided and total_pay not
  let totalPay = body.total_pay ?? null;
  if (totalPay === null && body.hourly_rate != null) {
    totalPay = body.hours_total * body.hourly_rate;
  }

  const initialStatus = body.status || "draft";
  const submittedAt = initialStatus === "submitted" ? "NOW()" : "NULL";
  const approvedAt = initialStatus === "approved" ? "NOW()" : "NULL";

  const result = await queryOne<{ entry_id: string }>(
    `INSERT INTO ops.trapper_time_entries (
      person_id, period_type, period_start, period_end,
      hours_total, hours_trapping, hours_admin, hours_transport,
      hours_training, hours_other, pay_type, hourly_rate,
      total_pay, notes, work_summary, status,
      attachment_path, attachment_filename, attachment_mime_type,
      submitted_at, approved_at, created_at
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15, $16,
      $17, $18, $19,
      ${submittedAt}, ${approvedAt}, NOW()
    )
    RETURNING entry_id`,
    [
      body.person_id,
      body.period_type,
      body.period_start,
      body.period_end,
      body.hours_total,
      body.hours_trapping ?? null,
      body.hours_admin ?? null,
      body.hours_transport ?? null,
      body.hours_training ?? null,
      body.hours_other ?? null,
      body.pay_type ?? null,
      body.hourly_rate ?? null,
      totalPay,
      body.notes ?? null,
      body.work_summary ?? null,
      initialStatus,
      body.attachment_path ?? null,
      body.attachment_filename ?? null,
      body.attachment_mime_type ?? null,
    ]
  );

  if (!result) {
    throw new ApiError("Failed to create time entry", 500);
  }

  return apiSuccess({ entry_id: result.entry_id });
});

// PATCH: Update a time entry
export const PATCH = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json();

  requireField(body.entry_id, "entry_id");
  requireValidUUID(body.entry_id, "entry_id");

  // Validate status if provided
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    throw new ApiError(
      `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      400
    );
  }

  if (body.person_id) {
    requireValidUUID(body.person_id, "person_id");
  }

  if (
    body.period_type &&
    !VALID_PERIOD_TYPES.includes(body.period_type)
  ) {
    throw new ApiError(
      `Invalid period_type. Must be one of: ${VALID_PERIOD_TYPES.join(", ")}`,
      400
    );
  }

  // Build dynamic SET clause — only update provided fields
  const updatableFields: Record<string, string> = {
    person_id: "person_id",
    period_type: "period_type",
    period_start: "period_start",
    period_end: "period_end",
    hours_total: "hours_total",
    hours_trapping: "hours_trapping",
    hours_admin: "hours_admin",
    hours_transport: "hours_transport",
    hours_training: "hours_training",
    hours_other: "hours_other",
    pay_type: "pay_type",
    hourly_rate: "hourly_rate",
    total_pay: "total_pay",
    notes: "notes",
    work_summary: "work_summary",
    status: "status",
    attachment_path: "attachment_path",
    attachment_filename: "attachment_filename",
    attachment_mime_type: "attachment_mime_type",
  };

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  for (const [bodyKey, colName] of Object.entries(updatableFields)) {
    if (body[bodyKey] !== undefined) {
      setClauses.push(`${colName} = $${paramIdx++}`);
      params.push(body[bodyKey]);
    }
  }

  // Handle status-driven timestamp updates
  if (body.status === "submitted") {
    setClauses.push("submitted_at = NOW()");
  }
  if (body.status === "approved") {
    setClauses.push("approved_at = NOW()");
  }

  // Always set updated_at
  setClauses.push("updated_at = NOW()");

  if (setClauses.length === 1) {
    // Only updated_at — nothing meaningful to update
    throw new ApiError("No fields to update", 400);
  }

  params.push(body.entry_id);
  const entryIdParam = `$${paramIdx}`;

  const result = await execute(
    `UPDATE ops.trapper_time_entries
     SET ${setClauses.join(", ")}
     WHERE entry_id = ${entryIdParam}`,
    params
  );

  if (result.rowCount === 0) {
    throw new ApiError("Time entry not found", 404);
  }

  return apiSuccess({ updated: true });
});

// DELETE: Delete a draft time entry
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const entryId = searchParams.get("entry_id");

  requireField(entryId, "entry_id");
  requireValidUUID(entryId, "entry_id");

  // Check that entry exists and is a draft
  const entry = await queryOne<{ status: string }>(
    `SELECT status FROM ops.trapper_time_entries WHERE entry_id = $1`,
    [entryId]
  );

  if (!entry) {
    throw new ApiError("Time entry not found", 404);
  }

  if (entry.status !== "draft") {
    throw new ApiError(
      "Only draft entries can be deleted. This entry has status: " +
        entry.status,
      400
    );
  }

  await execute(
    `DELETE FROM ops.trapper_time_entries WHERE entry_id = $1`,
    [entryId]
  );

  return apiSuccess({ deleted: true });
});
