import { NextRequest } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { requireValidUUID, withErrorHandling } from "@/lib/api-validation";
import { apiSuccess } from "@/lib/api-response";
import { getServerConfig } from "@/lib/server-config";

interface ColonyContextPlace {
  place_id: string;
  display_name: string | null;
  formatted_address: string;
  relationship: string; // "self" | "corridor" | "nearby"
  place_role: string | null; // colony_places.place_role
  is_primary: boolean;
  cat_count: number;
  altered_count: number;
  primary_contact: string | null;
  request_status: string | null;
  request_id: string | null;
  request_summary: string | null;
}

interface ColonyContextPerson {
  person_id: string;
  display_name: string | null;
  role_type: string;
  role_label: string;
  phone: string | null;
}

interface ColonyContextRequest {
  request_id: string;
  status: string;
  summary: string | null;
  requester_name: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface ColonyInfo {
  colony_id: string;
  colony_name: string;
  status: string;
}

// Three modes of discovery:
// "colony"   — Full colony record exists. Show all management actions.
// "corridor" — shared_colony edges exist but no colony record. Suggest creating one.
// "nearby"   — No edges, but nearby addresses have requests/cat activity. Gentle hint.
// "none"     — Nothing to show.
type ContextMode = "colony" | "corridor" | "nearby" | "none";

// GET /api/places/[id]/colony-context
export const GET = withErrorHandling(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: placeId } = await params;
  requireValidUUID(placeId, "place");

  const empty = { mode: "none" as ContextMode, colony: null, places: [], requests: [], total_cats: 0, altered_cats: 0 };

  // ── 1. Check if this place belongs to a colony ──
  const colony = await queryOne<ColonyInfo>(
    `SELECT c.colony_id, c.name AS colony_name, c.colony_status AS status
     FROM sot.colony_places cp
     JOIN sot.colonies c ON c.colony_id = cp.colony_id
       AND c.deleted_at IS NULL
       AND c.merged_into_colony_id IS NULL
     WHERE cp.place_id = $1
       AND cp.is_active = TRUE
     LIMIT 1`,
    [placeId]
  );

  // ── 2. Get corridor places (shared_colony edges) ──
  const corridorPlaces = await queryRows<ColonyContextPlace>(
    `SELECT
       cp.place_id,
       cp.display_name,
       cp.formatted_address,
       cp.relationship,
       col_p.place_role,
       COALESCE(col_p.is_primary, false) AS is_primary,
       COALESCE(cats.cat_count, 0)::int AS cat_count,
       COALESCE(cats.altered_count, 0)::int AS altered_count,
       contact.contact_name AS primary_contact,
       req.status AS request_status,
       req.request_id,
       req.summary AS request_summary
     FROM sot.get_corridor_places($1) cp
     LEFT JOIN sot.colony_places col_p
       ON col_p.place_id = cp.place_id
       AND col_p.colony_id = $2
       AND col_p.is_active = TRUE
     LEFT JOIN LATERAL (
       SELECT
         COUNT(DISTINCT cpl.cat_id) AS cat_count,
         COUNT(DISTINCT cpl.cat_id) FILTER (
           WHERE cat.altered_status IN ('spayed','neutered','altered')
         ) AS altered_count
       FROM sot.cat_place cpl
       JOIN sot.cats cat ON cat.cat_id = cpl.cat_id AND cat.merged_into_cat_id IS NULL
       WHERE cpl.place_id = cp.place_id
         AND COALESCE(cpl.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
     ) cats ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.last_name) AS contact_name
       FROM sot.person_place pp
       JOIN sot.people p ON p.person_id = pp.person_id AND p.merged_into_person_id IS NULL
       WHERE pp.place_id = cp.place_id
       ORDER BY pp.confidence DESC
       LIMIT 1
     ) contact ON true
     LEFT JOIN LATERAL (
       SELECT r.request_id, r.status, r.summary
       FROM ops.requests r
       WHERE r.place_id = cp.place_id
         AND r.merged_into_request_id IS NULL
         AND r.is_archived = FALSE
       ORDER BY
         CASE WHEN r.status IN ('new','triaged','scheduled','in_progress') THEN 0 ELSE 1 END,
         r.created_at DESC
       LIMIT 1
     ) req ON true
     ORDER BY
       CASE WHEN cp.place_id = $1 THEN 0 ELSE 1 END,
       COALESCE(col_p.is_primary, false) DESC,
       cp.formatted_address`,
    [placeId, colony?.colony_id || '00000000-0000-0000-0000-000000000000']
  );

