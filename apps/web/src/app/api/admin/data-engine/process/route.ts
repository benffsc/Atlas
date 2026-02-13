import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Data Engine Processing API
 *
 * GET: Return current processing stats and registered processors
 * POST: Process a batch of records through the unified data engine
 *
 * Supports all registered processors from data_engine_processors table.
 */

interface DataEngineStats {
  total_decisions: number;
  auto_matched: number;
  new_entities: number;
  reviews_pending: number;
  total_staged: number;
  remaining: number;
}

interface ProcessorInfo {
  processor_name: string;
  source_system: string;
  source_table: string;
  entity_type: string;
  is_active: boolean;
}

interface UnifiedBatchResult {
  processed: number;
  success: number;
  errors: number;
  processors_used: string[];
}

// Legacy batch result for backwards compatibility
interface BatchResult {
  processed: number;
  auto_matched: number;
  new_entities: number;
  reviews_created: number;
  household_members: number;
  rejected: number;
  errors: number;
  duration_ms: number;
}

// GET: Return current stats and registered processors
export async function GET() {
  try {
    const stats = await queryOne<{
      total_decisions: string;
      auto_matched: string;
      new_entities: string;
      reviews_pending: string;
      total_staged: string;
      remaining: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions) as total_decisions,
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'auto_match') as auto_matched,
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'new_entity') as new_entities,
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'review_needed' AND reviewed_at IS NULL) as reviews_pending,
        (SELECT COUNT(*) FROM ops.staged_records) as total_staged,
        (SELECT COUNT(*) FROM ops.staged_records sr WHERE NOT is_processed) as remaining
    `, []);

    const result: DataEngineStats = {
      total_decisions: parseInt(stats?.total_decisions || "0"),
      auto_matched: parseInt(stats?.auto_matched || "0"),
      new_entities: parseInt(stats?.new_entities || "0"),
      reviews_pending: parseInt(stats?.reviews_pending || "0"),
      total_staged: parseInt(stats?.total_staged || "0"),
      remaining: parseInt(stats?.remaining || "0"),
    };

    // Get registered processors (table may not exist in all environments)
    let processors: ProcessorInfo[] = [];
    try {
      processors = await queryRows<ProcessorInfo>(`
        SELECT
          processor_name,
          source_system,
          source_table,
          entity_type,
          is_active
        FROM sot.data_engine_processors
        ORDER BY priority, processor_name
      `, []) || [];
    } catch {
      // Table doesn't exist, use empty array
    }

    // Get pending counts per source
    const pendingBySource = await queryRows<{
      source_system: string;
      source_table: string;
      pending: string;
    }>(`
      SELECT
        source_system,
        source_table,
        COUNT(*) as pending
      FROM ops.staged_records
      WHERE NOT is_processed
      GROUP BY source_system, source_table
      ORDER BY pending DESC
    `, []);

    return NextResponse.json({
      stats: result,
      processors: processors || [],
      pending_by_source: pendingBySource || [],
    });
  } catch (error) {
    console.error("Error fetching Data Engine stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}

// POST: Process a batch through the unified data engine
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(body.limit || 100, 500); // Max 500 per batch
    const sourceSystem = body.source_system || body.source || null;
    const sourceTable = body.source_table || null;
    const useUnified = body.unified !== false; // Default to unified processor

    // Try the new unified processor first
    if (useUnified) {
      try {
        const unifiedResult = await queryOne<{
          processed: string;
          success: string;
          errors: string;
        }>(`
          SELECT * FROM sot.data_engine_process_batch_unified($1, $2, $3)
        `, [sourceSystem, sourceTable, limit]);

        if (unifiedResult && parseInt(unifiedResult.processed || "0") > 0) {
          // Get updated stats
          const statsResult = await queryOne<{
            total_decisions: string;
            auto_matched: string;
            new_entities: string;
            reviews_pending: string;
            total_staged: string;
            remaining: string;
          }>(`
            SELECT
              (SELECT COUNT(*) FROM sot.data_engine_match_decisions) as total_decisions,
              (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'auto_match') as auto_matched,
              (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'new_entity') as new_entities,
              (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'review_needed' AND reviewed_at IS NULL) as reviews_pending,
              (SELECT COUNT(*) FROM ops.staged_records) as total_staged,
              (SELECT COUNT(*) FROM ops.staged_records sr WHERE NOT is_processed) as remaining
          `, []);

          const stats: DataEngineStats = {
            total_decisions: parseInt(statsResult?.total_decisions || "0"),
            auto_matched: parseInt(statsResult?.auto_matched || "0"),
            new_entities: parseInt(statsResult?.new_entities || "0"),
            reviews_pending: parseInt(statsResult?.reviews_pending || "0"),
            total_staged: parseInt(statsResult?.total_staged || "0"),
            remaining: parseInt(statsResult?.remaining || "0"),
          };

          return NextResponse.json({
            success: true,
            result: {
              processed: parseInt(unifiedResult.processed || "0"),
              success: parseInt(unifiedResult.success || "0"),
              errors: parseInt(unifiedResult.errors || "0"),
            },
            stats,
            processor: "unified",
            message: `Processed ${unifiedResult.processed} records` +
              (sourceSystem ? ` from ${sourceSystem}` : "") +
              (sourceTable ? `/${sourceTable}` : ""),
          });
        }
      } catch (unifiedError) {
        // Unified processor not available or failed, fall back to legacy
        console.warn("Unified processor not available, falling back to legacy:", unifiedError);
      }
    }

    // Fall back to legacy processor for backwards compatibility
    const source = sourceSystem || "clinichq";
    const validSources = ["clinichq", "airtable", "web_intake", "shelterluv", "volunteerhub", "petlink"];
    if (!validSources.includes(source)) {
      return NextResponse.json(
        { error: `Invalid source. Must be one of: ${validSources.join(", ")}` },
        { status: 400 }
      );
    }

    // Process batch using the legacy data_engine_process_batch function
    const result = await queryOne<{
      processed: string;
      auto_matched: string;
      new_entities: string;
      reviews_created: string;
      household_members: string;
      rejected: string;
      errors: string;
      duration_ms: string;
    }>(`
      SELECT (r).* FROM (
        SELECT sot.data_engine_process_batch($1, NULL, $2, NULL) as r
      ) sub
    `, [source, limit]);

    if (!result) {
      return NextResponse.json(
        { error: "No result from processing" },
        { status: 500 }
      );
    }

    const batchResult: BatchResult = {
      processed: parseInt(result.processed || "0"),
      auto_matched: parseInt(result.auto_matched || "0"),
      new_entities: parseInt(result.new_entities || "0"),
      reviews_created: parseInt(result.reviews_created || "0"),
      household_members: parseInt(result.household_members || "0"),
      rejected: parseInt(result.rejected || "0"),
      errors: parseInt(result.errors || "0"),
      duration_ms: parseInt(result.duration_ms || "0"),
    };

    // Get updated stats
    const statsResult = await queryOne<{
      total_decisions: string;
      auto_matched: string;
      new_entities: string;
      reviews_pending: string;
      total_staged: string;
      remaining: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions) as total_decisions,
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'auto_match') as auto_matched,
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'new_entity') as new_entities,
        (SELECT COUNT(*) FROM sot.data_engine_match_decisions WHERE decision_type = 'review_needed' AND reviewed_at IS NULL) as reviews_pending,
        (SELECT COUNT(*) FROM ops.staged_records) as total_staged,
        (SELECT COUNT(*) FROM ops.staged_records sr WHERE NOT is_processed) as remaining
    `, []);

    const stats: DataEngineStats = {
      total_decisions: parseInt(statsResult?.total_decisions || "0"),
      auto_matched: parseInt(statsResult?.auto_matched || "0"),
      new_entities: parseInt(statsResult?.new_entities || "0"),
      reviews_pending: parseInt(statsResult?.reviews_pending || "0"),
      total_staged: parseInt(statsResult?.total_staged || "0"),
      remaining: parseInt(statsResult?.remaining || "0"),
    };

    return NextResponse.json({
      success: true,
      result: batchResult,
      stats,
      processor: "legacy",
      message: `Processed ${batchResult.processed} records from ${source}`,
    });
  } catch (error) {
    console.error("Error processing Data Engine batch:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Processing failed",
        success: false,
      },
      { status: 500 }
    );
  }
}
