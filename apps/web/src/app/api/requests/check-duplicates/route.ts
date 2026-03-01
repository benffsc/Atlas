import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * POST /api/requests/check-duplicates
 *
 * Check for existing active requests that may be duplicates based on:
 * - Exact place match
 * - Same phone/email on requester
 * - Nearby address (within 100m)
 *
 * Used by the request creation form to warn staff before creating duplicates.
 */

interface CheckDuplicatesRequest {
  place_id?: string;
  phone?: string;
  email?: string;
  address_text?: string;
}

interface DuplicateMatch {
  request_id: string;
  summary: string | null;
  status: string;
  trapper_name: string | null;
  place_address: string | null;
  place_city: string | null;
  created_at: string;
  match_type: "exact_place" | "same_phone" | "same_email" | "nearby_address";
  distance_m: number | null;
}

export async function POST(request: NextRequest) {
  try {
    const body: CheckDuplicatesRequest = await request.json();
    const { place_id, phone, email, address_text } = body;

    // Must provide at least one search criterion
    if (!place_id && !phone && !email && !address_text) {
      return NextResponse.json(
        { error: "At least one of place_id, phone, email, or address_text is required" },
        { status: 400 }
      );
    }

    // Call the SQL function to find duplicates
    const result = await queryRows<DuplicateMatch>(
      `SELECT
        request_id::text,
        summary,
        status,
        trapper_name,
        place_address,
        place_city,
        created_at::text,
        match_type,
        distance_m
      FROM ops.find_duplicate_requests($1::uuid, $2::text, $3::text, $4::text)`,
      [place_id || null, phone || null, email || null, address_text || null]
    );

    // Also check if the phone/email matches an existing person
    // (useful for showing "this contact already exists" info)
    let matching_person: { person_id: string; display_name: string } | null = null;

    if (phone || email) {
      const personResult = await queryRows<{ person_id: string; display_name: string }>(
        `SELECT DISTINCT ON (p.person_id)
          p.person_id::text,
          p.display_name
        FROM sot.people p
        JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
        WHERE p.merged_into_person_id IS NULL
          AND pi.confidence >= 0.5
          AND (
            ($1::text IS NOT NULL AND pi.id_type = 'phone' AND pi.id_value_norm = sot.norm_phone_us($1))
            OR ($2::text IS NOT NULL AND pi.id_type = 'email' AND pi.id_value_norm = sot.norm_email($2))
          )
        ORDER BY p.person_id, p.created_at DESC
        LIMIT 1`,
        [phone || null, email || null]
      );

      if (personResult.length > 0) {
        matching_person = personResult[0];
      }
    }

    return NextResponse.json({
      active_requests: result,
      matching_person,
    });
  } catch (error) {
    console.error("Error checking for duplicate requests:", error);
    return NextResponse.json(
      { error: "Failed to check for duplicates" },
      { status: 500 }
    );
  }
}
