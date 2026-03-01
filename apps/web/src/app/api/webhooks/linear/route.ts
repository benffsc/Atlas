/**
 * Linear Webhook Handler
 *
 * Receives webhook events from Linear and processes them.
 * Events are stored in source.linear_webhook_events, then processed to ops.* tables.
 *
 * @see https://developers.linear.app/docs/graphql/webhooks
 *
 * Setup in Linear:
 * 1. Go to Settings > API > Webhooks
 * 2. Create webhook with URL: https://your-domain.com/api/webhooks/linear
 * 3. Copy the signing secret to LINEAR_WEBHOOK_SECRET env var
 * 4. Select events: Issue, Project, Cycle, Comment
 */

import { NextRequest } from "next/server";
import crypto from "crypto";
import { query, queryOne } from "@/lib/db";
import { apiSuccess, apiBadRequest, apiUnauthorized, apiServerError } from "@/lib/api-response";

// ============================================================================
// Types
// ============================================================================

interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: "Issue" | "Comment" | "Project" | "Cycle" | "IssueLabel";
  createdAt: string;
  data: Record<string, unknown>;
  url: string;
  organizationId: string;
  webhookTimestamp: number;
  webhookId: string;
}

// ============================================================================
// Signature Verification
// ============================================================================

function verifySignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

// ============================================================================
// Event Processing
// ============================================================================

async function processIssueEvent(
  action: string,
  data: Record<string, unknown>
): Promise<void> {
  const linearId = data.id as string;

  if (action === "remove") {
    // Archive the issue
    await query(
      `UPDATE ops.linear_issues
       SET archived_at = NOW(), synced_at = NOW()
       WHERE linear_id = $1`,
      [linearId]
    );
    return;
  }

  // Extract nested data
  const state = data.state as Record<string, unknown> | null;
  const project = data.project as Record<string, unknown> | null;
  const cycle = data.cycle as Record<string, unknown> | null;
  const assignee = data.assignee as Record<string, unknown> | null;
  const creator = data.creator as Record<string, unknown> | null;
  const labels = (data.labels as { nodes?: Array<Record<string, unknown>> })?.nodes || [];

  // Upsert the issue
  await query(
    `INSERT INTO ops.linear_issues (
       linear_id, identifier, title, description,
       state_id, state_name, state_type,
       priority, priority_label,
       project_id, project_name,
       cycle_id, cycle_name,
       assignee_id, assignee_name,
       creator_id, creator_name,
       labels, estimate, due_date,
       created_at, updated_at, started_at, completed_at, canceled_at, archived_at,
       url, synced_at
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7,
       $8, $9,
       $10, $11,
       $12, $13,
       $14, $15,
       $16, $17,
       $18, $19, $20,
       $21, $22, $23, $24, $25, $26,
       $27, NOW()
     )
     ON CONFLICT (linear_id) DO UPDATE SET
       identifier = EXCLUDED.identifier,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       state_id = EXCLUDED.state_id,
       state_name = EXCLUDED.state_name,
       state_type = EXCLUDED.state_type,
       priority = EXCLUDED.priority,
       priority_label = EXCLUDED.priority_label,
       project_id = EXCLUDED.project_id,
       project_name = EXCLUDED.project_name,
       cycle_id = EXCLUDED.cycle_id,
       cycle_name = EXCLUDED.cycle_name,
       assignee_id = EXCLUDED.assignee_id,
       assignee_name = EXCLUDED.assignee_name,
       creator_id = EXCLUDED.creator_id,
       creator_name = EXCLUDED.creator_name,
       labels = EXCLUDED.labels,
       estimate = EXCLUDED.estimate,
       due_date = EXCLUDED.due_date,
       updated_at = EXCLUDED.updated_at,
       started_at = EXCLUDED.started_at,
       completed_at = EXCLUDED.completed_at,
       canceled_at = EXCLUDED.canceled_at,
       archived_at = EXCLUDED.archived_at,
       url = EXCLUDED.url,
       synced_at = NOW()`,
    [
      linearId,
      data.identifier,
      data.title,
      data.description,
      state?.id,
      state?.name,
      state?.type,
      data.priority,
      data.priorityLabel,
      project?.id,
      project?.name,
      cycle?.id,
      cycle?.name,
      assignee?.id,
      assignee?.name,
      creator?.id,
      creator?.name,
      JSON.stringify(labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))),
      data.estimate,
      data.dueDate,
      data.createdAt,
      data.updatedAt,
      data.startedAt,
      data.completedAt,
      data.canceledAt,
      data.archivedAt,
      data.url,
    ]
  );
}

