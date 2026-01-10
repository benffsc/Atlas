import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface SearchResult {
  entity_type: string;
  entity_id: string;
  display_name: string;
  subtitle: string | null;
  match_strength: string;
  match_reason: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface DeepSearchResult {
  source_table: string;
  source_row_id: string;
  match_field: string;
  match_value: string;
  snippet: Record<string, unknown>;
  score: number;
}

interface CountResult {
  entity_type: string;
  count: string;
  strong_count: string;
  medium_count: string;
  weak_count: string;
}

const STRONG_THRESHOLD = 5;  // If fewer than this many strong results, include possible matches

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const searchParams = request.nextUrl.searchParams;

  const q = searchParams.get("q");
  const entityType = searchParams.get("type");
  const mode = searchParams.get("mode") || "canonical";
  const limit = Math.min(parseInt(searchParams.get("limit") || "25", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const includePossible = searchParams.get("include_possible") !== "false";
  const suggestionsOnly = searchParams.get("suggestions") === "true";

  if (!q || q.trim().length === 0) {
    return NextResponse.json(
      { error: "Search query 'q' is required" },
      { status: 400 }
    );
  }

  try {
    // Deep search mode
    if (mode === "deep") {
      const deepSql = `
        SELECT
          source_table,
          source_row_id,
          match_field,
          match_value,
          snippet,
          score
        FROM trapper.search_deep($1, $2)
      `;

      const deepResults = await queryRows<DeepSearchResult>(deepSql, [q, limit]);

      return NextResponse.json({
        query: q,
        mode: "deep",
        results: deepResults,
        total: deepResults.length,
        limit,
        offset: 0,
        timing_ms: Date.now() - startTime,
      });
    }

    // Suggestions mode (for typeahead)
    if (suggestionsOnly) {
      const suggestionsSql = `
        SELECT
          entity_type,
          entity_id,
          display_name,
          subtitle,
          match_strength,
          match_reason,
          score,
          metadata
        FROM trapper.search_suggestions($1, $2)
      `;

      const suggestions = await queryRows<SearchResult>(suggestionsSql, [
        q,
        Math.min(limit, 10),
      ]);

      return NextResponse.json({
        query: q,
        mode: "canonical",
        suggestions,
        timing_ms: Date.now() - startTime,
      });
    }

    // Canonical search mode
    const typeParam = entityType && ["cat", "person", "place"].includes(entityType)
      ? entityType
      : null;

    // Get main results
    const searchSql = `
      SELECT
        entity_type,
        entity_id,
        display_name,
        subtitle,
        match_strength,
        match_reason,
        score,
        metadata
      FROM trapper.search_unified($1, $2, $3, $4)
    `;

    const results = await queryRows<SearchResult>(searchSql, [
      q,
      typeParam,
      limit,
      offset,
    ]);

    // Get counts for breakdown
    const countsSql = `
      SELECT
        entity_type,
        count,
        strong_count,
        medium_count,
        weak_count
      FROM trapper.search_unified_counts($1, $2)
    `;

    const countsResult = await queryRows<CountResult>(countsSql, [q, typeParam]);

    const countsByType: Record<string, number> = {};
    let totalStrong = 0;
    let totalCount = 0;

    for (const row of countsResult) {
      countsByType[row.entity_type] = parseInt(row.count, 10);
      totalStrong += parseInt(row.strong_count, 10);
      totalCount += parseInt(row.count, 10);
    }

    // Separate strong results from possible matches
    const strongResults = results.filter((r) => r.match_strength === "strong" || r.match_strength === "medium");
    const weakResults = results.filter((r) => r.match_strength === "weak");

    // Determine if we should include possible matches
    let possibleMatches: SearchResult[] = [];
    if (includePossible && strongResults.length < STRONG_THRESHOLD && weakResults.length > 0) {
      possibleMatches = weakResults;
    }

    // Get suggestions (top 8 for dropdown)
    const suggestionsSql = `
      SELECT
        entity_type,
        entity_id,
        display_name,
        subtitle,
        match_strength,
        match_reason,
        score,
        metadata
      FROM trapper.search_suggestions($1, 8)
    `;

    const suggestions = await queryRows<SearchResult>(suggestionsSql, [q]);

    return NextResponse.json({
      query: q,
      mode: "canonical",
      suggestions,
      results: strongResults.length > 0 ? strongResults : results.slice(0, limit),
      possible_matches: possibleMatches,
      counts_by_type: countsByType,
      total: totalCount,
      limit,
      offset,
      timing_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Error searching:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
