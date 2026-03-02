// API route for listing pending owner changes
// GET /api/admin/owner-changes

import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

interface OwnerChange {
  review_id: string;
  review_type: string;
  priority: number;
  created_at: string;
  notes: string | null;
  match_confidence: number | null;
  old_person_id: string;
  old_person_name: string;
  old_email: string | null;
  old_phone: string | null;
  old_address: string | null;
  new_person_id: string | null;
  new_person_name: string | null;
  new_name: string;
  new_email: string | null;
  new_phone: string | null;
  new_address: string | null;
  appointment_number: string | null;
  detection_reason: string | null;
  cat_count: number;
  cats_affected: string[];
  cat_names: string[] | null;
}

export async function GET() {
  try {
    // Use the view we created in MIG_2504
    const changes = await queryRows<OwnerChange>(`
      SELECT * FROM ops.v_pending_owner_changes
      ORDER BY priority DESC, created_at ASC
      LIMIT 100
    `);

    return apiSuccess({
      changes,
      count: changes.length,
    });
  } catch (error) {
    console.error("Error fetching owner changes:", error);
    return apiServerError(error instanceof Error ? error.message : "Unknown error");
  }
}
