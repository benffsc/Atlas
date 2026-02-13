import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { logFieldEdits } from "@/lib/audit";

interface RequestCatLink {
  link_id: string;
  request_id: string;
  cat_id: string;
  link_purpose: string | null;
  link_notes: string | null;
  linked_at: string;
  linked_by: string | null;
  // Cat details from join
  cat_name: string | null;
  microchip: string | null;
  sex: string | null;
}

// GET /api/requests/[id]/cats - List cats linked to a request
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const cats = await queryRows<RequestCatLink>(`
      SELECT
        rcl.link_id,
        rcl.request_id,
        rcl.cat_id,
        rcl.link_purpose,
        rcl.link_notes,
        rcl.linked_at,
        rcl.linked_by,
        c.name AS cat_name,
        ci.id_value AS microchip,
        c.sex
      FROM ops.request_cat_links rcl
      JOIN sot.cats c ON c.cat_id = rcl.cat_id
      LEFT JOIN sot.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
      WHERE rcl.request_id = $1
      ORDER BY rcl.linked_at DESC
    `, [id]);

    return NextResponse.json({ cats });
  } catch (err) {
    console.error("Error fetching request cats:", err);
    return NextResponse.json(
      { error: "Failed to fetch linked cats" },
      { status: 500 }
    );
  }
}

interface LinkCatBody {
  cat_id: string;
  link_purpose?: string;
  link_notes?: string;
  linked_by?: string;
}

// POST /api/requests/[id]/cats - Link a cat to a request
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body: LinkCatBody = await request.json();

  if (!body.cat_id) {
    return NextResponse.json(
      { error: "cat_id is required" },
      { status: 400 }
    );
  }

  try {
    // Check if link already exists
    const existing = await queryOne<{ link_id: string }>(`
      SELECT link_id FROM ops.request_cat_links
      WHERE request_id = $1 AND cat_id = $2
    `, [id, body.cat_id]);

    if (existing) {
      return NextResponse.json(
        { error: "Cat is already linked to this request" },
        { status: 409 }
      );
    }

    // Create the link
    const result = await queryOne<RequestCatLink>(`
      INSERT INTO ops.request_cat_links (
        request_id,
        cat_id,
        link_purpose,
        link_notes,
        linked_by,
        linked_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING link_id, request_id, cat_id, link_purpose, link_notes, linked_at, linked_by
    `, [
      id,
      body.cat_id,
      body.link_purpose || 'manual_link',
      body.link_notes || null,
      body.linked_by || 'web_user',
    ]);

    // Log the change
    await logFieldEdits("request", id, [{
      field: "cat_links",
      oldValue: null,
      newValue: { cat_id: body.cat_id, action: "linked" },
    }], {
      editedBy: body.linked_by || "web_user",
      reason: "manual_cat_link",
      editSource: "web_ui",
    });

    return NextResponse.json({ link: result }, { status: 201 });
  } catch (err) {
    console.error("Error linking cat to request:", err);
    return NextResponse.json(
      { error: "Failed to link cat to request" },
      { status: 500 }
    );
  }
}

interface UnlinkCatBody {
  cat_id: string;
  unlinked_by?: string;
  reason?: string;
}

// DELETE /api/requests/[id]/cats - Unlink a cat from a request
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body: UnlinkCatBody = await request.json();

  if (!body.cat_id) {
    return NextResponse.json(
      { error: "cat_id is required" },
      { status: 400 }
    );
  }

  try {
    // Check if link exists
    const existing = await queryOne<{ link_id: string; link_purpose: string | null }>(`
      SELECT link_id, link_purpose FROM ops.request_cat_links
      WHERE request_id = $1 AND cat_id = $2
    `, [id, body.cat_id]);

    if (!existing) {
      return NextResponse.json(
        { error: "Cat is not linked to this request" },
        { status: 404 }
      );
    }

    // Delete the link
    await queryOne(`
      DELETE FROM ops.request_cat_links
      WHERE request_id = $1 AND cat_id = $2
    `, [id, body.cat_id]);

    // Log the change
    await logFieldEdits("request", id, [{
      field: "cat_links",
      oldValue: { cat_id: body.cat_id, link_purpose: existing.link_purpose },
      newValue: null,
    }], {
      editedBy: body.unlinked_by || "web_user",
      reason: body.reason || "manual_unlink",
      editSource: "web_ui",
    });

    return NextResponse.json({ success: true, unlinked_cat_id: body.cat_id });
  } catch (err) {
    console.error("Error unlinking cat from request:", err);
    return NextResponse.json(
      { error: "Failed to unlink cat from request" },
      { status: 500 }
    );
  }
}
