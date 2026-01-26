/**
 * Shared Attribute Extraction Utilities
 *
 * Provides core functions for AI-powered attribute extraction from text.
 * Used by source-specific extraction scripts.
 */

import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

// Read and parse .env file
function loadEnvFile() {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const envPath = path.join(__dirname, "../../../.env");
    const envContent = fs.readFileSync(envPath, "utf-8");
    const envVars = {};
    for (const line of envContent.split("\n")) {
      if (line.startsWith("#") || !line.includes("=")) continue;
      const [key, ...valueParts] = line.split("=");
      let value = valueParts.join("=").trim();
      // Remove surrounding quotes
      if ((value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      envVars[key.trim()] = value;
    }
    return envVars;
  } catch (e) {
    return {};
  }
}

const envFile = loadEnvFile();

// Get env var with fallback to .env file
function getEnvVar(key) {
  return process.env[key] || envFile[key];
}

// Initialize clients
const anthropic = new Anthropic({ apiKey: getEnvVar("ANTHROPIC_API_KEY") });
const pool = new Pool({ connectionString: getEnvVar("DATABASE_URL") });

/**
 * Fetch attribute definitions from database
 */
export async function getAttributeDefinitions(entityType = null) {
  const query = entityType
    ? `SELECT * FROM trapper.entity_attribute_definitions WHERE entity_type = $1 ORDER BY priority`
    : `SELECT * FROM trapper.entity_attribute_definitions ORDER BY entity_type, priority`;

  const result = await pool.query(query, entityType ? [entityType] : []);
  return result.rows;
}

/**
 * Build extraction prompt for a specific entity type
 */
export function buildExtractionPrompt(attributeDefs, entityType, context = {}) {
  const attributes = attributeDefs.filter((a) => a.entity_type === entityType);

  const attributeDescriptions = attributes
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
${context.description || "This is operational data from a TNR organization in Sonoma County, California."}

## Attributes to Extract
${attributeDescriptions}

## Rules
1. Only extract attributes you're confident about from the text
2. For boolean attributes, only set to true if clearly indicated
3. For enum attributes, pick the closest match or "unknown"
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
 * Call Claude to extract attributes from text
 */
export async function extractAttributes(
  text,
  entityType,
  attributeDefs,
  options = {}
) {
  const { model = "claude-haiku-4-5-20251001", context = {} } = options;

  if (!text || text.trim().length < 10) {
    return { extractions: [], reasoning: "Text too short", cost: 0 };
  }

  const systemPrompt = buildExtractionPrompt(attributeDefs, entityType, context);
  const userPrompt = `## Text to Analyze

${text}

Extract all relevant ${entityType} attributes from this text.`;

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      messages: [
        { role: "user", content: systemPrompt + "\n\n" + userPrompt },
      ],
    });

    const responseText = response.content[0].text;

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("No JSON found in response:", responseText.slice(0, 200));
      return { extractions: [], reasoning: "Failed to parse response", cost: 0 };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Estimate cost (Haiku pricing)
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost =
      model.includes("haiku")
        ? inputTokens * 0.00000025 + outputTokens * 0.00000125
        : inputTokens * 0.000003 + outputTokens * 0.000015;

    return {
      extractions: parsed.extractions || [],
      reasoning: parsed.reasoning || "",
      cost,
      tokens: { input: inputTokens, output: outputTokens },
    };
  } catch (error) {
    console.error("Extraction error:", error.message);
    return { extractions: [], reasoning: `Error: ${error.message}`, cost: 0 };
  }
}

// Cache of valid attribute keys
let validAttributeKeys = null;

async function getValidAttributeKeys() {
  if (validAttributeKeys) return validAttributeKeys;
  const result = await pool.query(
    `SELECT attribute_key FROM trapper.entity_attribute_definitions`
  );
  validAttributeKeys = new Set(result.rows.map((r) => r.attribute_key));
  return validAttributeKeys;
}

/**
 * Save extracted attributes to database
 */
export async function saveAttributes(
  entityType,
  entityId,
  extractions,
  sourceInfo
) {
  const client = await pool.connect();
  let savedCount = 0;

  // Get valid keys and filter extractions
  const validKeys = await getValidAttributeKeys();

  try {
    await client.query("BEGIN");

    for (const extraction of extractions) {
      // Skip invalid attribute keys (AI sometimes invents new ones)
      if (!validKeys.has(extraction.attribute_key)) {
        console.warn(`Skipping unknown attribute: ${extraction.attribute_key}`);
        continue;
      }

      // Format value based on type
      let value;
      if (typeof extraction.value === "boolean") {
        value = extraction.value;
      } else if (typeof extraction.value === "number") {
        value = extraction.value;
      } else if (typeof extraction.value === "string") {
        value = { value: extraction.value };
      } else {
        value = extraction.value;
      }

      await client.query(
        `SELECT trapper.set_entity_attribute($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          entityType,
          entityId,
          extraction.attribute_key,
          JSON.stringify(value),
          extraction.confidence,
          "ai_extracted",
          extraction.evidence,
          sourceInfo.source_system,
          sourceInfo.source_record_id,
          sourceInfo.extracted_by || "claude_haiku",
        ]
      );
      savedCount++;
    }

    await client.query("COMMIT");
    return savedCount;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Log extraction job metadata
 */
export async function logExtractionJob(jobData) {
  const result = await pool.query(
    `INSERT INTO trapper.attribute_extraction_jobs
     (source_system, entity_type, batch_size, records_processed, records_with_extractions,
      attributes_extracted, model_used, cost_estimate_usd, completed_at, error_message, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10)
     RETURNING job_id`,
    [
      jobData.source_system,
      jobData.entity_type,
      jobData.batch_size,
      jobData.records_processed,
      jobData.records_with_extractions,
      jobData.attributes_extracted,
      jobData.model_used,
      jobData.cost_estimate_usd,
      jobData.error_message,
      jobData.notes,
    ]
  );
  return result.rows[0].job_id;
}

/**
 * Check if text contains any extraction keywords
 */
export function hasExtractionKeywords(text, attributeDefs) {
  const lowerText = text.toLowerCase();
  for (const attr of attributeDefs) {
    if (attr.extraction_keywords) {
      for (const keyword of attr.extraction_keywords) {
        if (lowerText.includes(keyword.toLowerCase())) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Get priority keywords (for high-priority attributes only)
 */
export function getPriorityKeywords(attributeDefs, maxPriority = 20) {
  const priorityAttrs = attributeDefs.filter((a) => a.priority <= maxPriority);
  const keywords = new Set();
  for (const attr of priorityAttrs) {
    if (attr.extraction_keywords) {
      for (const kw of attr.extraction_keywords) {
        keywords.add(kw.toLowerCase());
      }
    }
  }
  return Array.from(keywords);
}

export { pool };
