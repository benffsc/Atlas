import { NextRequest } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { apiSuccess, apiServerError, apiBadRequest } from "@/lib/api-response";

export interface PersonSuggestionResult {
  person_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  entity_type: string;
  email: string | null;
  phone: string | null;
  cat_count: number;
  match_type: "email" | "phone" | "both";
  addresses: Array<{
    place_id: string;
    formatted_address: string;
    role: string;
  }>;
}

interface PersonRow {
  person_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  entity_type: string;
  email: string | null;
  phone: string | null;
  cat_count: number;
  matched_email: boolean;
  matched_phone: boolean;
}

interface AddressRow {
  person_id: string;
  place_id: string;
  formatted_address: string;
  role: string;
}

/**
 * POST /api/people/suggest
 *
 * Identity-grade person lookup by email/phone.
 * Returns matching people with rich context for duplicate prevention.
 *
 * Filters:
 * - confidence >= 0.5 (excludes PetLink fabricated emails)
 * - merged_into_person_id IS NULL (merge-aware)
 * - canonical = TRUE
 * - Skips soft-blacklisted identifiers (org emails)
 * - Minimum input: email must contain @, phone must have 7+ digits
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, phone } = body as { email?: string; phone?: string };

    const hasEmail = typeof email === "string" && email.includes("@");
    const hasPhone = typeof phone === "string" && phone.replace(/\D/g, "").length >= 7;

    if (!hasEmail && !hasPhone) {
      return apiBadRequest("Email (with @) or phone (7+ digits) required");
    }

    // Check soft blacklist for the provided identifiers
    if (hasEmail) {
      const blacklisted = await queryOne<{ count: number }>(
        `SELECT count(*)::int as count FROM sot.data_engine_soft_blacklist
         WHERE identifier_type = 'email' AND identifier_norm = sot.norm_email($1)`,
        [email]
      );
      if (blacklisted && blacklisted.count > 0) {
        return apiSuccess([]);
      }
    }

    if (hasPhone) {
      const blacklisted = await queryOne<{ count: number }>(
        `SELECT count(*)::int as count FROM sot.data_engine_soft_blacklist
         WHERE identifier_type = 'phone' AND identifier_norm = sot.norm_phone_us($1)`,
        [phone]
      );
      if (blacklisted && blacklisted.count > 0) {
        return apiSuccess([]);
      }
    }

    // Build the query conditions dynamically
    const conditions: string[] = [];
    const params: string[] = [];
    let paramIndex = 1;

    if (hasEmail) {
      conditions.push(`(pi.id_type = 'email' AND pi.id_value_norm = sot.norm_email($${paramIndex}))`);
      params.push(email!);
      paramIndex++;
    }
    if (hasPhone) {
      conditions.push(`(pi.id_type = 'phone' AND pi.id_value_norm = sot.norm_phone_us($${paramIndex}))`);
      params.push(phone!);
      paramIndex++;
    }

    const people = await queryRows<PersonRow>(
      `SELECT
        p.person_id,
        p.display_name,
        p.first_name,
        p.last_name,
        p.entity_type,
        (SELECT id_value_norm FROM sot.person_identifiers
         WHERE person_id = p.person_id AND id_type = 'email' AND confidence >= 0.5
         ORDER BY confidence DESC LIMIT 1) as email,
        (SELECT id_value_norm FROM sot.person_identifiers
         WHERE person_id = p.person_id AND id_type = 'phone' AND confidence >= 0.5
         ORDER BY confidence DESC LIMIT 1) as phone,
        (SELECT count(*)::int FROM sot.person_cat WHERE person_id = p.person_id) as cat_count,
        ${hasEmail ? `bool_or(pi.id_type = 'email' AND pi.id_value_norm = sot.norm_email($1))` : "false"} as matched_email,
        ${hasPhone ? `bool_or(pi.id_type = 'phone' AND pi.id_value_norm = sot.norm_phone_us($${hasEmail ? 2 : 1}))` : "false"} as matched_phone
      FROM sot.person_identifiers pi
      JOIN sot.people p ON p.person_id = pi.person_id
      WHERE pi.confidence >= 0.5
        AND p.merged_into_person_id IS NULL
        AND p.canonical = TRUE
        AND (${conditions.join(" OR ")})
      GROUP BY p.person_id, p.display_name, p.first_name, p.last_name, p.entity_type
      LIMIT 5`,
      params
    );

    if (people.length === 0) {
      return apiSuccess([]);
    }

    // Fetch addresses for matched people
    const personIds = people.map((p) => p.person_id);
    const addresses = await queryRows<AddressRow>(
      `SELECT
        pp.person_id,
        pl.place_id,
        pl.formatted_address,
        pp.relationship_type AS role
      FROM sot.person_place pp
      JOIN sot.places pl ON pl.place_id = pp.place_id
      WHERE pp.person_id = ANY($1)
        AND pl.merged_into_place_id IS NULL
      ORDER BY pp.confidence DESC NULLS LAST
      LIMIT 10`,
      [personIds]
    );

    // Group addresses by person
    const addressMap = new Map<string, AddressRow[]>();
    for (const addr of addresses) {
      const existing = addressMap.get(addr.person_id) || [];
      existing.push(addr);
      addressMap.set(addr.person_id, existing);
    }

    const results: PersonSuggestionResult[] = people.map((p) => ({
      person_id: p.person_id,
      display_name: p.display_name,
      first_name: p.first_name,
      last_name: p.last_name,
      entity_type: p.entity_type,
      email: p.email,
      phone: p.phone,
      cat_count: p.cat_count,
      match_type: p.matched_email && p.matched_phone
        ? "both"
        : p.matched_email
          ? "email"
          : "phone",
      addresses: (addressMap.get(p.person_id) || []).map((a) => ({
        place_id: a.place_id,
        formatted_address: a.formatted_address,
        role: a.role,
      })),
    }));

    return apiSuccess(results);
  } catch (error) {
    console.error("Error suggesting people:", error);
    return apiServerError("Failed to suggest people");
  }
}
