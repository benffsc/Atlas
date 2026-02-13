import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne } from "@/lib/db";

interface Discrepancy {
  improvement_id: string;
  title: string;
  description: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_display: string | null;
  category: string;
  priority: string;
  suggested_fix: Record<string, unknown> | null;
  fix_sql: string | null;
  status: string;
  created_at: string;
}

/**
 * GET /api/admin/discrepancies/export
 *
 * Export Tippy-found data discrepancies for CLI/Claude Code review
 * Query params: format (json|markdown)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);

    if (!session?.staff_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const admin = await queryOne<{ auth_role: string }>(
      `SELECT auth_role FROM ops.staff WHERE staff_id = $1`,
      [session.staff_id]
    );

    if (admin?.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const url = new URL(request.url);
    const format = url.searchParams.get("format") || "json";

    // Fetch discrepancies from the view
    const discrepancies = await queryRows<Discrepancy>(
      `SELECT
        di.improvement_id,
        di.title,
        di.description,
        di.entity_type,
        di.entity_id,
        di.category,
        di.priority,
        di.suggested_fix,
        di.fix_sql,
        di.status,
        di.created_at,
        CASE
          WHEN di.entity_type = 'cat' THEN (
            SELECT c.display_name FROM sot.cats c WHERE c.cat_id = di.entity_id
          )
          WHEN di.entity_type = 'place' THEN (
            SELECT p.formatted_address FROM sot.places p WHERE p.place_id = di.entity_id
          )
          WHEN di.entity_type = 'person' THEN (
            SELECT per.display_name FROM sot.people per WHERE per.person_id = di.entity_id
          )
          WHEN di.entity_type = 'request' THEN (
            SELECT req.summary FROM ops.requests req WHERE req.request_id = di.entity_id
          )
          ELSE NULL
        END as entity_display
      FROM trapper.data_improvements di
      WHERE di.source = 'tippy_auto_check'
        AND di.status = 'pending'
      ORDER BY
        CASE di.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
        di.created_at DESC`
    );

    if (format === "markdown") {
      const markdown = generateMarkdown(discrepancies);
      return new NextResponse(markdown, {
        headers: {
          "Content-Type": "text/markdown",
          "Content-Disposition": `attachment; filename="tippy-discrepancies-${new Date().toISOString().split("T")[0]}.md"`,
        },
      });
    }

    return NextResponse.json({
      discrepancies,
      count: discrepancies.length,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error exporting discrepancies:", error);
    return NextResponse.json(
      { error: "Failed to export discrepancies" },
      { status: 500 }
    );
  }
}

/**
 * Generate markdown report for Claude Code review
 */
function generateMarkdown(discrepancies: Discrepancy[]): string {
  let md = `# Tippy Data Discrepancies\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `Total pending: ${discrepancies.length}\n\n`;
  md += `---\n\n`;

  if (discrepancies.length === 0) {
    md += `No pending discrepancies found.\n`;
    return md;
  }

  // Group by priority
  const byPriority: Record<string, Discrepancy[]> = {};
  for (const d of discrepancies) {
    const p = d.priority || "normal";
    if (!byPriority[p]) byPriority[p] = [];
    byPriority[p].push(d);
  }

  const priorityOrder = ["critical", "high", "normal", "low"];

  for (const priority of priorityOrder) {
    const items = byPriority[priority];
    if (!items || items.length === 0) continue;

    md += `## ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority (${items.length})\n\n`;

    for (const d of items) {
      md += `### ${d.title}\n\n`;
      md += `- **ID:** \`${d.improvement_id}\`\n`;
      md += `- **Created:** ${new Date(d.created_at).toLocaleDateString()}\n`;

      if (d.entity_type) {
        md += `- **Entity:** ${d.entity_type}`;
        if (d.entity_display) {
          md += ` (${d.entity_display})`;
        }
        if (d.entity_id) {
          md += ` \`${d.entity_id}\``;
        }
        md += `\n`;
      }

      md += `- **Category:** ${d.category || "unknown"}\n\n`;

      // Parse description if it's JSON
      let descriptionText = d.description;
      try {
        const parsed = JSON.parse(d.description);
        if (parsed.description) {
          descriptionText = parsed.description;
          md += `**Description:**\n${descriptionText}\n\n`;

          if (parsed.raw_data) {
            md += `**Raw Data:**\n\`\`\`json\n${JSON.stringify(parsed.raw_data, null, 2)}\n\`\`\`\n\n`;
          }
          if (parsed.processed_data) {
            md += `**Processed Data:**\n\`\`\`json\n${JSON.stringify(parsed.processed_data, null, 2)}\n\`\`\`\n\n`;
          }
        } else {
          md += `**Description:**\n${descriptionText}\n\n`;
        }
      } catch {
        md += `**Description:**\n${descriptionText}\n\n`;
      }

      if (d.suggested_fix) {
        md += `**Suggested Fix:**\n\`\`\`json\n${JSON.stringify(d.suggested_fix, null, 2)}\n\`\`\`\n\n`;
      }

      if (d.fix_sql) {
        md += `**Fix SQL:**\n\`\`\`sql\n${d.fix_sql}\n\`\`\`\n\n`;
      }

      md += `---\n\n`;
    }
  }

  return md;
}
