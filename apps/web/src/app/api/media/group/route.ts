import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

interface PhotoGroup {
  collection_id: string;
  request_id: string;
  group_name: string;
  group_description: string | null;
  created_by: string;
  created_at: string;
  photo_count: number;
  media_ids: string[];
  storage_paths: string[];
  cat_description: string | null;
  max_confidence: string | null;
  cat_id: string | null;
}

// GET /api/media/group - List photo groups for a request
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const requestId = searchParams.get("request_id");

    if (!requestId) {
      return NextResponse.json(
        { error: "request_id is required" },
        { status: 400 }
      );
    }

    // Verify request exists
    const requestExists = await queryOne<{ request_id: string }>(
      "SELECT request_id FROM ops.requests WHERE request_id = $1",
      [requestId]
    );

    if (!requestExists) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    // Get photo groups for this request
    const groups = await queryRows<PhotoGroup>(
      `SELECT
        collection_id,
        request_id,
        group_name,
        group_description,
        created_by,
        created_at,
        COALESCE(photo_count, 0)::int AS photo_count,
        COALESCE(media_ids, '{}') AS media_ids,
        COALESCE(storage_paths, '{}') AS storage_paths,
        cat_description,
        max_confidence,
        cat_id
      FROM ops.v_request_photo_groups
      WHERE request_id = $1
      ORDER BY created_at DESC`,
      [requestId]
    );

    return NextResponse.json({
      request_id: requestId,
      groups,
      total: groups.length,
    });
  } catch (error) {
    console.error("Error fetching photo groups:", error);
    return NextResponse.json(
      { error: "Failed to fetch photo groups" },
      { status: 500 }
    );
  }
}

// POST /api/media/group - Create a new photo group
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { request_id, name, description, media_ids, created_by = "app_user" } = body;

    if (!request_id) {
      return NextResponse.json(
        { error: "request_id is required" },
        { status: 400 }
      );
    }

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    // Verify request exists
    const requestExists = await queryOne<{ request_id: string }>(
      "SELECT request_id FROM ops.requests WHERE request_id = $1",
      [request_id]
    );

    if (!requestExists) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    // Create the photo group using the database function
    const result = await queryOne<{ create_photo_group: string }>(
      `SELECT trapper.create_photo_group($1, $2, $3, $4, $5) AS create_photo_group`,
      [
        request_id,
        name,
        created_by,
        media_ids && media_ids.length > 0 ? media_ids : null,
        description || null,
      ]
    );

    if (!result?.create_photo_group) {
      return NextResponse.json(
        { error: "Failed to create photo group" },
        { status: 500 }
      );
    }

    // Fetch the created group details
    const group = await queryOne<PhotoGroup>(
      `SELECT
        collection_id,
        request_id,
        group_name,
        group_description,
        created_by,
        created_at,
        COALESCE(photo_count, 0)::int AS photo_count,
        COALESCE(media_ids, '{}') AS media_ids,
        COALESCE(storage_paths, '{}') AS storage_paths,
        cat_description,
        max_confidence,
        cat_id
      FROM ops.v_request_photo_groups
      WHERE collection_id = $1`,
      [result.create_photo_group]
    );

    return NextResponse.json({
      success: true,
      collection_id: result.create_photo_group,
      group,
    });
  } catch (error) {
    console.error("Error creating photo group:", error);
    return NextResponse.json(
      { error: "Failed to create photo group" },
      { status: 500 }
    );
  }
}

// PATCH /api/media/group - Update a photo group (add/remove media, rename)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { collection_id, name, description, add_media_ids, remove_media_ids } = body;

    if (!collection_id) {
      return NextResponse.json(
        { error: "collection_id is required" },
        { status: 400 }
      );
    }

    // Verify group exists
    const groupExists = await queryOne<{ collection_id: string }>(
      "SELECT collection_id FROM ops.media_collections WHERE collection_id = $1",
      [collection_id]
    );

    if (!groupExists) {
      return NextResponse.json(
        { error: "Photo group not found" },
        { status: 404 }
      );
    }

    // Update group name/description if provided
    if (name !== undefined || description !== undefined) {
      const updateFields: string[] = [];
      const updateValues: (string | null)[] = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updateFields.push(`name = $${paramIndex}`);
        updateValues.push(name);
        paramIndex++;
      }

      if (description !== undefined) {
        updateFields.push(`description = $${paramIndex}`);
        updateValues.push(description);
        paramIndex++;
      }

      updateValues.push(collection_id);

      await queryOne(
        `UPDATE ops.media_collections
         SET ${updateFields.join(", ")}
         WHERE collection_id = $${paramIndex}`,
        updateValues
      );
    }

    // Add media to group
    if (add_media_ids && add_media_ids.length > 0) {
      await queryOne(
        `SELECT trapper.assign_photos_to_group($1, $2)`,
        [collection_id, add_media_ids]
      );
    }

    // Remove media from group
    if (remove_media_ids && remove_media_ids.length > 0) {
      await queryOne(
        `UPDATE ops.request_media
         SET photo_group_id = NULL
         WHERE media_id = ANY($1) AND photo_group_id = $2`,
        [remove_media_ids, collection_id]
      );
    }

    // Fetch updated group
    const group = await queryOne<PhotoGroup>(
      `SELECT
        collection_id,
        request_id,
        group_name,
        group_description,
        created_by,
        created_at,
        COALESCE(photo_count, 0)::int AS photo_count,
        COALESCE(media_ids, '{}') AS media_ids,
        COALESCE(storage_paths, '{}') AS storage_paths,
        cat_description,
        max_confidence,
        cat_id
      FROM ops.v_request_photo_groups
      WHERE collection_id = $1`,
      [collection_id]
    );

    return NextResponse.json({
      success: true,
      group,
    });
  } catch (error) {
    console.error("Error updating photo group:", error);
    return NextResponse.json(
      { error: "Failed to update photo group" },
      { status: 500 }
    );
  }
}

// DELETE /api/media/group - Delete a photo group (keeps media, just removes grouping)
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const collectionId = searchParams.get("collection_id");

    if (!collectionId) {
      return NextResponse.json(
        { error: "collection_id is required" },
        { status: 400 }
      );
    }

    // First, unlink all media from this group
    await queryOne(
      `UPDATE ops.request_media
       SET photo_group_id = NULL
       WHERE photo_group_id = $1`,
      [collectionId]
    );

    // Then delete the collection
    const result = await queryOne<{ collection_id: string }>(
      `DELETE FROM ops.media_collections
       WHERE collection_id = $1
       RETURNING collection_id`,
      [collectionId]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Photo group not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      deleted_collection_id: collectionId,
    });
  } catch (error) {
    console.error("Error deleting photo group:", error);
    return NextResponse.json(
      { error: "Failed to delete photo group" },
      { status: 500 }
    );
  }
}
