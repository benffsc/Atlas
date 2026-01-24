import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne, queryRows, execute } from "@/lib/db";

/**
 * POST /api/admin/trapper-reports/[id]/commit
 * Commit all approved items for a submission
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;

  try {
    // Get submission
    const submission = await queryOne<{ submission_id: string; extraction_status: string }>(
      `SELECT submission_id::text, extraction_status
       FROM trapper.trapper_report_submissions WHERE submission_id = $1`,
      [id]
    );

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // Get approved items that haven't been committed yet
    const items = await queryRows<{
      item_id: string;
      item_type: string;
      target_entity_type: string;
      target_entity_id: string | null;
      final_entity_id: string | null;
      extracted_data: Record<string, unknown>;
      final_data: Record<string, unknown> | null;
    }>(
      `SELECT
        item_id::text,
        item_type,
        target_entity_type,
        target_entity_id::text,
        final_entity_id::text,
        extracted_data,
        final_data
       FROM trapper.trapper_report_items
       WHERE submission_id = $1
         AND review_status = 'approved'
         AND committed_at IS NULL`,
      [id]
    );

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No approved items to commit",
        committed: 0,
        failed: 0,
      });
    }

    const results: Array<{
      item_id: string;
      success: boolean;
      result?: Record<string, unknown>;
      error?: string;
    }> = [];

    const editedBy = session.staff_id || session.email || "admin";

    for (const item of items) {
      try {
        // Use final_entity_id if set, otherwise use target_entity_id
        const entityId = item.final_entity_id || item.target_entity_id;
        // Use final_data if set, otherwise use extracted_data
        const data = item.final_data || item.extracted_data;

        if (!entityId && item.item_type !== "new_site_observation") {
          // Skip items without entity (except new site observations)
          results.push({
            item_id: item.item_id,
            success: false,
            error: "No entity ID to commit to",
          });
          continue;
        }

        // Call the commit function from MIG_566
        // Function signature: commit_trapper_report_item(p_item_id UUID, p_committed_by TEXT)
        // It reads item_type, entity_id, and data from the item record internally
        const commitResult = await queryOne<{
          success: boolean;
          action: string;
          affected_entities: string[];
          edit_ids: string[];
          error: string | null;
        }>(
          `SELECT * FROM trapper.commit_trapper_report_item($1, $2)`,
          [item.item_id, editedBy]
        );

        if (commitResult?.success) {
          // Update item as committed
          await execute(
            `UPDATE trapper.trapper_report_items
             SET committed_at = NOW(), commit_result = $2
             WHERE item_id = $1`,
            [item.item_id, JSON.stringify(commitResult)]
          );

          results.push({
            item_id: item.item_id,
            success: true,
            result: commitResult,
          });
        } else {
          results.push({
            item_id: item.item_id,
            success: false,
            error: commitResult?.error || "Commit function returned failure",
          });
        }
      } catch (error) {
        results.push({
          item_id: item.item_id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    // Update submission status if all items committed successfully
    if (failCount === 0 && successCount > 0) {
      // Check if there are any remaining pending items
      const pendingItems = await queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM trapper.trapper_report_items
         WHERE submission_id = $1 AND committed_at IS NULL AND review_status != 'rejected'`,
        [id]
      );

      if (!pendingItems || parseInt(pendingItems.count) === 0) {
        await execute(
          `UPDATE trapper.trapper_report_submissions
           SET extraction_status = 'committed'
           WHERE submission_id = $1`,
          [id]
        );
      } else {
        await execute(
          `UPDATE trapper.trapper_report_submissions
           SET extraction_status = 'reviewed'
           WHERE submission_id = $1`,
          [id]
        );
      }
    }

    return NextResponse.json({
      success: failCount === 0,
      committed: successCount,
      failed: failCount,
      results,
    });
  } catch (error) {
    console.error("Error committing trapper report items:", error);
    return NextResponse.json(
      { error: "Failed to commit items" },
      { status: 500 }
    );
  }
}
