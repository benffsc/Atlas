import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

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
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/knowledge
 * List knowledge articles with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    const { searchParams } = new URL(request.url);

    const category = searchParams.get("category");
    const accessLevel = searchParams.get("access_level");
    const isPublished = searchParams.get("is_published");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Determine user's access level
    const userAccessLevel = session?.auth_role === "admin" ? "admin" :
                            session?.auth_role === "staff" ? "staff" :
                            session?.auth_role === "volunteer" ? "volunteer" : "public";

    // Build query
    const conditions: string[] = [];
    const params: (string | number | boolean)[] = [];
    let paramIndex = 1;

    // Access control - only show articles user can access
    if (userAccessLevel === "public") {
      conditions.push(`ka.access_level = 'public'`);
    } else if (userAccessLevel === "volunteer") {
      conditions.push(`ka.access_level IN ('public', 'volunteer')`);
    } else if (userAccessLevel === "staff") {
      conditions.push(`ka.access_level IN ('public', 'volunteer', 'staff')`);
    }
    // Admin can see everything

    // Optional filters
    if (category) {
      conditions.push(`ka.category = $${paramIndex++}`);
      params.push(category);
    }

    if (accessLevel && userAccessLevel === "admin") {
      conditions.push(`ka.access_level = $${paramIndex++}`);
      params.push(accessLevel);
    }

    if (isPublished !== null && isPublished !== undefined) {
      conditions.push(`ka.is_published = $${paramIndex++}`);
      params.push(isPublished === "true");
    } else if (userAccessLevel !== "admin") {
      // Non-admins only see published
      conditions.push(`ka.is_published = TRUE`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const articles = await queryRows<KnowledgeArticle>(
      `
      SELECT
        ka.*,
        s1.display_name as created_by_name,
        s2.display_name as updated_by_name
      FROM trapper.knowledge_articles ka
      LEFT JOIN trapper.staff s1 ON s1.staff_id = ka.created_by
      LEFT JOIN trapper.staff s2 ON s2.staff_id = ka.updated_by
      ${whereClause}
      ORDER BY ka.updated_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
      `,
      [...params, limit, offset]
    );

    // Get category counts
    const counts = await queryRows<{ category: string; count: number }>(
      `
      SELECT category, COUNT(*)::INT as count
      FROM trapper.knowledge_articles
      WHERE is_published = TRUE
      GROUP BY category
      ORDER BY category
      `
    );

    return NextResponse.json({
      articles,
      category_counts: counts,
      pagination: {
        limit,
        offset,
        hasMore: articles.length === limit,
      },
    });
  } catch (error) {
    console.error("Knowledge list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch knowledge articles" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/knowledge
 * Create a new knowledge article (staff+ only)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session || (session.auth_role !== "admin" && session.auth_role !== "staff")) {
      return NextResponse.json({ error: "Staff access required" }, { status: 403 });
    }

    const body = await request.json();
    const {
      title,
      slug,
      summary,
      content,
      category,
      access_level,
      keywords,
      tags,
      is_published,
    } = body;

    // Validate required fields
    if (!title || !content || !category) {
      return NextResponse.json(
        { error: "title, content, and category are required" },
        { status: 400 }
      );
    }

    // Generate slug if not provided
    const finalSlug = slug || title.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-");

    // Check for duplicate slug
    const existing = await queryOne<{ article_id: string }>(
      `SELECT article_id FROM trapper.knowledge_articles WHERE slug = $1`,
      [finalSlug]
    );

    if (existing) {
      return NextResponse.json(
        { error: "An article with this slug already exists" },
        { status: 409 }
      );
    }

    // Validate category
    const validCategories = ["procedures", "training", "faq", "troubleshooting", "talking_points", "equipment", "policy"];
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${validCategories.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate access_level
    const validAccessLevels = ["public", "staff", "admin", "volunteer"];
    const finalAccessLevel = access_level || "staff";
    if (!validAccessLevels.includes(finalAccessLevel)) {
      return NextResponse.json(
        { error: `Invalid access_level. Must be one of: ${validAccessLevels.join(", ")}` },
        { status: 400 }
      );
    }

    // Create article
    const article = await queryOne<{ article_id: string; slug: string; created_at: string }>(
      `
      INSERT INTO trapper.knowledge_articles (
        title, slug, summary, content, category, access_level,
        keywords, tags, is_published, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
      RETURNING article_id, slug, created_at
      `,
      [
        title,
        finalSlug,
        summary || null,
        content,
        category,
        finalAccessLevel,
        keywords || null,
        tags ? JSON.stringify(tags) : null,
        is_published !== false, // Default to published
        session.staff_id,
      ]
    );

    if (!article) {
      return NextResponse.json(
        { error: "Failed to create article" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      article_id: article.article_id,
      slug: article.slug,
    });
  } catch (error) {
    console.error("Knowledge create error:", error);
    return NextResponse.json(
      { error: "Failed to create knowledge article" },
      { status: 500 }
    );
  }
}
