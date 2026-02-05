import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

interface EmailCheckResult {
  exists: boolean;
  person?: {
    person_id: string;
    display_name: string;
  };
  normalizedEmail: string;
}

interface PersonRow {
  person_id: string;
  display_name: string;
}

/**
 * GET /api/people/check-email?email=...
 *
 * Checks if an email address already exists in the database.
 * Uses normalized email matching (lowercase, strips +tags for Gmail, etc.)
 *
 * Returns:
 * - exists: true if the email belongs to an existing person
 * - person: the person info if found
 * - normalizedEmail: the normalized version of the input email
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const email = searchParams.get("email");

  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "Valid email parameter required" },
      { status: 400 }
    );
  }

  try {
    // Check if email exists in person_identifiers
    const result = await queryOne<PersonRow & { normalized_email: string }>(
      `SELECT
        p.person_id,
        p.display_name,
        trapper.norm_email($1) as normalized_email
      FROM trapper.person_identifiers pi
      JOIN trapper.sot_people p ON p.person_id = pi.person_id
      WHERE pi.id_type = 'email'
        AND pi.id_value_norm = trapper.norm_email($1)
        AND pi.confidence >= 0.5
        AND p.merged_into_person_id IS NULL
      LIMIT 1`,
      [email]
    );

    if (result) {
      // Email exists
      return NextResponse.json({
        exists: true,
        person: {
          person_id: result.person_id,
          display_name: result.display_name,
        },
        normalizedEmail: result.normalized_email,
      } as EmailCheckResult);
    }

    // Email doesn't exist - get normalized form anyway
    const normResult = await queryOne<{ normalized: string }>(
      `SELECT trapper.norm_email($1) as normalized`,
      [email]
    );

    return NextResponse.json({
      exists: false,
      normalizedEmail: normResult?.normalized || email.toLowerCase(),
    } as EmailCheckResult);
  } catch (error) {
    console.error("Error checking email:", error);
    return NextResponse.json(
      { error: "Failed to check email" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/people/check-email
 *
 * Checks both email and phone in one request.
 * More efficient for form validation.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, phone } = body;

    const results: {
      email?: EmailCheckResult;
      phone?: {
        exists: boolean;
        person?: { person_id: string; display_name: string };
        normalizedPhone: string;
      };
    } = {};

    // Check email if provided
    if (email && email.includes("@")) {
      const emailResult = await queryOne<PersonRow & { normalized_email: string }>(
        `SELECT
          p.person_id,
          p.display_name,
          trapper.norm_email($1) as normalized_email
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email'
          AND pi.id_value_norm = trapper.norm_email($1)
          AND pi.confidence >= 0.5
          AND p.merged_into_person_id IS NULL
        LIMIT 1`,
        [email]
      );

      if (emailResult) {
        results.email = {
          exists: true,
          person: {
            person_id: emailResult.person_id,
            display_name: emailResult.display_name,
          },
          normalizedEmail: emailResult.normalized_email,
        };
      } else {
        const normResult = await queryOne<{ normalized: string }>(
          `SELECT trapper.norm_email($1) as normalized`,
          [email]
        );
        results.email = {
          exists: false,
          normalizedEmail: normResult?.normalized || email.toLowerCase(),
        };
      }
    }

    // Check phone if provided
    if (phone && phone.replace(/\D/g, "").length >= 10) {
      const phoneResult = await queryOne<PersonRow & { normalized_phone: string }>(
        `SELECT
          p.person_id,
          p.display_name,
          trapper.norm_phone_us($1) as normalized_phone
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'phone'
          AND pi.id_value_norm = trapper.norm_phone_us($1)
          AND pi.confidence >= 0.5
          AND p.merged_into_person_id IS NULL
        LIMIT 1`,
        [phone]
      );

      if (phoneResult) {
        results.phone = {
          exists: true,
          person: {
            person_id: phoneResult.person_id,
            display_name: phoneResult.display_name,
          },
          normalizedPhone: phoneResult.normalized_phone,
        };
      } else {
        const normResult = await queryOne<{ normalized: string }>(
          `SELECT trapper.norm_phone_us($1) as normalized`,
          [phone]
        );
        results.phone = {
          exists: false,
          normalizedPhone: normResult?.normalized || phone.replace(/\D/g, ""),
        };
      }
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error("Error checking contacts:", error);
    return NextResponse.json(
      { error: "Failed to check contacts" },
      { status: 500 }
    );
  }
}
