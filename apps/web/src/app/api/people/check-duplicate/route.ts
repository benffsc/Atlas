import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface SimilarPerson {
  person_id: string;
  display_name: string;
  similarity_score: number;
  match_type: string;
  matched_phone: string | null;
  matched_email: string | null;
}

/**
 * GET /api/people/check-duplicate
 *
 * Check for potential duplicate people when adding a new contact.
 * Uses fuzzy name matching, phone/email matching, and same-family detection.
 *
 * Query params:
 *   - name: Full name to search (required)
 *   - phone: Phone number (optional, for exact matching)
 *   - email: Email address (optional, for exact matching)
 *   - threshold: Similarity threshold 0-1 (optional, default 0.30)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const name = searchParams.get("name");
  const phone = searchParams.get("phone");
  const email = searchParams.get("email");
  const threshold = parseFloat(searchParams.get("threshold") || "0.30");

  if (!name || name.trim().length < 2) {
    return NextResponse.json(
      { error: "Name is required (minimum 2 characters)" },
      { status: 400 }
    );
  }

  try {
    const matches = await queryRows<SimilarPerson>(
      `SELECT * FROM sot.find_similar_people($1, $2, $3, $4)
       ORDER BY similarity_score DESC
       LIMIT 10`,
      [name.trim(), phone || null, email || null, threshold]
    );

    // Categorize by confidence
    const highConfidence = matches.filter(
      (m) => m.match_type === "exact_phone" || m.match_type === "exact_email" || m.similarity_score > 0.8
    );
    const mediumConfidence = matches.filter(
      (m) => !highConfidence.includes(m) && m.similarity_score >= 0.5
    );
    const lowConfidence = matches.filter(
      (m) => !highConfidence.includes(m) && !mediumConfidence.includes(m)
    );

    return NextResponse.json({
      query: { name, phone, email },
      total_matches: matches.length,
      high_confidence: highConfidence,
      medium_confidence: mediumConfidence,
      low_confidence: lowConfidence,
      // Primary suggestion (if any high confidence match)
      suggested_match: highConfidence.length > 0 ? highConfidence[0] : null,
    });
  } catch (error) {
    console.error("Error checking for duplicates:", error);
    return NextResponse.json(
      { error: "Failed to check for duplicates" },
      { status: 500 }
    );
  }
}
