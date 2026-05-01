import { NextRequest } from "next/server";
import { queryOne, execute } from "@/lib/db";
import { requireValidUUID, withErrorHandling, ApiError } from "@/lib/api-validation";
import { apiSuccess, apiBadRequest, apiNotFound } from "@/lib/api-response";
import { getSession } from "@/lib/auth";

/**
 * POST /api/requests/[id]/field-contacts
 *
 * One-shot field contact capture. Two paths:
 *   - Has phone/email → resolve via find_or_create_person, set person_id FK
 *   - Name only → store on relationship row, person_id = NULL (no ghost sot.people record)
 *
 * PATCH /api/requests/[id]/field-contacts
 *
 * Enrich an unresolved contact — add phone/email to trigger identity resolution.
 */
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "request");

  const session = await getSession(request);
  if (!session) return apiBadRequest("Not authenticated");

  let body: {
    first_name: string;
    last_name: string;
    phone: string;
    phone2?: string;
    email?: string;
    address?: string;
    relationship_type: string;
    notes?: string;
    set_as_site_contact?: boolean;
    referred_by_person_id?: string;
  };

  try {
    body = await request.json();
  } catch {
    throw new ApiError("Invalid JSON", 400);
  }

  if (!body.first_name?.trim() && !body.last_name?.trim()) {
    throw new ApiError("First or last name is required", 400);
  }
  if (!body.relationship_type) {
    throw new ApiError("relationship_type is required", 400);
  }

  const hasPhone = !!body.phone?.trim();
  const hasEmail = !!body.email?.trim();
  const hasIdentifier = hasPhone || hasEmail;
  const hasLastName = !!body.last_name?.trim();
  const infoCompleteness: string = !hasIdentifier
    ? "name_only"
    : !hasLastName
      ? "partial"
      : "full";

  // Verify request exists
  const req = await queryOne<{ request_id: string; place_id: string | null }>(
    `SELECT request_id, place_id::TEXT FROM ops.requests WHERE request_id = $1`,
    [id]
  );
  if (!req) return apiNotFound("Request not found");

  const normPhone = (body.phone || "").replace(/\D/g, "") || null;
  const normPhone2 = (body.phone2 || "").replace(/\D/g, "") || null;
  const normEmail = body.email?.trim().toLowerCase() || null;
  const address = body.address?.trim() || null;
  const displayName = `${body.first_name?.trim() || ""} ${body.last_name?.trim() || ""}`.trim();

  let personId: string | null = null;
  let placeId: string | null = null;

  if (hasIdentifier) {
    // === RESOLVED PATH: create/find person via Data Engine ===
    const personResult = await queryOne<{ person_id: string }>(
      `SELECT sot.find_or_create_person($1, $2, $3, $4, $5, 'atlas_ui')::TEXT AS person_id`,
      [normEmail, normPhone, body.first_name?.trim() || null, body.last_name?.trim() || null, address]
    );
    if (!personResult?.person_id) {
      throw new ApiError("Failed to create person record", 500);
    }
    personId = personResult.person_id;

    // Add second phone if provided
    if (normPhone2) {
      await execute(
        `INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
         VALUES ($1, 'phone', $2, $3, 1.0, 'atlas_ui')
         ON CONFLICT (id_type, id_value_norm) DO NOTHING`,
        [personId, body.phone2, normPhone2]
      );
    }

    // Create/find place and link person→place if address provided
    if (address) {
      const placeResult = await queryOne<{ find_or_create_place_deduped: string }>(
        `SELECT sot.find_or_create_place_deduped($1, NULL, NULL, NULL, 'atlas_ui')`,
        [address]
      );
      placeId = placeResult?.find_or_create_place_deduped || null;

      if (placeId) {
        await execute(
          `INSERT INTO sot.person_place (person_id, place_id, relationship_type, evidence_type, source_system)
           VALUES ($1, $2, $3, 'manual', 'atlas_ui')
           ON CONFLICT DO NOTHING`,
          [personId, placeId, body.relationship_type]
        );
      }
    }
  }
  // === UNRESOLVED PATH: name-only, no sot.people record created ===
  // Contact info stored directly on request_related_people row

  // Link to request
  await execute(
    `INSERT INTO ops.request_related_people (
      request_id, person_id, relationship_type, relationship_notes,
      contact_name, contact_phone, contact_phone2, contact_email, contact_address,
      referred_by_person_id, info_completeness, source_system, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'atlas_ui', $12)
     ON CONFLICT ${personId ? "(request_id, person_id, relationship_type) WHERE person_id IS NOT NULL" : "(request_id, contact_name, relationship_type) WHERE person_id IS NULL"} DO UPDATE SET
       relationship_notes = EXCLUDED.relationship_notes,
       contact_phone = COALESCE(EXCLUDED.contact_phone, ops.request_related_people.contact_phone),
       contact_email = COALESCE(EXCLUDED.contact_email, ops.request_related_people.contact_email),
       contact_address = COALESCE(EXCLUDED.contact_address, ops.request_related_people.contact_address),
       referred_by_person_id = COALESCE(EXCLUDED.referred_by_person_id, ops.request_related_people.referred_by_person_id),
       info_completeness = EXCLUDED.info_completeness,
       updated_at = NOW()`,
    [
      id, personId, body.relationship_type, body.notes?.trim() || null,
      displayName, normPhone, normPhone2, normEmail, address,
      body.referred_by_person_id || null, infoCompleteness, session.email || null,
    ]
  );

  // Optionally set as site_contact_person_id (only if resolved)
  if (body.set_as_site_contact && personId) {
    await execute(
      `UPDATE ops.requests SET site_contact_person_id = $1, updated_at = NOW() WHERE request_id = $2`,
      [personId, id]
    );
  }

  // Journal entry
  const phoneParts: string[] = [];
  if (normPhone) phoneParts.push(normPhone);
  if (normPhone2) phoneParts.push(normPhone2);

  let referrerName = "";
  if (body.referred_by_person_id) {
    const ref = await queryOne<{ display_name: string }>(
      `SELECT display_name FROM sot.people WHERE person_id = $1`,
      [body.referred_by_person_id]
    );
    if (ref?.display_name) referrerName = ref.display_name;
  }

  const journalBody = `Field contact added: ${displayName} (${body.relationship_type})${address ? ` at ${address}` : ""}. Phone: ${phoneParts.join(", ") || "none"}.${referrerName ? ` Referred by ${referrerName}.` : ""}${infoCompleteness === "name_only" ? " [NAME ONLY — needs follow-up identifier]" : ""}${body.notes ? ` Notes: ${body.notes}` : ""}`;

  await execute(
    `INSERT INTO ops.journal_entries (
      entry_kind, occurred_at, body, created_by, tags,
      primary_person_id, primary_request_id, primary_place_id
    ) VALUES (
      'note', NOW(), $1, $2, ARRAY['field_contact'],
      $3, $4, $5
    )`,
    [journalBody, session.email || "atlas_ui", personId, id, placeId || req.place_id]
  );

  return apiSuccess({
    person_id: personId,
    place_id: placeId,
    display_name: displayName,
    relationship_type: body.relationship_type,
    info_completeness: infoCompleteness,
  });
});

