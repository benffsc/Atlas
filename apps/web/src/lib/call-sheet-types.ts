/**
 * Call Sheet Tracking Types
 *
 * Two-level model: CallSheet (batch) → CallSheetItem (individual call)
 * Matches ops.call_sheets and ops.call_sheet_items tables.
 */

// =============================================================================
// CALL SHEET (the batch)
// =============================================================================

export interface CallSheet {
  call_sheet_id: string;
  title: string;
  assigned_to_person_id: string | null;
  created_by: string | null;
  status: CallSheetStatus;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  assigned_at: string | null;
  completed_at: string | null;
}

export type CallSheetStatus = "draft" | "assigned" | "in_progress" | "completed" | "expired";

// =============================================================================
// CALL SHEET ITEM (individual call)
// =============================================================================

export interface CallSheetItem {
  item_id: string;
  call_sheet_id: string;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  place_id: string | null;
  place_address: string | null;
  request_id: string | null;
  person_id: string | null;
  priority_order: number;
  status: CallSheetItemStatus;
  disposition: CallDisposition | null;
  attempt_count: number;
  last_attempted_at: string | null;
  follow_up_at: string | null;
  notes: string | null;
  converted_to_type: ConvertedToType | null;
  converted_to_id: string | null;
  converted_at: string | null;
  context_summary: string | null;
  created_at: string;
  updated_at: string;
}

export type CallSheetItemStatus = "pending" | "attempted" | "follow_up" | "converted" | "dead_end" | "skipped";

export type CallDisposition =
  // Contact outcomes
  | "reached"
  | "left_voicemail"
  | "left_message_person"
  | "no_answer"
  | "busy"
  | "wrong_number"
  | "disconnected"
  | "not_interested"
  | "already_resolved"
  | "do_not_contact"
  // Conversion outcomes
  | "scheduled_trapping"
  | "scheduled_callback"
  | "needs_more_info"
  | "referred_elsewhere"
  | "appointment_booked";

export type ConvertedToType = "request_assignment" | "new_request" | "appointment";

// =============================================================================
// VIEW TYPES (for API responses)
// =============================================================================

export interface CallSheetSummary extends CallSheet {
  assigned_to_name: string | null;
  assigned_to_trapper_type: string | null;
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

export interface CallSheetItemDetail extends CallSheetItem {
  place_name: string | null;
  place_full_address: string | null;
  request_status: string | null;
  request_summary: string | null;
  request_priority: string | null;
  person_name: string | null;
  primary_phone: string | null;
  primary_email: string | null;
}

// =============================================================================
// API REQUEST/RESPONSE SHAPES
// =============================================================================

export interface CreateCallSheetRequest {
  title: string;
  assigned_to_person_id?: string | null;
  due_date?: string | null;
  notes?: string | null;
  items?: CreateCallSheetItemRequest[];
}

export interface CreateCallSheetItemRequest {
  contact_name: string;
  contact_phone?: string | null;
  contact_email?: string | null;
  place_id?: string | null;
  place_address?: string | null;
  request_id?: string | null;
  person_id?: string | null;
  context_summary?: string | null;
}

export interface UpdateDispositionRequest {
  disposition: CallDisposition;
  notes?: string | null;
  follow_up_at?: string | null;
}

export interface ConvertItemRequest {
  convert_to: ConvertedToType;
  request_id?: string;
  trapper_person_id?: string;
}

// =============================================================================
// UI HELPERS
// =============================================================================

export const CALL_SHEET_STATUS_LABELS: Record<CallSheetStatus, string> = {
  draft: "Draft",
  assigned: "Assigned",
  in_progress: "In Progress",
  completed: "Completed",
  expired: "Expired",
};

export const CALL_SHEET_STATUS_COLORS: Record<CallSheetStatus, { bg: string; color: string }> = {
  draft: { bg: "var(--bg-secondary)", color: "var(--text-secondary)" },
  assigned: { bg: "var(--info-bg, #dbeafe)", color: "var(--info-text, #1e40af)" },
  in_progress: { bg: "var(--warning-bg)", color: "var(--warning-text)" },
  completed: { bg: "var(--success-bg)", color: "var(--success-text)" },
  expired: { bg: "var(--danger-bg, #fee2e2)", color: "var(--danger-text, #991b1b)" },
};

export const ITEM_STATUS_LABELS: Record<CallSheetItemStatus, string> = {
  pending: "Pending",
  attempted: "Attempted",
  follow_up: "Follow Up",
  converted: "Converted",
  dead_end: "Dead End",
  skipped: "Skipped",
};

export const ITEM_STATUS_COLORS: Record<CallSheetItemStatus, { bg: string; color: string }> = {
  pending: { bg: "var(--bg-secondary)", color: "var(--text-secondary)" },
  attempted: { bg: "var(--info-bg, #dbeafe)", color: "var(--info-text, #1e40af)" },
  follow_up: { bg: "var(--warning-bg)", color: "var(--warning-text)" },
  converted: { bg: "var(--success-bg)", color: "var(--success-text)" },
  dead_end: { bg: "var(--danger-bg, #fee2e2)", color: "var(--danger-text, #991b1b)" },
  skipped: { bg: "var(--bg-secondary)", color: "var(--text-tertiary)" },
};

/** Map dispositions to the item status they should trigger */
export const DISPOSITION_TO_STATUS: Record<CallDisposition, CallSheetItemStatus> = {
  reached: "attempted",
  left_voicemail: "attempted",
  left_message_person: "attempted",
  no_answer: "attempted",
  busy: "attempted",
  wrong_number: "dead_end",
  disconnected: "dead_end",
  not_interested: "dead_end",
  already_resolved: "dead_end",
  do_not_contact: "dead_end",
  scheduled_trapping: "converted",
  scheduled_callback: "follow_up",
  needs_more_info: "follow_up",
  referred_elsewhere: "dead_end",
  appointment_booked: "converted",
};
