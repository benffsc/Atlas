import { queryOne } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

export const revalidate = 3600; // 1 hour

interface ConfigRow {
  enabled: boolean;
  font_scale: number;
  indicator_text: string;
}

/**
 * GET /api/presentation-config
 *
 * Returns admin-configurable presentation mode settings from ops.app_config.
 * Used by AppShell to decide whether to show the toggle and what text to
 * display in the indicator.
 *
 * Epic: FFS-1196 (Tier 3: Gala Mode)
 */
export async function GET() {
  try {
    const row = await queryOne<ConfigRow>(`
      SELECT
        (ops.get_config_value('presentation.enabled', 'true') = 'true') AS enabled,
        ops.get_config_numeric('presentation.font_scale', 1.2) AS font_scale,
        COALESCE((SELECT value #>> '{}' FROM ops.app_config WHERE key = 'presentation.indicator_text'), 'Presentation Mode — press ESC to exit') AS indicator_text
    `);

    return apiSuccess(
      {
        enabled: row?.enabled ?? true,
        font_scale: row?.font_scale ?? 1.2,
        indicator_text: row?.indicator_text ?? "Presentation Mode — press ESC to exit",
      },
      { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=7200" } }
    );
  } catch (error) {
    console.error("Error fetching presentation config:", error);
    return apiServerError("Failed to fetch presentation config");
  }
}
