import { NextRequest } from "next/server";
import { apiSuccess, apiBadRequest, apiServerError } from "@/lib/api-response";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";

const ALLOWED_ACTION_TYPES = new Set([
  "add_note",
  "field_event",
  "site_observation",
  "toggle_person_watchlist",
  "end_person_address",
  "move_person_address",
  "add_field_contact",
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

    if (action_type === "toggle_person_watchlist") {
      const watchList = proposed_changes?.watch_list !== false;
      const reason = (proposed_changes?.reason as string) || "";

      const result = await queryOne<{ success: boolean; message: string }>(
        `SELECT * FROM ops.toggle_person_watchlist($1, $2, $3, $4)`,
        [entity_id, watchList, reason || null, session.display_name || "tippy"]
      );

      return apiSuccess({
        executed: true,
        message: result?.message || `Watch list updated for ${entity_name}`,
        entity_url: entity_id ? `/people/${entity_id}` : null,
      });
    }

    if (action_type === "end_person_address") {
      const placeId = proposed_changes?.place_id as string;
      if (!placeId || !UUID_REGEX.test(placeId)) {
        return apiBadRequest("place_id is required");
      }

      await queryOne(
        `SELECT sot.end_person_place_relationship($1, $2, $3)`,
        [entity_id, placeId, session.display_name || "tippy"]
      );

      return apiSuccess({
        executed: true,
        message: `Address marked as former for ${entity_name}`,
        entity_url: entity_id ? `/people/${entity_id}` : null,
      });
    }

    if (action_type === "move_person_address") {
      const oldPlaceId = proposed_changes?.old_place_id as string;
      let newPlaceId = proposed_changes?.new_place_id as string;
      const newAddress = proposed_changes?.new_address as string;
      const relationshipType = (proposed_changes?.relationship_type as string) || "resident";

      if (!oldPlaceId || !UUID_REGEX.test(oldPlaceId)) {
        return apiBadRequest("old_place_id is required");
      }

      // Create new place if needed
      if (!newPlaceId || newPlaceId === "(will be created)") {
        if (!newAddress) return apiBadRequest("new_address is required when new_place_id is not set");
        const created = await queryOne<{ place_id: string }>(
          `SELECT sot.find_or_create_place_deduped($1, NULL, NULL, NULL, 'atlas_ui')::text AS place_id`,
          [newAddress]
        );
        if (!created) return apiBadRequest("Could not create new place");
        newPlaceId = created.place_id;
      }

      await queryOne(
        `SELECT sot.move_person_to_place($1, $2, $3, $4, $5)`,
        [entity_id, oldPlaceId, newPlaceId, relationshipType, session.display_name || "tippy"]
      );

      return apiSuccess({
        executed: true,
        message: `${entity_name} moved to new address`,
        entity_url: entity_id ? `/people/${entity_id}` : null,
      });
    }

    if (action_type === "add_field_contact") {
      // Re-dispatch to the Tippy tools for field contact creation
      // This is a more complex action — delegate to the tool implementation
      const { executeToolCallV2 } = await import("../tools-v2");
      const result = await executeToolCallV2("log_event", {
        action_type: "add_field_contact",
        ...proposed_changes,
      }, {
        staffId: session.staff_id || "",
        staffName: session.display_name || "staff",
        aiAccessLevel: "full",
      });

      return apiSuccess({
        executed: result.success,
        message: result.success
          ? `Field contact created for ${entity_name}`
          : (result.error || "Failed to create field contact"),
        entity_url: (result.data as Record<string, unknown>)?.person_id ? `/people/${(result.data as Record<string, unknown>).person_id}` : null,
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
