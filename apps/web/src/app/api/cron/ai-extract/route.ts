import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, execute } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

/**
 * AI Extraction Cron Job
 * ======================
 *
 * Processes the extraction queue to extract structured attributes from
 * unstructured text (request notes, clinic notes, etc.)
 *
 * Architecture:
 * - extraction_queue: Records pending processing (from MIG_712)
 * - extraction_status: Tracks what's been processed
 * - entity_attributes: Stores extracted attributes (from MIG_710)
 *
 * Run: Daily at 4 AM PT
 * Weekly: Sunday - also queues stale records for refresh
 *
 * Cost: ~$0.0005 per record (Haiku)
 */

export const maxDuration = 120; // Allow up to 2 minutes

const CRON_SECRET = process.env.CRON_SECRET;
const MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 15; // Process up to 15 records per run (within 2 min)

interface ExtractionResult {
  attribute_key: string;
  value: boolean | string | number;
  confidence: number;
  evidence: string;
}

interface AttributeDefinition {
  attribute_key: string;
  entity_type: string;
  data_type: string;
  description: string;
  enum_values: string[] | null;
  extraction_keywords: string[] | null;
  priority: number;
}

interface QueueItem {
  queue_id: string;
  source_table: string;
  source_record_id: string;
  entity_type: string;
  entity_id: string;
  trigger_reason: string;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const results = {
    queue_processed: 0,
    extractions_saved: 0,
    weekly_queued: 0,
    errors: [] as string[],
  };

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Load attribute definitions
    const attrDefResult = await query(`
      SELECT attribute_key, entity_type, data_type, description,
             enum_values, extraction_keywords, priority
      FROM trapper.entity_attribute_definitions
      ORDER BY entity_type, priority
    `);
    const attributeDefs = attrDefResult.rows as AttributeDefinition[];

    // ============================================================
    // 1. Process Extraction Queue
    // ============================================================

    const queueResult = await query(`
      SELECT
        eq.queue_id,
        eq.source_table,
        eq.source_record_id,
        eq.entity_type,
        eq.entity_id,
        eq.trigger_reason
      FROM trapper.extraction_queue eq
      WHERE eq.completed_at IS NULL
        AND eq.processing_started_at IS NULL
      ORDER BY eq.priority, eq.queued_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `, [BATCH_SIZE]);

    // Mark as processing
    if (queueResult.rows.length > 0) {
      const queueIds = queueResult.rows.map(r => r.queue_id);
      await execute(`
        UPDATE trapper.extraction_queue
        SET processing_started_at = NOW()
        WHERE queue_id = ANY($1)
      `, [queueIds]);
    }

    for (const row of queueResult.rows) {
      const queueItem = row as unknown as QueueItem;
      try {
        const extracted = await processQueueItem(
          anthropic,
          queueItem,
          attributeDefs
        );

        // Mark complete
        await execute(`
          UPDATE trapper.extraction_queue
          SET completed_at = NOW()
          WHERE queue_id = $1
        `, [queueItem.queue_id]);

        results.queue_processed++;
        results.extractions_saved += extracted;

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        results.errors.push(`${queueItem.source_table}/${queueItem.source_record_id}: ${errorMsg}`);

        // Mark with error
        await execute(`
          UPDATE trapper.extraction_queue
          SET error_message = $2, completed_at = NOW()
          WHERE queue_id = $1
        `, [queueItem.queue_id, errorMsg]);
      }
    }

    // ============================================================
    // 2. Weekly Refresh (Sunday only)
    // ============================================================

