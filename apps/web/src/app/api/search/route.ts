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

interface IntakeResult {
  record_type: string;
  record_id: string;
  display_name: string;
  subtitle: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  submitted_at: string | null;
  status: string | null;
  score: number;
  metadata: Record<string, unknown>;
}

interface SubmissionResult {
  submission_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  cats_address: string | null;
  cats_city: string | null;
  status: string;
  triage_category: string | null;
  submitted_at: string;
  match_type: string;
}

interface RequestResult {
  request_id: string;
  display_name: string;
  status: string;
  priority: string;
  place_address: string | null;
  requester_name: string | null;
  estimated_cat_count: number | null;
  created_at: string;
  match_type: string;
}

// Grouped search result - multiple records with same display_name collapsed into one
interface GroupedResult {
  display_name: string;
  entity_type: string;
  records: SearchResult[];
  record_count: number;
  best_score: number;
  best_match_reason: string;
  best_match_strength: string;
  // Additional context for subtitle
  subtitles: string[];
}

/**
 * Group search results by display_name + entity_type
 * Shows one card per unique name with expandable records
 */
function groupResults(results: SearchResult[]): GroupedResult[] {
  const groups = new Map<string, GroupedResult>();

  for (const result of results) {
    // Key by lowercase name + type to group duplicates
    const key = `${result.entity_type}:${result.display_name.toLowerCase().trim()}`;

    if (!groups.has(key)) {
      groups.set(key, {
        display_name: result.display_name,
        entity_type: result.entity_type,
        records: [],
        record_count: 0,
        best_score: result.score,
        best_match_reason: result.match_reason,
        best_match_strength: result.match_strength,
        subtitles: [],
      });
    }

    const group = groups.get(key)!;
    group.records.push(result);
    group.record_count++;

    // Track unique subtitles for context
    if (result.subtitle && !group.subtitles.includes(result.subtitle)) {
      group.subtitles.push(result.subtitle);
    }

    // Keep track of best match
    if (result.score > group.best_score) {
      group.best_score = result.score;
      group.best_match_reason = result.match_reason;
      group.best_match_strength = result.match_strength;
    }
  }

  // Sort by best score descending
  return Array.from(groups.values()).sort((a, b) => b.best_score - a.best_score);
}

