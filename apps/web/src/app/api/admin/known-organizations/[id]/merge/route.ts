import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface MergeResult {
  action: string;
  details: {
    message?: string;
    org_name?: string;
    duplicate_count?: number;
    person_ids?: string[];
    would_keep?: string;
    would_merge?: string[];
    canonical_person_id?: string;
    merged_count?: number;
  };
}

// POST - Merge duplicate person records for an organization
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const dryRun = body.dry_run !== false; // Default to dry run for safety

    // First get the org
    const org = await queryOne<{ canonical_name: string; short_name: string | null }>(
      `SELECT canonical_name, short_name FROM sot.known_organizations WHERE org_id = $1`,
      [id]
    );

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Call the merge function
    const results = await queryRows<MergeResult>(
      `SELECT * FROM sot.merge_organization_duplicates($1, $2)`,
      [org.canonical_name, dryRun]
    );

    // If not dry run, also try to create/link a canonical person if none exists
    if (!dryRun && results.some(r => r.action === "merged")) {
      // Refresh org data to get canonical_person_id
      const refreshedOrg = await queryOne<{
        canonical_person_id: string | null;
        canonical_name: string;
        phone: string | null;
        email: string | null;
      }>(
        `SELECT canonical_person_id, canonical_name, phone, email
         FROM sot.known_organizations WHERE org_id = $1`,
        [id]
      );

      // Log the merge to the organization_match_log
      if (refreshedOrg?.canonical_person_id) {
        await queryOne(
          `INSERT INTO ops.organization_match_log (
            org_id, matched_value, match_type, confidence, source_system, decision, person_id, notes
          ) VALUES ($1, $2, 'admin_merge', 1.0, 'admin_ui', 'linked', $3, 'Merged via admin UI')`,
          [id, org.canonical_name, refreshedOrg.canonical_person_id]
        );
      }
    }

    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      org_name: org.canonical_name,
      results,
    });
  } catch (error) {
    console.error("Error merging organization duplicates:", error);
    return NextResponse.json(
      { error: "Failed to merge organization duplicates" },
      { status: 500 }
    );
  }
}

// GET - Preview what would be merged (convenience endpoint)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Get the org
    const org = await queryOne<{ canonical_name: string; canonical_person_id: string | null }>(
      `SELECT canonical_name, canonical_person_id FROM sot.known_organizations WHERE org_id = $1`,
      [id]
    );

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Find matching person records (potential duplicates)
    const duplicates = await queryRows<{
      person_id: string;
      display_name: string;
      person_type: string;
      source_system: string;
      created_at: string;
      is_canonical: boolean;
    }>(
      `
      SELECT
        p.person_id,
        p.display_name,
        p.person_type,
        p.source_system,
        p.created_at,
        p.person_id = $2 AS is_canonical
      FROM sot.people p
      WHERE p.merged_into_person_id IS NULL
        AND (
          LOWER(p.display_name) ILIKE '%' || LOWER($1) || '%'
        )
      ORDER BY
        p.person_id = $2 DESC,  -- Canonical first
        p.created_at
      `,
      [org.canonical_name, org.canonical_person_id]
    );

    return NextResponse.json({
      org_id: id,
      org_name: org.canonical_name,
      canonical_person_id: org.canonical_person_id,
      duplicates,
      would_merge_count: duplicates.filter(d => !d.is_canonical).length,
    });
  } catch (error) {
    console.error("Error previewing merge:", error);
    return NextResponse.json(
      { error: "Failed to preview merge" },
      { status: 500 }
    );
  }
}
