import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { requireValidUUID, withErrorHandling } from "@/lib/api-validation";
import { apiSuccess } from "@/lib/api-response";

/**
 * Colony Timeline API
 *
 * Uses ops.site_timeline (populated by triggers) for a single-query timeline.
 * Falls back to multi-source assembly if site_timeline is empty (pre-MIG_3135 data).
 */

export interface TimelineEvent {
  id: string;
  event_date: string;
  event_type: "journal" | "ticket" | "request" | "appointment" | "observation" | string;
  title: string;
  body: string | null;
  actor: string | null;
  source_label: string;
  tags: string[];
  entity_links: Array<{ type: string; id: string; label: string }>;
}

export const GET = withErrorHandling(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: colonyId } = await params;
  requireValidUUID(colonyId, "colony");

  // Try site_timeline first (single query, trigger-populated)
  const timelineEvents = await queryRows<TimelineEvent>(
    `SELECT
       st.event_id::TEXT AS id,
       st.event_date::TEXT AS event_date,
       st.event_type,
       st.title,
       st.body,
       st.actor,
       COALESCE(st.source_table, st.event_type) AS source_label,
       COALESCE((st.metadata->>'tags')::TEXT[], ARRAY[]::TEXT[]) AS tags,
       ARRAY[]::JSONB[] AS entity_links
     FROM ops.site_timeline st
     WHERE st.site_id = $1
     ORDER BY st.event_date DESC
     LIMIT 100`,
    [colonyId]
  );

  if (timelineEvents.length > 0) {
    return apiSuccess({ events: timelineEvents, place_count: null });
  }

  // Fallback: assemble from multiple sources (for colonies without site_timeline data)
  const placeIds = (await queryRows<{ place_id: string }>(
    `SELECT place_id::TEXT FROM sot.colony_places WHERE colony_id = $1 AND is_active = TRUE`,
    [colonyId]
  )).map(r => r.place_id);

  if (placeIds.length === 0) {
    return apiSuccess({ events: [], place_count: 0 });
  }

  const journalEvents = await queryRows<TimelineEvent>(
    `SELECT
       je.id::TEXT AS id,
       COALESCE(je.occurred_at, je.created_at)::TEXT AS event_date,
       'journal' AS event_type,
       CASE je.entry_kind
         WHEN 'contact_attempt' THEN 'Contact attempt'
         WHEN 'field_visit' THEN 'Field visit'
         WHEN 'trap_event' THEN 'Trapping event'
         ELSE 'Note'
       END AS title,
       je.body,
       COALESCE(je.created_by_staff_name, je.created_by) AS actor,
       CASE je.entry_kind
         WHEN 'contact_attempt' THEN 'phone'
         WHEN 'field_visit' THEN 'field visit'
         WHEN 'trap_event' THEN 'trapping'
         ELSE 'brain dump'
       END AS source_label,
       COALESCE(je.tags, ARRAY[]::TEXT[]) AS tags,
       ARRAY[]::JSONB[] AS entity_links
     FROM ops.journal_entries je
     WHERE je.primary_place_id = ANY($1::UUID[])
       AND je.is_archived = FALSE
     ORDER BY COALESCE(je.occurred_at, je.created_at) DESC
     LIMIT 50`,
    [placeIds]
  );

  const requestEvents = await queryRows<TimelineEvent>(
    `SELECT
       r.request_id::TEXT AS id,
       r.created_at::TEXT AS event_date,
       'request' AS event_type,
       'Request created' AS title,
       r.summary AS body,
       NULL AS actor,
       'request' AS source_label,
       ARRAY[]::TEXT[] AS tags,
       ARRAY[]::JSONB[] AS entity_links
     FROM ops.requests r
     WHERE r.place_id = ANY($1::UUID[])
       AND r.merged_into_request_id IS NULL
     ORDER BY r.created_at DESC
     LIMIT 20`,
    [placeIds]
  );

  const appointmentEvents = await queryRows<TimelineEvent>(
    `SELECT
       a.appointment_id::TEXT AS id,
       a.appointment_date::TEXT AS event_date,
       'appointment' AS event_type,
       CASE WHEN a.cat_count > 1 THEN a.cat_count || ' cats to clinic' ELSE 'Cat to clinic' END AS title,
       a.client_name AS body,
       NULL AS actor,
       'clinic data' AS source_label,
       ARRAY[]::TEXT[] AS tags,
       ARRAY[]::JSONB[] AS entity_links
     FROM ops.appointments a
     WHERE (a.place_id = ANY($1::UUID[]) OR a.inferred_place_id = ANY($1::UUID[]))
     ORDER BY a.appointment_date DESC
     LIMIT 30`,
    [placeIds]
  );

  const allEvents = [
    ...journalEvents,
    ...requestEvents,
    ...appointmentEvents,
  ].sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime());

  return apiSuccess({ events: allEvents, place_count: placeIds.length });
});
