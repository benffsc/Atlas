import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface KnowledgeArticle {
  article_id: string;
  title: string;
  slug: string;
  summary: string | null;
  content: string;
  category: string;
  access_level: string;
  keywords: string[] | null;
  tags: Record<string, unknown> | null;
  source_system: string | null;
  source_path: string | null;
  source_synced_at: string | null;
  is_published: boolean;
  created_by: string | null;
  created_by_name?: string | null;
  updated_by: string | null;
  updated_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/knowledge/[id]
 * Get a single knowledge article by ID or slug
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await getSession(request);

    // Determine user's access level
    const userAccessLevel = session?.auth_role === "admin" ? "admin" :
                            session?.auth_role === "staff" ? "staff" :
                            session?.auth_role === "volunteer" ? "volunteer" : "public";

    // Try to find by UUID or slug
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const article = await queryOne<KnowledgeArticle>(
      `
      SELECT
        ka.*,
        s1.display_name as created_by_name,
        s2.display_name as updated_by_name
      FROM sot.knowledge_articles ka
      LEFT JOIN ops.staff s1 ON s1.staff_id = ka.created_by
      LEFT JOIN ops.staff s2 ON s2.staff_id = ka.updated_by
      WHERE ${isUUID ? "ka.article_id = $1" : "ka.slug = $1"}
      `,
      [id]
    );

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    // Check access control
    const canAccess =
      userAccessLevel === "admin" ||
      article.access_level === "public" ||
      (userAccessLevel === "volunteer" && article.access_level === "volunteer") ||
      (userAccessLevel === "staff" && ["public", "volunteer", "staff"].includes(article.access_level));

    if (!canAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Non-admins can only see published articles
    if (!article.is_published && userAccessLevel !== "admin") {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    // Log usage for analytics (if authenticated)
    if (session) {
      await query(
        `
        INSERT INTO sot.knowledge_usage_log (article_id, staff_id, session_id)
        VALUES ($1, $2, $3)
        `,
        [article.article_id, session.staff_id, request.headers.get("x-session-id") || null]
      ).catch(() => {
        // Ignore logging errors
      });
    }

    return NextResponse.json({ article });
  } catch (error) {
    console.error("Knowledge fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch knowledge article" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/knowledge/[id]
 * Update a knowledge article (staff+ only)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session || (session.auth_role !== "admin" && session.auth_role !== "staff")) {
      return NextResponse.json({ error: "Staff access required" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    // Check article exists
    const existing = await queryOne<{ article_id: string }>(
      `SELECT article_id FROM sot.knowledge_articles WHERE article_id = $1 OR slug = $1`,
      [id]
    );

    if (!existing) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    // Build update
    const updates: string[] = [];
    const updateParams: (string | boolean | string[] | null)[] = [];
    let paramIndex = 1;

    const allowedFields = [
      "title", "slug", "summary", "content", "category",
      "access_level", "keywords", "tags", "is_published"
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === "tags") {
          updates.push(`${field} = $${paramIndex++}`);
          updateParams.push(body[field] ? JSON.stringify(body[field]) : null);
        } else {
          updates.push(`${field} = $${paramIndex++}`);
          updateParams.push(body[field]);
        }
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    // Add updated_by
    updates.push(`updated_by = $${paramIndex++}`);
    updateParams.push(session.staff_id);

    updates.push(`updated_at = NOW()`);

    // Check for slug conflict if slug is being updated
    if (body.slug) {
      const slugConflict = await queryOne<{ article_id: string }>(
        `SELECT article_id FROM sot.knowledge_articles WHERE slug = $1 AND article_id != $2`,
        [body.slug, existing.article_id]
      );

      if (slugConflict) {
        return NextResponse.json(
          { error: "Another article already uses this slug" },
          { status: 409 }
        );
      }
    }

    await query(
      `UPDATE sot.knowledge_articles SET ${updates.join(", ")} WHERE article_id = $${paramIndex}`,
      [...updateParams, existing.article_id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Knowledge update error:", error);
    return NextResponse.json(
      { error: "Failed to update knowledge article" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/knowledge/[id]
 * Delete a knowledge article (admin only)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession(request);
    if (!session || session.auth_role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;

    // Check article exists
    const existing = await queryOne<{ article_id: string }>(
      `SELECT article_id FROM sot.knowledge_articles WHERE article_id = $1 OR slug = $1`,
      [id]
    );

    if (!existing) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    // Delete usage logs first (foreign key)
    await query(
      `DELETE FROM sot.knowledge_usage_log WHERE article_id = $1`,
      [existing.article_id]
    );

    // Delete article
    await query(
      `DELETE FROM sot.knowledge_articles WHERE article_id = $1`,
      [existing.article_id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Knowledge delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete knowledge article" },
      { status: 500 }
    );
  }
}