/**
 * PATCH /api/requests/[id]/field-contacts
 *
 * Enrich an unresolved field contact — add phone/email to trigger identity resolution.
 * Converts a name-only relationship row into a resolved person.
 */
export const PATCH = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  requireValidUUID(id, "request");

  const session = await getSession(request);
  if (!session) return apiBadRequest("Not authenticated");

  let body: {
    related_person_row_id: string;
    phone?: string;
    email?: string;
    last_name?: string;
  };

  try {
    body = await request.json();
  } catch {
    throw new ApiError("Invalid JSON", 400);
  }

  if (!body.related_person_row_id) {
    throw new ApiError("related_person_row_id is required", 400);
  }
  requireValidUUID(body.related_person_row_id, "related_person_row");

  const normPhone = (body.phone || "").replace(/\D/g, "") || null;
  const normEmail = body.email?.trim().toLowerCase() || null;

  if (!normPhone && !normEmail && !body.last_name?.trim()) {
    throw new ApiError("Provide phone, email, or last_name to enrich", 400);
  }

  // Fetch the existing row
  const row = await queryOne<{
    id: string;
    person_id: string | null;
    contact_name: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    contact_address: string | null;
    relationship_type: string;
  }>(
    `SELECT id, person_id::TEXT, contact_name, contact_phone, contact_email, contact_address, relationship_type
     FROM ops.request_related_people
     WHERE id = $1 AND request_id = $2`,
    [body.related_person_row_id, id]
  );

  if (!row) return apiNotFound("Related person row not found");

  // Update contact columns on the row
  const phone = normPhone || row.contact_phone;
  const email = normEmail || row.contact_email;

  await execute(
    `UPDATE ops.request_related_people SET
       contact_phone = COALESCE($1, contact_phone),
       contact_email = COALESCE($2, contact_email),
       updated_at = NOW()
     WHERE id = $3`,
    [normPhone, normEmail, row.id]
  );

  // If we now have an identifier and no person_id yet, resolve
  if (!row.person_id && (phone || email)) {
    const nameParts = (row.contact_name || "").split(/\s+/);
    const firstName = nameParts[0] || null;
    const lastName = body.last_name?.trim() || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : null);

    const personResult = await queryOne<{ person_id: string }>(
      `SELECT sot.find_or_create_person($1, $2, $3, $4, $5, 'atlas_ui')::TEXT AS person_id`,
      [email, phone, firstName, lastName, row.contact_address]
    );

    if (personResult?.person_id) {
      // Update the row with resolved person_id and new completeness
      const newCompleteness = lastName ? "full" : "partial";
      await execute(
        `UPDATE ops.request_related_people SET
           person_id = $1,
           info_completeness = $2,
           updated_at = NOW()
         WHERE id = $3`,
        [personResult.person_id, newCompleteness, row.id]
      );

      // Link person to place if address exists
      if (row.contact_address) {
        const placeResult = await queryOne<{ find_or_create_place_deduped: string }>(
          `SELECT sot.find_or_create_place_deduped($1, NULL, NULL, NULL, 'atlas_ui')`,
          [row.contact_address]
        );
        if (placeResult?.find_or_create_place_deduped) {
          await execute(
            `INSERT INTO sot.person_place (person_id, place_id, relationship_type, evidence_type, source_system)
             VALUES ($1, $2, $3, 'manual', 'atlas_ui')
             ON CONFLICT DO NOTHING`,
            [personResult.person_id, placeResult.find_or_create_place_deduped, row.relationship_type]
          );
        }
      }

      // Journal
      await execute(
        `INSERT INTO ops.journal_entries (
          entry_kind, occurred_at, body, created_by, tags,
          primary_person_id, primary_request_id
        ) VALUES (
          'note', NOW(), $1, $2, ARRAY['field_contact', 'enriched'],
          $3, $4
        )`,
        [
          `Field contact enriched: ${row.contact_name} now has ${phone ? "phone" : ""}${phone && email ? " + " : ""}${email ? "email" : ""} — resolved to person record.`,
          session.email || "atlas_ui",
          personResult.person_id,
          id,
        ]
      );

      return apiSuccess({
        enriched: true,
        person_id: personResult.person_id,
        info_completeness: newCompleteness,
      });
    }
  }

  // Just updated contact columns, no resolution happened (or already resolved)
  return apiSuccess({
    enriched: false,
    person_id: row.person_id,
    info_completeness: row.person_id ? "full" : "partial",
  });
});
