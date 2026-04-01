import { queryRows } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { withErrorHandling } from "@/lib/api-validation";

export interface KioskStaffRow {
  staff_id: string;
  person_id: string;
  first_name: string;
  last_name: string | null;
  display_name: string;
  department: string | null;
  initials: string;
}

/**
 * GET /api/kiosk/staff
 * Returns active staff with show_in_kiosk = TRUE for the staff picker grid.
 * No auth required — kiosk route, PIN-gated at the UI layer.
 */
export const GET = withErrorHandling(async () => {
  const rows = await queryRows<Omit<KioskStaffRow, "initials">>(
    `SELECT s.staff_id, s.person_id, s.first_name, s.last_name, s.display_name, s.department
     FROM ops.staff s
     WHERE s.is_active = TRUE
       AND s.person_id IS NOT NULL
       AND s.show_in_kiosk = TRUE
     ORDER BY s.first_name, s.last_name`
  );

  const staff: KioskStaffRow[] = rows.map((r) => ({
    ...r,
    initials: [r.first_name?.[0], r.last_name?.[0]].filter(Boolean).join("").toUpperCase(),
  }));

  return apiSuccess({ staff });
});
