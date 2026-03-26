/**
 * FFS-804: LLM-as-Judge client — sends cassettes to Haiku for scoring
 */
import Anthropic from "@anthropic-ai/sdk";
import { SCORING_ANCHORS } from "./rubrics";
import type { JudgeVerdict, JudgeDimension } from "./types";

const JUDGE_MODEL = "claude-haiku-4-5-20251001";

export async function judgeCassette(
  client: Anthropic,
  question: string,
  answer: string,
  toolCalls: string[],
  domain: string
): Promise<JudgeVerdict> {
  const anchorsText = Object.entries(SCORING_ANCHORS)
    .map(([dim, levels]) =>
      `${dim}:\n${Object.entries(levels).map(([score, desc]) => `  ${score}: ${desc}`).join("\n")}`
    )
    .join("\n\n");

  const prompt = `You are a quality evaluator for an AI assistant called Tippy that helps TNR (Trap-Neuter-Return) staff manage cat colonies in Sonoma County.

Score the following response on 5 dimensions (1-5 each). Use the scoring anchors below.

SCORING ANCHORS:
${anchorsText}

CONTEXT:
- Domain: ${domain}
- Tools called: ${toolCalls.length > 0 ? toolCalls.join(", ") : "none"}

QUESTION:
${question}

ANSWER:
${answer}

Respond with ONLY a JSON object inside <json> tags. No other text.

<json>
{
  "accuracy": { "score": N, "reasoning": "..." },
  "helpfulness": { "score": N, "reasoning": "..." },
  "completeness": { "score": N, "reasoning": "..." },
  "communication": { "score": N, "reasoning": "..." },
  "safety": { "score": N, "reasoning": "..." },
  "overall_reasoning": "One sentence summary",
  "flags": ["list any critical issues like hallucination, or empty array"]
}
</json>`;

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("");

  // Extract JSON from <json> tags
  const jsonMatch = text.match(/<json>([\s\S]*?)<\/json>/);
  if (!jsonMatch) {
    throw new Error(`Failed to extract JSON from judge response: ${text.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[1].trim());

  const makeDimension = (key: string): JudgeDimension => ({
    name: key,
    score: Math.max(1, Math.min(5, parsed[key]?.score ?? 3)),
    reasoning: parsed[key]?.reasoning ?? "",
  });

  return {
    dimensions: {
      accuracy: makeDimension("accuracy"),
      helpfulness: makeDimension("helpfulness"),
      completeness: makeDimension("completeness"),
      communication: makeDimension("communication"),
      safety: makeDimension("safety"),
    },
    overall_score: 0, // Computed by caller
    overall_reasoning: parsed.overall_reasoning || "",
    flags: parsed.flags || [],
  };
}
