import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * GET /api/admin/data-improvements/export
 * Export data improvements for Claude Code review
 *
 * Supports formats:
 * - json (default): Machine-readable JSON
 * - markdown: Human-readable document for Claude Code
 */
export async function GET(request: NextRequest) {
  try {
    // Require admin auth
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json";
    const status = searchParams.get("status") || "pending,confirmed,in_progress";
    const includeResolved = searchParams.get("includeResolved") === "true";

    // Get statuses to include
    const statusList = status.split(",").map((s) => s.trim());
    if (includeResolved && !statusList.includes("resolved")) {
      statusList.push("resolved");
    }

    // Fetch improvements
    const improvements = await queryRows(
      `
      SELECT
        di.improvement_id,
        di.title,
        di.description,
        di.entity_type,
        di.entity_id,
        di.category,
        di.priority,
        di.suggested_fix,
        di.fix_sql,
        di.source,
        di.status,
        di.resolution_notes,
        di.created_at,
        -- Entity details
        CASE
          WHEN di.entity_type = 'place' THEN (
            SELECT jsonb_build_object(
              'label', p.display_name,
              'address', p.formatted_address,
              'city', p.city
            ) FROM sot.places p WHERE p.place_id = di.entity_id
          )
          WHEN di.entity_type = 'cat' THEN (
            SELECT jsonb_build_object(
              'name', c.name,
              'microchip', c.microchip
            ) FROM sot.cats c WHERE c.cat_id = di.entity_id
          )
          WHEN di.entity_type = 'person' THEN (
            SELECT jsonb_build_object(
              'display_name', p.display_name,
              'primary_email', p.primary_email
            ) FROM sot.people p WHERE p.person_id = di.entity_id
          )
          WHEN di.entity_type = 'request' THEN (
            SELECT jsonb_build_object(
              'short_address', r.short_address,
              'status', r.status
            ) FROM ops.requests r WHERE r.request_id = di.entity_id
          )
          ELSE NULL
        END as entity_details,
        -- Source feedback if from Tippy
        CASE WHEN di.source = 'tippy_feedback' THEN (
          SELECT jsonb_build_object(
            'tippy_message', tf.tippy_message,
            'user_correction', tf.user_correction,
            'staff_name', (SELECT display_name FROM ops.staff WHERE staff_id = tf.staff_id)
          )
          FROM trapper.tippy_feedback tf
          WHERE tf.feedback_id = di.source_reference_id
        ) END as source_details
      FROM trapper.data_improvements di
      WHERE di.status = ANY($1)
      ORDER BY
        CASE di.priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END,
        di.created_at DESC
      `,
      [statusList]
    );

    if (format === "markdown") {
      // Generate markdown document for Claude Code
      const markdown = generateMarkdown(improvements);

      return new NextResponse(markdown, {
        headers: {
          "Content-Type": "text/markdown",
          "Content-Disposition": `attachment; filename="data-improvements-${new Date().toISOString().split("T")[0]}.md"`,
        },
      });
    }

    // Default: JSON format
    return NextResponse.json({
      exported_at: new Date().toISOString(),
      total_count: improvements.length,
      improvements: improvements.map((imp) => ({
        ...imp,
        // Parse JSONB fields
        suggested_fix: imp.suggested_fix,
        entity_details: imp.entity_details,
        source_details: imp.source_details,
      })),
    });
  } catch (error) {
    console.error("Data improvements export error:", error);
    return NextResponse.json(
      { error: "Failed to export improvements" },
      { status: 500 }
    );
  }
}

function generateMarkdown(improvements: Record<string, unknown>[]): string {
  const lines: string[] = [];

  lines.push("# Atlas Data Improvements Queue");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total Issues: ${improvements.length}`);
  lines.push("");

  // Group by priority
  const byPriority: Record<string, typeof improvements> = {
    critical: [],
    high: [],
    normal: [],
    low: [],
  };

  for (const imp of improvements) {
    const priority = (imp.priority as string) || "normal";
    if (byPriority[priority]) {
      byPriority[priority].push(imp);
    }
  }

  // Generate sections by priority
  const priorityEmoji: Record<string, string> = {
    critical: "🔴",
    high: "🟠",
    normal: "🟡",
    low: "🟢",
  };

  for (const [priority, items] of Object.entries(byPriority)) {
    if (items.length === 0) continue;

    lines.push(`## ${priorityEmoji[priority]} ${priority.toUpperCase()} Priority (${items.length})`);
    lines.push("");

    for (const imp of items) {
      lines.push(`### ${imp.title}`);
      lines.push("");
      lines.push(`- **ID**: \`${imp.improvement_id}\``);
      lines.push(`- **Category**: ${imp.category}`);
      lines.push(`- **Status**: ${imp.status}`);
      lines.push(`- **Source**: ${imp.source}`);

      if (imp.entity_type) {
        lines.push(`- **Entity**: ${imp.entity_type} (${imp.entity_id})`);
        if (imp.entity_details) {
          const details = imp.entity_details as Record<string, unknown>;
          const detailStr = Object.entries(details)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          lines.push(`  - Details: ${detailStr}`);
        }
      }

      lines.push("");
      lines.push("**Description:**");
      lines.push(imp.description as string);
      lines.push("");

      if (imp.source_details) {
        const source = imp.source_details as Record<string, unknown>;
        lines.push("**Staff Feedback:**");
        if (source.staff_name) {
          lines.push(`- Reported by: ${source.staff_name}`);
        }
        if (source.user_correction) {
          lines.push(`- Correction: ${source.user_correction}`);
        }
        lines.push("");
      }

      if (imp.suggested_fix) {
        lines.push("**Suggested Fix:**");
        lines.push("```json");
        lines.push(JSON.stringify(imp.suggested_fix, null, 2));
        lines.push("```");
        lines.push("");
      }

      if (imp.fix_sql) {
        lines.push("**Fix SQL:**");
        lines.push("```sql");
        lines.push(imp.fix_sql as string);
        lines.push("```");
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  // Add instructions for Claude Code
  lines.push("## Instructions for Claude Code");
  lines.push("");
  lines.push("When reviewing these issues:");
  lines.push("");
  lines.push("1. **Verify** the issue exists by querying the database");
  lines.push("2. **Assess** the impact and determine the correct fix");
  lines.push("3. **Create** a migration file if schema changes are needed");
  lines.push("4. **Test** the fix in a safe environment");
  lines.push("5. **Document** the fix in the resolution notes");
  lines.push("");
  lines.push("Use the API to update status:");
  lines.push("```bash");
  lines.push("curl -X PATCH /api/admin/data-improvements/{id} \\");
  lines.push('  -d \'{"status": "resolved", "resolution_notes": "Fixed via MIG_XXX"}\'');
  lines.push("```");

  return lines.join("\n");
}