async function processProjectEvent(
  action: string,
  data: Record<string, unknown>
): Promise<void> {
  const linearId = data.id as string;

  if (action === "remove") {
    await query(
      `DELETE FROM ops.linear_projects WHERE linear_id = $1`,
      [linearId]
    );
    return;
  }

  await query(
    `INSERT INTO ops.linear_projects (
       linear_id, name, description, state, icon, color,
       slug_id, url, target_date, start_date,
       created_at, updated_at, synced_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
     )
     ON CONFLICT (linear_id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       state = EXCLUDED.state,
       icon = EXCLUDED.icon,
       color = EXCLUDED.color,
       slug_id = EXCLUDED.slug_id,
       url = EXCLUDED.url,
       target_date = EXCLUDED.target_date,
       start_date = EXCLUDED.start_date,
       updated_at = EXCLUDED.updated_at,
       synced_at = NOW()`,
    [
      linearId,
      data.name,
      data.description,
      data.state,
      data.icon,
      data.color,
      data.slugId,
      data.url,
      data.targetDate,
      data.startDate,
      data.createdAt,
      data.updatedAt,
    ]
  );
}

async function processCycleEvent(
  action: string,
  data: Record<string, unknown>
): Promise<void> {
  const linearId = data.id as string;

  if (action === "remove") {
    await query(
      `DELETE FROM ops.linear_cycles WHERE linear_id = $1`,
      [linearId]
    );
    return;
  }

  await query(
    `INSERT INTO ops.linear_cycles (
       linear_id, name, number, starts_at, ends_at,
       completed_at, progress, created_at, updated_at, synced_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()
     )
     ON CONFLICT (linear_id) DO UPDATE SET
       name = EXCLUDED.name,
       number = EXCLUDED.number,
       starts_at = EXCLUDED.starts_at,
       ends_at = EXCLUDED.ends_at,
       completed_at = EXCLUDED.completed_at,
       progress = EXCLUDED.progress,
       updated_at = EXCLUDED.updated_at,
       synced_at = NOW()`,
    [
      linearId,
      data.name,
      data.number,
      data.startsAt,
      data.endsAt,
      data.completedAt,
      data.progress,
      data.createdAt,
      data.updatedAt,
    ]
  );
}

async function processLabelEvent(
  action: string,
  data: Record<string, unknown>
): Promise<void> {
  const linearId = data.id as string;

  if (action === "remove") {
    await query(
      `DELETE FROM ops.linear_labels WHERE linear_id = $1`,
      [linearId]
    );
    return;
  }

  const parent = data.parent as Record<string, unknown> | null;

  await query(
    `INSERT INTO ops.linear_labels (
       linear_id, name, color, description, parent_id, created_at, synced_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, NOW()
     )
     ON CONFLICT (linear_id) DO UPDATE SET
       name = EXCLUDED.name,
       color = EXCLUDED.color,
       description = EXCLUDED.description,
       parent_id = EXCLUDED.parent_id,
       synced_at = NOW()`,
    [
      linearId,
      data.name,
      data.color,
      data.description,
      parent?.id,
      data.createdAt,
    ]
  );
}

// ============================================================================
// Route Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.LINEAR_WEBHOOK_SECRET;
    if (!secret) {
      console.error("LINEAR_WEBHOOK_SECRET not configured");
      return apiServerError("Webhook not configured");
    }

    // Get raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get("linear-signature");

    // Verify signature
    const verified = verifySignature(rawBody, signature, secret);

    // Parse payload
    let payload: LinearWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return apiBadRequest("Invalid JSON payload");
    }

    // Store raw event
    const eventResult = await queryOne<{ id: string }>(
      `INSERT INTO source.linear_webhook_events (
         event_type, action, payload, signature, verified, received_at
       ) VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id`,
      [payload.type, payload.action, rawBody, signature, verified]
    );

    if (!eventResult) {
      return apiServerError("Failed to store webhook event");
    }

    // If signature verification fails, still store but don't process
    if (!verified) {
      console.warn(`Unverified Linear webhook: ${eventResult.id}`);
      return apiUnauthorized("Invalid signature");
    }

    // Process event based on type
    try {
      switch (payload.type) {
        case "Issue":
          await processIssueEvent(payload.action, payload.data);
          break;
        case "Project":
          await processProjectEvent(payload.action, payload.data);
          break;
        case "Cycle":
          await processCycleEvent(payload.action, payload.data);
          break;
        case "IssueLabel":
          await processLabelEvent(payload.action, payload.data);
          break;
        case "Comment":
          // Comments are logged but not processed to a separate table
          break;
        default:
          console.log(`Unhandled Linear webhook type: ${payload.type}`);
      }

      // Mark event as processed
      await query(
        `UPDATE source.linear_webhook_events
         SET processed_at = NOW()
         WHERE id = $1`,
        [eventResult.id]
      );
    } catch (processingError) {
      console.error("Error processing Linear webhook:", processingError);
      // Event is stored, can be reprocessed later
    }

    return apiSuccess({
      received: true,
      event_id: eventResult.id,
      type: payload.type,
      action: payload.action,
    });
  } catch (error) {
    console.error("Linear webhook error:", error);
    return apiServerError("Webhook processing failed");
  }
}

// Health check for webhook endpoint
export async function GET() {
  return apiSuccess({
    status: "ok",
    endpoint: "/api/webhooks/linear",
    description: "Linear webhook receiver",
  });
}
