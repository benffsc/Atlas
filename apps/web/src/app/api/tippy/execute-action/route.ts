import { NextRequest } from "next/server";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";

const ALLOWED_ACTION_TYPES = new Set([
  "add_note",
  "field_event",
  "site_observation",
]);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    return apiBadRequest("Authentication required");
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  const {
    card_id,
    action_type,
    entity_type,
    entity_id,
    entity_name,
    proposed_changes,
  } = body as {
    card_id: string;
    action_type: string;
    entity_type: string;
    entity_id: string | null;
    entity_name: string;
    proposed_changes: Record<string, unknown>;
  };

  if (!card_id || !action_type) {
    return apiBadRequest("card_id and action_type are required");
  }

  if (!ALLOWED_ACTION_TYPES.has(action_type)) {
    return apiBadRequest(`Action type "${action_type}" is not allowed`);
  }

  if (entity_id && !UUID_REGEX.test(entity_id)) {
    return apiBadRequest("Invalid entity_id format");
  }

  try {
    // Execute the confirmed action
    if (action_type === "add_note") {
      const notes =
        (proposed_changes?.notes as string) ||
        (proposed_changes?.body as string) ||
        `Confirmed action: ${entity_name}`;

      const result = await queryOne<{ id: string }>(
        `INSERT INTO ops.journal_entries (
          entry_kind, occurred_at, body, created_by, tags,
          primary_place_id, primary_person_id, primary_cat_id, primary_request_id
        ) VALUES (
          'note', NOW(), $1, $2, $3,
          $4, $5, $6, $7
        ) RETURNING id`,
        [
          notes,
          ["tippy", "action_confirmed"],
          session.display_name || "staff",
          entity_type === "place" ? entity_id : null,
          entity_type === "person" ? entity_id : null,
          entity_type === "cat" ? entity_id : null,
          entity_type === "request" ? entity_id : null,
        ]
      );

      const entityUrl = entity_id
        ? `/${entity_type === "request" ? "requests" : entity_type + "s"}/${entity_id}`
        : null;

      return apiSuccess({
        executed: true,
        journal_entry_id: result?.id,
        entity_url: entityUrl,
        message: `Note saved for ${entity_name}`,
      });
    }

    if (action_type === "field_event" || action_type === "site_observation") {
      const notes =
        (proposed_changes?.notes as string) ||
        `Field event at ${entity_name}`;

      await queryOne(
        `INSERT INTO ops.journal_entries (
          entry_kind, occurred_at, body, created_by, tags,
          primary_place_id
        ) VALUES (
          $1, NOW(), $2, $3, $4, $5
        ) RETURNING id`,
        [
          action_type === "field_event" ? "observation" : "site_observation",
          notes,
          session.display_name || "staff",
          ["tippy", "action_confirmed"],
          entity_type === "place" ? entity_id : null,
        ]
      );

      return apiSuccess({
        executed: true,
        message: `Event logged for ${entity_name}`,
      });
    }

    return apiBadRequest(`Unhandled action_type: ${action_type}`);
  } catch (error) {
    console.error("Execute action error:", error);
    return apiServerError(
      error instanceof Error ? error.message : "Failed to execute action"
    );
  }
}
