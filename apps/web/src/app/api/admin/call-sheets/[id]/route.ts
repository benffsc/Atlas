import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiNotFound } from "@/lib/api-response";
import {
  withErrorHandling,
  ApiError,
  requireValidUUID,
} from "@/lib/api-validation";
import { ENTITY_ENUMS } from "@/lib/enums";
import { requireValidEnum } from "@/lib/api-validation";

// Use the summary view for the sheet detail to get aggregated counts
interface CallSheetDetailRow {
  call_sheet_id: string;
  title: string;
  status: string;
  assigned_to_person_id: string | null;
  assigned_to_name: string | null;
  assigned_to_trapper_type: string | null;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  assigned_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  total_items: number;
  pending_count: number;
  attempted_count: number;
  follow_up_count: number;
  converted_count: number;
  dead_end_count: number;
  skipped_count: number;
  completed_items: number;
  is_overdue: boolean;
}

// GET: Call sheet detail with all items
export const GET = withErrorHandling(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params;
    requireValidUUID(id, "call_sheet");

    const sheet = await queryOne<CallSheetDetailRow>(
      `SELECT * FROM ops.v_call_sheet_summary
       WHERE call_sheet_id = $1`,
      [id]
    );

    if (!sheet) {
      return apiNotFound("call_sheet", id);
    }

    const items = await queryRows<Record<string, unknown>>(
      `SELECT * FROM ops.v_call_sheet_items_detail
       WHERE call_sheet_id = $1
       ORDER BY priority_order`,
      [id]
    );

    return apiSuccess({ sheet, items });
  }
);

// PATCH: Update call sheet
export const PATCH = withErrorHandling(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params;
    requireValidUUID(id, "call_sheet");

    const body = await request.json();
    const { title, status, assigned_to_person_id, due_date, notes } = body;

    // Validate enums if provided
    if (status !== undefined) {
      requireValidEnum(status, ENTITY_ENUMS.CALL_SHEET_STATUS, "status");
    }
    if (assigned_to_person_id !== undefined && assigned_to_person_id !== null) {
      requireValidUUID(assigned_to_person_id, "assigned_to_person_id");
    }

    // Verify sheet exists
    const existing = await queryOne<{ call_sheet_id: string; status: string }>(
      `SELECT call_sheet_id, status FROM ops.call_sheets WHERE call_sheet_id = $1`,
      [id]
    );

    if (!existing) {
      return apiNotFound("call_sheet", id);
    }

    // Build dynamic UPDATE
    const setClauses: string[] = [];
    const params_arr: unknown[] = [];
    let paramIdx = 1;

    if (title !== undefined) {
      setClauses.push(`title = $${paramIdx++}`);
      params_arr.push(title);
    }

    // Determine effective status
    let effectiveStatus = status;

    // Auto-set status to 'assigned' when assigning a person and sheet is draft
    if (
      assigned_to_person_id !== undefined &&
      assigned_to_person_id !== null &&
      !status &&
      existing.status === "draft"
    ) {
      effectiveStatus = "assigned";
    }

    if (effectiveStatus !== undefined) {
      setClauses.push(`status = $${paramIdx++}`);
      params_arr.push(effectiveStatus);

      // Auto-set timestamps on status transitions
      if (effectiveStatus === "assigned") {
        setClauses.push(`assigned_at = NOW()`);
      }
      if (effectiveStatus === "completed") {
        setClauses.push(`completed_at = NOW()`);
      }
    }

    if (assigned_to_person_id !== undefined) {
      setClauses.push(`assigned_to_person_id = $${paramIdx++}`);
      params_arr.push(assigned_to_person_id);

      // If assigning and status is transitioning to assigned, set assigned_at
      if (assigned_to_person_id !== null && effectiveStatus === "assigned") {
        // assigned_at already set above
      }
    }

    if (due_date !== undefined) {
      setClauses.push(`due_date = $${paramIdx++}`);
      params_arr.push(due_date);
    }

    if (notes !== undefined) {
      setClauses.push(`notes = $${paramIdx++}`);
      params_arr.push(notes);
    }

    if (setClauses.length === 0) {
      throw new ApiError("No fields to update", 400);
    }

    setClauses.push(`updated_at = NOW()`);

    await queryOne(
      `UPDATE ops.call_sheets
       SET ${setClauses.join(", ")}
       WHERE call_sheet_id = $${paramIdx}`,
      [...params_arr, id]
    );

    return apiSuccess({ updated: true });
  }
);