    const isWeeklyRun = new Date().getDay() === 0; // Sunday
    if (isWeeklyRun) {
      try {
        const refreshResult = await queryOne<{ queued: number }>(`
          SELECT trapper.queue_weekly_extraction_refresh(7, 500) as queued
        `);
        results.weekly_queued = refreshResult?.queued || 0;
      } catch (err) {
        results.errors.push(`Weekly refresh: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    // ============================================================
    // 3. Log run
    // ============================================================

    try {
      await execute(`
        INSERT INTO trapper.ingest_runs (
          source_system,
          run_type,
          started_at,
          completed_at,
          records_processed,
          records_created,
          status,
          notes
        ) VALUES (
          'ai_extract_cron',
          'incremental',
          NOW() - INTERVAL '${Date.now() - startTime} milliseconds',
          NOW(),
          $1,
          $2,
          'completed',
          $3
        )
      `, [
        results.queue_processed,
        results.extractions_saved,
        `Processed: ${results.queue_processed}, Extractions: ${results.extractions_saved}, Weekly queued: ${results.weekly_queued}`,
      ]);
    } catch {
      // Table may not exist - ignore
    }

    return NextResponse.json({
      success: true,
      ...results,
      duration_ms: Date.now() - startTime,
      message: `Processed ${results.queue_processed} items, saved ${results.extractions_saved} attributes`,
    });

  } catch (error) {
    console.error("AI extract cron error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      ...results,
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}

/**
 * Process a single queue item
 */
async function processQueueItem(
  anthropic: Anthropic,
  queueItem: QueueItem,
  attributeDefs: AttributeDefinition[]
): Promise<number> {
  // Fetch text to extract from based on source table
  let text = "";
  let entityId = queueItem.entity_id;
  let placeId: string | null = null;
  let personId: string | null = null;

  if (queueItem.source_table === "sot_requests") {
    const request = await queryOne<{
      summary: string;
      notes: string;
      internal_notes: string;
      hold_reason_notes: string;
      place_id: string;
      requester_person_id: string;
    }>(`
      SELECT summary, notes, internal_notes, hold_reason_notes,
             place_id, requester_person_id
      FROM trapper.sot_requests
      WHERE request_id = $1
    `, [queueItem.source_record_id]);

    if (!request) return 0;

    text = [
      request.summary,
      request.notes,
      request.internal_notes,
      request.hold_reason_notes,
    ].filter(Boolean).join("\n\n---\n\n");

    placeId = request.place_id;
    personId = request.requester_person_id;

  } else if (queueItem.source_table === "sot_appointments") {
    const appt = await queryOne<{
      medical_notes: string;
      cat_id: string;
    }>(`
      SELECT medical_notes, cat_id
      FROM trapper.sot_appointments
      WHERE appointment_id = $1
    `, [queueItem.source_record_id]);

    if (!appt || !appt.medical_notes) return 0;
    text = appt.medical_notes;
    entityId = appt.cat_id;

  } else if (queueItem.source_table === "sot_people") {
    const person = await queryOne<{
      notes: string;
    }>(`
      SELECT notes
      FROM trapper.sot_people
      WHERE person_id = $1
    `, [queueItem.source_record_id]);

    if (!person || !person.notes) return 0;
    text = person.notes;

  } else if (queueItem.source_table === "places") {
    const place = await queryOne<{
      notes: string;
    }>(`
      SELECT notes
      FROM trapper.places
      WHERE place_id = $1
    `, [queueItem.source_record_id]);

    if (!place || !place.notes) return 0;
    text = place.notes;
  }

  if (!text || text.trim().length < 10) {
    return 0;
  }

  // Build extraction prompt
  const relevantDefs = attributeDefs.filter(d => d.entity_type === queueItem.entity_type);
  const systemPrompt = buildExtractionPrompt(relevantDefs, queueItem.entity_type);

  // Call Claude
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `${systemPrompt}\n\n## Text to Analyze\n\n${text}\n\nExtract all relevant ${queueItem.entity_type} attributes from this text.`,
      },
    ],
  });

  // Parse response
  const content = response.content[0];
  if (content.type !== "text") return 0;

  let extractions: ExtractionResult[] = [];
  try {
    const parsed = JSON.parse(content.text);
    extractions = parsed.extractions || [];
  } catch {
    // Try to extract JSON from markdown code block
    const jsonMatch = content.text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        extractions = parsed.extractions || [];
      } catch {
        return 0;
      }
    }
  }

  // Save extractions
  let saved = 0;
  for (const ext of extractions) {
    if (!ext.attribute_key || ext.value === null || ext.value === undefined) continue;

    const attrDef = attributeDefs.find(d => d.attribute_key === ext.attribute_key);
    if (!attrDef) continue;

    // Determine target entity
    let targetEntityId = entityId;
    if (attrDef.entity_type === "place" && placeId) {
      targetEntityId = placeId;
    } else if (attrDef.entity_type === "person" && personId) {
      targetEntityId = personId;
    }

    // Supersede existing attribute
    await execute(`
      UPDATE trapper.entity_attributes
      SET superseded_at = NOW(), superseded_by = 'ai_extract_cron'
      WHERE entity_type = $1
        AND entity_id = $2
        AND attribute_key = $3
        AND superseded_at IS NULL
    `, [attrDef.entity_type, targetEntityId, ext.attribute_key]);

    // Insert new attribute
    await execute(`
      INSERT INTO trapper.entity_attributes (
        entity_type,
        entity_id,
        attribute_key,
        value_boolean,
        value_text,
        value_numeric,
        confidence,
        source_type,
        source_system,
        source_record_id,
        extracted_from_text,
        extraction_evidence
      ) VALUES (
        $1, $2, $3,
        CASE WHEN $4 = 'boolean' THEN $5::boolean ELSE NULL END,
        CASE WHEN $4 IN ('text', 'enum') THEN $6::text ELSE NULL END,
        CASE WHEN $4 = 'number' THEN $7::numeric ELSE NULL END,
        $8, 'ai_extracted', $9, $10, $11, $12
      )
    `, [
      attrDef.entity_type,
      targetEntityId,
      ext.attribute_key,
      attrDef.data_type,
      attrDef.data_type === "boolean" ? ext.value : null,
      ["text", "enum"].includes(attrDef.data_type) ? String(ext.value) : null,
      attrDef.data_type === "number" ? ext.value : null,
      ext.confidence,
      queueItem.source_table,
      queueItem.source_record_id,
      text.substring(0, 500),
      ext.evidence,
    ]);

    saved++;
  }

  // Update extraction status
  const textHash = simpleHash(text);
  await execute(`
    INSERT INTO trapper.extraction_status (
      source_table, source_record_id, last_extracted_at,
      extraction_hash, attributes_extracted
    ) VALUES ($1, $2, NOW(), $3, $4)
    ON CONFLICT (source_table, source_record_id)
    DO UPDATE SET
      last_extracted_at = NOW(),
      extraction_hash = $3,
      attributes_extracted = $4,
      needs_reextraction = FALSE
  `, [queueItem.source_table, queueItem.source_record_id, textHash, saved]);

  return saved;
}