const STRONG_THRESHOLD = 5;  // If fewer than this many strong results, include possible matches

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const searchParams = request.nextUrl.searchParams;

  const rawQuery = searchParams.get("q");
  const entityType = searchParams.get("type");
  const mode = searchParams.get("mode") || "canonical";
  const limit = Math.min(parseInt(searchParams.get("limit") || "25", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const includePossible = searchParams.get("include_possible") !== "false";
  const includeIntake = searchParams.get("include_intake") !== "false";
  const suggestionsOnly = searchParams.get("suggestions") === "true";
  const includeGrouped = searchParams.get("grouped") !== "false"; // Default to true

  // Normalize query: trim whitespace, collapse multiple spaces
  const q = rawQuery?.trim().replace(/\s+/g, ' ') || "";

  if (!q || q.length === 0) {
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

    // Search intake records (unlinked appointment requests, trapping requests)
    let intakeResults: IntakeResult[] = [];
    if (includeIntake && !typeParam) {
      try {
        const intakeSql = `
          SELECT
            record_type,
            record_id,
            display_name,
            subtitle,
            address,
            phone,
            email,
            submitted_at,
            status,
            score,
            metadata
          FROM trapper.search_intake($1, $2)
        `;
        intakeResults = await queryRows<IntakeResult>(intakeSql, [q, 10]);
      } catch {
        // search_intake may not exist yet, ignore error
      }
    }

    // Search submissions (web_intake_submissions)
    let submissions: SubmissionResult[] = [];
    if (!typeParam || typeParam === "submission") {
      try {
        const submissionSql = `
          SELECT
            submission_id,
            COALESCE(first_name || ' ' || last_name, 'Unknown') as display_name,
            email,
            phone,
            cats_address,
            cats_city,
            status,
            triage_category,
            submitted_at,
            CASE
              WHEN LOWER(first_name || ' ' || last_name) = LOWER($1) THEN 'exact_name'
              WHEN email = LOWER($1) THEN 'exact_email'
              WHEN phone = $1 OR REPLACE(REPLACE(REPLACE(phone, '-', ''), '(', ''), ')', '') LIKE '%' || REPLACE(REPLACE(REPLACE($1, '-', ''), '(', ''), ')', '') || '%' THEN 'phone_match'
              WHEN LOWER(cats_address) ILIKE '%' || LOWER($1) || '%' THEN 'address_match'
              WHEN LOWER(first_name || ' ' || last_name) ILIKE '%' || LOWER($1) || '%' THEN 'fuzzy_name'
              WHEN LOWER(situation_description) ILIKE '%' || LOWER($1) || '%' THEN 'description_match'
              ELSE 'fuzzy'
            END as match_type
          FROM trapper.web_intake_submissions
          WHERE
            LOWER(first_name || ' ' || last_name) ILIKE '%' || LOWER($1) || '%'
            OR email ILIKE '%' || LOWER($1) || '%'
            OR phone LIKE '%' || $1 || '%'
            OR LOWER(cats_address) ILIKE '%' || LOWER($1) || '%'
            OR LOWER(situation_description) ILIKE '%' || LOWER($1) || '%'
          ORDER BY
            CASE
              WHEN LOWER(first_name || ' ' || last_name) = LOWER($1) THEN 1
              WHEN email = LOWER($1) THEN 2
              ELSE 3
            END,
            submitted_at DESC
          LIMIT 15
        `;
        submissions = await queryRows<SubmissionResult>(submissionSql, [q]);
      } catch (err) {
        console.error("Submission search error:", err);
      }
    }

    // Search requests (sot_requests) - exclude closed requests (completed, cancelled)
    let requests: RequestResult[] = [];
    if (!typeParam || typeParam === "request") {
      try {
        const requestSql = `
          SELECT
            r.request_id,
            COALESCE(r.summary, 'Request #' || LEFT(r.request_id::TEXT, 8)) as display_name,
            r.status::TEXT,
            r.priority::TEXT,
            p.formatted_address as place_address,
            per.display_name as requester_name,
            r.estimated_cat_count,
            r.created_at,
            CASE
              WHEN LOWER(COALESCE(r.summary, '')) ILIKE '%' || LOWER($1) || '%' THEN 'summary_match'
              WHEN LOWER(COALESCE(p.formatted_address, '')) ILIKE '%' || LOWER($1) || '%' THEN 'address_match'
              WHEN LOWER(COALESCE(per.display_name, '')) ILIKE '%' || LOWER($1) || '%' THEN 'requester_match'
              WHEN LOWER(COALESCE(r.notes, '')) ILIKE '%' || LOWER($1) || '%' THEN 'notes_match'
              ELSE 'fuzzy'
            END as match_type
          FROM trapper.sot_requests r
          LEFT JOIN trapper.places p ON r.place_id = p.place_id
          LEFT JOIN trapper.sot_people per ON r.requester_person_id = per.person_id
          WHERE
            r.status NOT IN ('completed', 'cancelled')
            AND (
              LOWER(COALESCE(r.summary, '')) ILIKE '%' || LOWER($1) || '%'
              OR LOWER(COALESCE(p.formatted_address, '')) ILIKE '%' || LOWER($1) || '%'
              OR LOWER(COALESCE(p.display_name, '')) ILIKE '%' || LOWER($1) || '%'
              OR LOWER(COALESCE(per.display_name, '')) ILIKE '%' || LOWER($1) || '%'
              OR LOWER(COALESCE(r.notes, '')) ILIKE '%' || LOWER($1) || '%'
              OR r.request_id::TEXT ILIKE '%' || $1 || '%'
            )
          ORDER BY
            -- Native Atlas requests first (web_intake, atlas_ui), then imported (airtable)
            CASE
              WHEN r.source_system IN ('web_intake', 'atlas_ui') THEN 0
              ELSE 1
            END,
            -- Then by status
            CASE r.status
              WHEN 'new' THEN 1
              WHEN 'triaged' THEN 2
              WHEN 'scheduled' THEN 3
              WHEN 'in_progress' THEN 4
              ELSE 5
            END,
            r.created_at DESC
          LIMIT 20
        `;
        requests = await queryRows<RequestResult>(requestSql, [q]);
      } catch (err) {
        console.error("Request search error:", err);
      }
    }

    // Group results by display_name if requested
    const mainResults = strongResults.length > 0 ? strongResults : results.slice(0, limit);
    const groupedResults = includeGrouped ? groupResults(mainResults) : [];
    const groupedPossible = includeGrouped && possibleMatches.length > 0
      ? groupResults(possibleMatches)
      : [];

    return NextResponse.json({
      query: q,
      mode: "canonical",
      suggestions,
      results: mainResults,
      grouped_results: groupedResults,
      possible_matches: possibleMatches,
      grouped_possible: groupedPossible,
      intake_records: intakeResults,
      submissions,
      requests,
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
