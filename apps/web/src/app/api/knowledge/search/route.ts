import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface SearchResult {
  article_id: string;
  title: string;
  slug: string;
  summary: string | null;
  category: string;
  relevance: number;
}

/**
 * GET /api/knowledge/search
 * Full-text search of knowledge base using PostgreSQL function
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    const { searchParams } = new URL(request.url);

    const queryText = searchParams.get("q");
    const category = searchParams.get("category");
    const limit = parseInt(searchParams.get("limit") || "10");

    if (!queryText || queryText.trim().length < 2) {
      return NextResponse.json(
        { error: "Query must be at least 2 characters" },
        { status: 400 }
      );
    }

    // Determine user's access level
    const userAccessLevel = session?.auth_role === "admin" ? "admin" :
                            session?.auth_role === "staff" ? "staff" :
                            session?.auth_role === "volunteer" ? "volunteer" : "public";

    // Use the database search function
    const results = await queryRows<SearchResult>(
      `SELECT * FROM trapper.search_knowledge($1, $2, $3, $4)`,
      [queryText, userAccessLevel, category || null, limit]
    );

    // Log the search for analytics (if authenticated)
    if (session && results.length > 0) {
      const topResultId = results[0].article_id;
      await query(
        `
        INSERT INTO trapper.knowledge_usage_log (article_id, query, relevance_score, staff_id, session_id)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [topResultId, queryText, results[0].relevance, session.staff_id, request.headers.get("x-session-id") || null]
      ).catch(() => {
        // Ignore logging errors
      });
    }

    return NextResponse.json({
      query: queryText,
      results,
      count: results.length,
    });
  } catch (error) {
    console.error("Knowledge search error:", error);
    return NextResponse.json(
      { error: "Failed to search knowledge base" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/knowledge/search
 * Alternative POST method for Tippy tool use
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    const body = await request.json();

    const { query: queryText, category, limit } = body;

    if (!queryText || queryText.trim().length < 2) {
      return NextResponse.json(
        { error: "Query must be at least 2 characters" },
        { status: 400 }
      );
    }

    // Determine user's access level
    const userAccessLevel = session?.auth_role === "admin" ? "admin" :
                            session?.auth_role === "staff" ? "staff" :
                            session?.auth_role === "volunteer" ? "volunteer" : "public";

    // Use the database search function
    const results = await queryRows<SearchResult>(
      `SELECT * FROM trapper.search_knowledge($1, $2, $3, $4)`,
      [queryText, userAccessLevel, category || null, limit || 10]
    );

    // For Tippy tool use, also return full content of top results
    const enrichedResults = [];
    for (const result of results.slice(0, 3)) {
      const fullArticle = await queryRows<{ content: string }>(
        `SELECT content FROM trapper.knowledge_articles WHERE article_id = $1`,
        [result.article_id]
      );
      enrichedResults.push({
        ...result,
        content: fullArticle[0]?.content || "",
      });
    }

    // Log the search for analytics (if authenticated)
    if (session && results.length > 0) {
      const topResultId = results[0].article_id;
      await query(
        `
        INSERT INTO trapper.knowledge_usage_log (article_id, query, relevance_score, staff_id, session_id)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [topResultId, queryText, results[0].relevance, session.staff_id, request.headers.get("x-tippy-session") || null]
      ).catch(() => {
        // Ignore logging errors
      });
    }

    return NextResponse.json({
      query: queryText,
      results: enrichedResults,
      count: results.length,
    });
  } catch (error) {
    console.error("Knowledge search error:", error);
    return NextResponse.json(
      { error: "Failed to search knowledge base" },
      { status: 500 }
    );
  }
}