  // If we have a colony or multi-place corridor → return "colony" or "corridor" mode
  if (corridorPlaces.length > 1 || colony) {
    const mode: ContextMode = colony ? "colony" : "corridor";
    const placeIds = corridorPlaces.map(p => p.place_id);
    const requests = await fetchRequestsForPlaces(placeIds, colony?.colony_id || null);

    // Fetch colony people (feeders, contacts, coordinators)
    let people: ColonyContextPerson[] = [];
    if (colony) {
      people = await queryRows<ColonyContextPerson>(
        `SELECT
           cp.person_id::TEXT,
           COALESCE(p.display_name, p.first_name || ' ' || p.last_name, p.first_name) AS display_name,
           cp.role_type,
           CASE cp.role_type
             WHEN 'primary_feeder' THEN 'Primary Feeder'
             WHEN 'feeder' THEN 'Feeder'
             WHEN 'reporter' THEN 'Reporter'
             WHEN 'contact' THEN 'Contact'
             WHEN 'property_owner' THEN 'Property Owner'
             WHEN 'trapper_assigned' THEN 'Assigned Trapper'
             WHEN 'coordinator' THEN 'Coordinator'
             ELSE 'Other'
           END AS role_label,
           sot.get_phone(p.person_id) AS phone
         FROM sot.colony_people cp
         JOIN sot.people p ON p.person_id = cp.person_id AND p.merged_into_person_id IS NULL
         WHERE cp.colony_id = $1 AND cp.is_active = TRUE
         ORDER BY
           CASE cp.role_type
             WHEN 'primary_feeder' THEN 1
             WHEN 'coordinator' THEN 2
             WHEN 'trapper_assigned' THEN 3
             WHEN 'feeder' THEN 4
             WHEN 'property_owner' THEN 5
             ELSE 10
           END`,
        [colony.colony_id]
      );
    }

    const totalCats = corridorPlaces.reduce((s, p) => s + p.cat_count, 0);
    const alteredCats = corridorPlaces.reduce((s, p) => s + p.altered_count, 0);

    return apiSuccess({ mode, colony, places: corridorPlaces, requests, people, total_cats: totalCats, altered_cats: alteredCats });
  }

  // ── 3. No colony, no corridor — check for nearby activity ──
  // Find nearby places that have requests or 3+ cats.
  // This is the "discovery" mode — staff doesn't know this is part of something bigger.
  const radiusM = await getServerConfig<number>("colonies.nearby_radius_m", 300);

  const nearbyPlaces = await queryRows<ColonyContextPlace>(
    `SELECT
       p.place_id,
       p.display_name,
       p.formatted_address,
       'nearby' AS relationship,
       NULL AS place_role,
       false AS is_primary,
       COALESCE(cats.cat_count, 0)::int AS cat_count,
       COALESCE(cats.altered_count, 0)::int AS altered_count,
       contact.contact_name AS primary_contact,
       req.status AS request_status,
       req.request_id,
       req.summary AS request_summary
     FROM sot.places p
     CROSS JOIN (SELECT location FROM sot.places WHERE place_id = $1) center
     LEFT JOIN LATERAL (
       SELECT
         COUNT(DISTINCT cpl.cat_id) AS cat_count,
         COUNT(DISTINCT cpl.cat_id) FILTER (
           WHERE cat.altered_status IN ('spayed','neutered','altered')
         ) AS altered_count
       FROM sot.cat_place cpl
       JOIN sot.cats cat ON cat.cat_id = cpl.cat_id AND cat.merged_into_cat_id IS NULL
       WHERE cpl.place_id = p.place_id
         AND COALESCE(cpl.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
     ) cats ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(pe.first_name || ' ' || pe.last_name, pe.first_name, pe.last_name) AS contact_name
       FROM sot.person_place pp
       JOIN sot.people pe ON pe.person_id = pp.person_id AND pe.merged_into_person_id IS NULL
       WHERE pp.place_id = p.place_id
       ORDER BY pp.confidence DESC
       LIMIT 1
     ) contact ON true
     LEFT JOIN LATERAL (
       SELECT r.request_id, r.status, r.summary
       FROM ops.requests r
       WHERE r.place_id = p.place_id
         AND r.merged_into_request_id IS NULL
         AND r.is_archived = FALSE
       ORDER BY
         CASE WHEN r.status IN ('new','triaged','scheduled','in_progress') THEN 0 ELSE 1 END,
         r.created_at DESC
       LIMIT 1
     ) req ON true
     WHERE p.place_id != $1
       AND p.merged_into_place_id IS NULL
       AND p.location IS NOT NULL
       AND center.location IS NOT NULL
       AND ST_DWithin(p.location::geography, center.location::geography, $2)
       -- Only include places that have real activity (requests or cats)
       AND (
         EXISTS (
           SELECT 1 FROM ops.requests r2
           WHERE r2.place_id = p.place_id AND r2.merged_into_request_id IS NULL AND r2.is_archived = FALSE
         )
         OR COALESCE(cats.cat_count, 0) >= 3
       )
     ORDER BY
       ST_Distance(p.location::geography, center.location::geography)
     LIMIT 6`,
    [placeId, radiusM]
  );

