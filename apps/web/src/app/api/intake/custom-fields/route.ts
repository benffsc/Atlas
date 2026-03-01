import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";

// Cache custom fields for 10 minutes - they rarely change
export const revalidate = 600;

interface CustomField {
  field_id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: { value: string; label: string }[] | null;
  placeholder: string | null;
  help_text: string | null;
  is_required: boolean;
  is_beacon_critical: boolean;
  display_order: number;
}

// GET - Fetch custom fields for the intake form
// Optionally filter by call_type
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const callType = searchParams.get("call_type");

  try {
    // First check if the table exists
    const tableCheck = await queryRows<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'trapper'
        AND table_name = 'intake_custom_fields'
      ) as exists
    `);

    if (!tableCheck[0]?.exists) {
      // Table doesn't exist yet, return empty
      return apiSuccess({ fields: [] });
    }

    const fields = await queryRows<CustomField>(`
      SELECT
        field_id,
        field_key,
        field_label,
        field_type,
        options,
        placeholder,
        help_text,
        is_required,
        is_beacon_critical,
        display_order
      FROM ops.intake_custom_fields
      WHERE is_active = TRUE
      AND (
        show_for_call_types IS NULL
        OR $1 = ANY(show_for_call_types)
        OR $1 IS NULL
      )
      ORDER BY display_order, created_at
    `, [callType || null]);

    // Use NextResponse for custom cache headers
    const response = apiSuccess({ fields });
    response.headers.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200');
    return response;
  } catch (err) {
    console.error("Error fetching custom fields:", err);
    // Return empty on error so form still works
    return apiSuccess({ fields: [] });
  }
}
