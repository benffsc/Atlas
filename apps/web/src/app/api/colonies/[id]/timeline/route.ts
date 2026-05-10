import { NextRequest } from "next/server";
import { queryRows } from "@/lib/db";
import { requireValidUUID, withErrorHandling } from "@/lib/api-validation";
import { apiSuccess } from "@/lib/api-response";

/**
 * Colony Timeline API
 *
 * Assembles a narrative timeline from multiple sources:
 * - Journal entries (brain dumps, field visits, notes)
 * - Tippy tickets (field intelligence)
 * - Request lifecycle events (created, status changes)
 * - Appointment events (clinic visits)
 *
 * Returns events sorted newest-first, grouped by month for UI rendering.
 * Each event has a consistent shape regardless of source.
 */

export interface TimelineEvent {
  id: string;
  event_date: string;
  event_type: "journal" | "ticket" | "request" | "appointment" | "observation";
  title: string;
  body: string | null;
  actor: string | null; // who did this
  source_label: string; // "brain dump", "clinic data", "field visit", etc.
  tags: string[];
  // Links to related entities
  entity_links: Array<{ type: string; id: string; label: string }>;
}

export const GET = withErrorHandling(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: colonyId } = await params;
  requireValidUUID(colonyId, "colony");

  // Get all place_ids in this colony
  const placeIds = (await queryRows<{ place_id: string }>(
    `SELECT place_id::TEXT FROM sot.colony_places WHERE colony_id = $1 AND is_active = TRUE`,
    [colonyId]
  )).map(r => r.place_id);

  if (placeIds.length === 0) {
    return apiSuccess({ events: [], place_count: 0 });
  }

  // 1. Journal entries at colony places
  const journalEvents = await queryRows<TimelineEvent>(
    `SELECT
       je.id::TEXT AS id,
       COALESCE(je.occurred_at, je.created_at)::TEXT AS event_date,
       'journal' AS event_type,
       CASE je.entry_kind
         WHEN 'contact_attempt' THEN
           CASE je.contact_result
             WHEN 'answered' THEN 'Phone call — answered'
             WHEN 'left_voicemail' THEN 'Phone call — left voicemail'
             WHEN 'no_answer' THEN 'Phone call — no answer'
             ELSE 'Contact attempt'
           END
         WHEN 'field_visit' THEN 'Field visit'
         WHEN 'medical' THEN 'Medical note'
         WHEN 'trap_event' THEN 'Trapping event'
         WHEN 'status_change' THEN 'Status change'
         WHEN 'system' THEN 'System event'
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

  // 2. Tippy tickets at colony places
  const ticketEvents = await queryRows<TimelineEvent>(
    `SELECT
       tt.ticket_id::TEXT AS id,
       tt.created_at::TEXT AS event_date,
       'ticket' AS event_type,
       COALESCE(tt.summary, tt.ticket_type) AS title,
       tt.raw_input AS body,
       tt.reported_by AS actor,
       'field intel' AS source_label,
       COALESCE(tt.tags, ARRAY[]::TEXT[]) AS tags,
       ARRAY[]::JSONB[] AS entity_links
     FROM ops.tippy_tickets tt
     WHERE tt.primary_place_id = ANY($1::UUID[])
       AND tt.status != 'closed'
     ORDER BY tt.created_at DESC
     LIMIT 20`,
    [placeIds]
  );

  // 3. Request events (creation + resolution)
  const requestEvents = await queryRows<TimelineEvent>(
    `SELECT
       r.request_id::TEXT AS id,
       r.created_at::TEXT AS event_date,
       'request' AS event_type,
       'Request created' AS title,
       r.summary AS body,
       COALESCE(rq.first_name || ' ' || rq.last_name, rq.first_name, 'Unknown') AS actor,
       CASE r.source_system WHEN 'airtable' THEN 'legacy' WHEN 'web_intake' THEN 'intake' ELSE 'request' END AS source_label,
       ARRAY[]::TEXT[] AS tags,
       ARRAY[]::JSONB[] AS entity_links
     FROM ops.requests r
     LEFT JOIN sot.people rq ON rq.person_id = r.requester_person_id
     WHERE r.place_id = ANY($1::UUID[])
       AND r.merged_into_request_id IS NULL
     ORDER BY r.created_at DESC
     LIMIT 20`,
    [placeIds]
  );

  // 4. Appointments (clinic visits)
  const appointmentEvents = await queryRows<TimelineEvent>(
    `SELECT
       a.appointment_id::TEXT AS id,
       a.appointment_date::TEXT AS event_date,
       'appointment' AS event_type,
       CASE
         WHEN a.cat_count > 1 THEN a.cat_count || ' cats to clinic'
         ELSE 'Cat to clinic'
       END AS title,
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

  // 5. Colony observations
  const observationEvents = await queryRows<TimelineEvent>(
    `SELECT
       co.observation_id::TEXT AS id,
       co.observation_date::TEXT AS event_date,
       'observation' AS event_type,
       'Population observation' AS title,
       CASE
         WHEN co.total_cats IS NOT NULL AND co.fixed_cats IS NOT NULL
           THEN co.total_cats || ' cats seen (' || co.fixed_cats || ' fixed)'
         WHEN co.total_cats IS NOT NULL
           THEN co.total_cats || ' cats seen'
         ELSE co.notes
       END AS body,
       co.observed_by AS actor,
       'observation' AS source_label,
       ARRAY[]::TEXT[] AS tags,
       ARRAY[]::JSONB[] AS entity_links
     FROM sot.colony_observations co
     WHERE co.colony_id = $1
     ORDER BY co.observation_date DESC
     LIMIT 20`,
    [colonyId]
  );

  // Merge all events and sort newest-first
  const allEvents = [
    ...journalEvents,
    ...ticketEvents,
    ...requestEvents,
    ...appointmentEvents,
    ...observationEvents,
  ].sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime());

  return apiSuccess({
    events: allEvents,
    place_count: placeIds.length,
  });
});