  if (nearbyPlaces.length === 0) {
    return apiSuccess(empty);
  }

  // Build full list: self + nearby
  const selfPlace = await queryOne<ColonyContextPlace>(
    `SELECT
       p.place_id,
       p.display_name,
       p.formatted_address,
       'self' AS relationship,
       NULL AS place_role,
       false AS is_primary,
       COALESCE((
         SELECT COUNT(DISTINCT cpl.cat_id)
         FROM sot.cat_place cpl
         JOIN sot.cats cat ON cat.cat_id = cpl.cat_id AND cat.merged_into_cat_id IS NULL
         WHERE cpl.place_id = p.place_id
           AND COALESCE(cpl.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
       ), 0)::int AS cat_count,
       COALESCE((
         SELECT COUNT(DISTINCT cpl.cat_id) FILTER (WHERE cat.altered_status IN ('spayed','neutered','altered'))
         FROM sot.cat_place cpl
         JOIN sot.cats cat ON cat.cat_id = cpl.cat_id AND cat.merged_into_cat_id IS NULL
         WHERE cpl.place_id = p.place_id
           AND COALESCE(cpl.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
       ), 0)::int AS altered_count,
       NULL AS primary_contact,
       NULL AS request_status,
       NULL AS request_id,
       NULL AS request_summary
     FROM sot.places p
     WHERE p.place_id = $1`,
    [placeId]
  );

  const allPlaces = selfPlace ? [selfPlace, ...nearbyPlaces] : nearbyPlaces;
  const allPlaceIds = allPlaces.map(p => p.place_id);
  const requests = await fetchRequestsForPlaces(allPlaceIds, null);

  const totalCats = allPlaces.reduce((s, p) => s + p.cat_count, 0);
  const alteredCats = allPlaces.reduce((s, p) => s + p.altered_count, 0);

  return apiSuccess({ mode: "nearby" as ContextMode, colony: null, places: allPlaces, requests, total_cats: totalCats, altered_cats: alteredCats });
});

// ── Helper: fetch requests for a set of places + optional colony ──
async function fetchRequestsForPlaces(placeIds: string[], colonyId: string | null): Promise<ColonyContextRequest[]> {
  let requests: ColonyContextRequest[] = [];

  if (placeIds.length > 0) {
    requests = await queryRows<ColonyContextRequest>(
      `SELECT DISTINCT ON (r.request_id)
         r.request_id, r.status, r.summary,
         COALESCE(rq.first_name || ' ' || rq.last_name, rq.first_name) AS requester_name,
         r.created_at, r.resolved_at
       FROM ops.requests r
       LEFT JOIN sot.people rq ON rq.person_id = r.requester_person_id
       WHERE r.place_id = ANY($1)
         AND r.merged_into_request_id IS NULL
         AND r.is_archived = FALSE
       ORDER BY r.request_id, r.created_at DESC`,
      [placeIds]
    );
  }

  if (colonyId) {
    const colonyRequests = await queryRows<ColonyContextRequest>(
      `SELECT DISTINCT ON (r.request_id)
         r.request_id, r.status, r.summary,
         COALESCE(rq.first_name || ' ' || rq.last_name, rq.first_name) AS requester_name,
         r.created_at, r.resolved_at
       FROM sot.colony_requests cr
       JOIN ops.requests r ON r.request_id = cr.request_id
       LEFT JOIN sot.people rq ON rq.person_id = r.requester_person_id
       WHERE cr.colony_id = $1 AND cr.deleted_at IS NULL AND r.merged_into_request_id IS NULL
       ORDER BY r.request_id, r.created_at DESC`,
      [colonyId]
    );
    const seen = new Set(requests.map(r => r.request_id));
    for (const r of colonyRequests) {
      if (!seen.has(r.request_id)) { requests.push(r); seen.add(r.request_id); }
    }
  }

  const activeStatuses = new Set(["new", "triaged", "scheduled", "in_progress"]);
  requests.sort((a, b) => {
    const aA = activeStatuses.has(a.status) ? 0 : 1;
    const bA = activeStatuses.has(b.status) ? 0 : 1;
    if (aA !== bA) return aA - bA;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return requests;
}
