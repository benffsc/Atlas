import { queryRows } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

interface AuditRow {
  audit_id: string;
  config_key: string;
  old_value: number;
  new_value: number;
  changed_by: string;
  change_reason: string | null;
  changed_at: string;
}

export async function GET() {
  try {
    const sql = `
      SELECT
        audit_id,
        config_key,
        old_value,
        new_value,
        changed_by,
        change_reason,
        changed_at
      FROM ops.ecology_config_audit
      ORDER BY changed_at DESC
      LIMIT 50
    `;

    const audits = await queryRows<AuditRow>(sql);

    return apiSuccess({ audits });
  } catch (error) {
    console.error("Error fetching ecology config audit:", error);
    return apiServerError("Failed to fetch audit log");
  }
}