/**
 * Build extraction prompt for entity type
 */
function buildExtractionPrompt(
  attributeDefs: AttributeDefinition[],
  entityType: string
): string {
  const attributeDescriptions = attributeDefs
    .map((a) => {
      let desc = `- **${a.attribute_key}** (${a.data_type}): ${a.description}`;
      if (a.enum_values) {
        desc += `\n  Valid values: ${a.enum_values.join(", ")}`;
      }
      if (a.extraction_keywords?.length) {
        desc += `\n  Keywords: ${a.extraction_keywords.join(", ")}`;
      }
      return desc;
    })
    .join("\n");

  return `You are an AI assistant helping a cat TNR (Trap-Neuter-Return) organization extract structured data from their historical records.

## Your Task
Analyze the provided text and extract relevant attributes about a ${entityType}.

## Context
This is operational data from Forgotten Felines of Sonoma County (FFSC), a TNR organization in Sonoma County, California.

## Attributes to Extract
${attributeDescriptions}

## Rules
1. Only extract attributes you're confident about from the text
2. For boolean attributes, only set to true if clearly indicated
3. For enum attributes, pick the closest match or skip if uncertain
4. For numbers, extract the most specific number mentioned
5. Return null for attributes not clearly present in text
6. Set confidence (0.0-1.0) based on how explicit the evidence is:
   - 1.0: Explicitly stated ("FeLV positive", "5 kittens found")
   - 0.8: Strongly implied ("sick cats", "babies")
   - 0.6: Somewhat implied (context suggests it)
   - 0.4: Weak signal (vague reference)

## Output Format
Return ONLY valid JSON with this structure:
{
  "extractions": [
    {
      "attribute_key": "string",
      "value": <boolean|string|number>,
      "confidence": 0.0-1.0,
      "evidence": "exact text that led to this extraction"
    }
  ],
  "reasoning": "brief explanation of what was found"
}

If nothing can be extracted, return: {"extractions": [], "reasoning": "No relevant information found"}`;
}

/**
 * Simple hash function for text comparison
 */
function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}
