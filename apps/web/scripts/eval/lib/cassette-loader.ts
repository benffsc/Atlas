/**
 * FFS-804: Load and parse VCR cassettes
 */
import * as fs from "fs";
import * as path from "path";

interface CassetteMessage {
  role: "user" | "assistant";
  content: string;
  tool_calls?: Array<{ name: string; input: Record<string, unknown> }>;
  tool_results?: Array<{ tool_use_id: string; content: string }>;
}

export interface Cassette {
  file: string;
  domain: string;
  question_id: string;
  question: string;
  messages: CassetteMessage[];
  final_answer: string;
  tool_calls_used: string[];
}

const CASSETTE_DIR = path.resolve(__dirname, "../../../e2e/cassettes");

export function loadCassettes(filterDomain?: string): Cassette[] {
  if (!fs.existsSync(CASSETTE_DIR)) {
    return [];
  }

  const files = fs.readdirSync(CASSETTE_DIR).filter(f => f.endsWith(".json"));
  if (files.length === 0) return [];

  const cassettes: Cassette[] = [];

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(CASSETTE_DIR, file), "utf-8"));
      const cassette = parseCassette(file, raw);
      if (cassette && (!filterDomain || cassette.domain === filterDomain)) {
        cassettes.push(cassette);
      }
    } catch (e) {
      console.warn(`Warning: Could not parse cassette ${file}: ${e}`);
    }
  }

  return cassettes;
}

function parseCassette(file: string, raw: Record<string, unknown>): Cassette | null {
  const messages = (raw.messages || raw.interactions || []) as CassetteMessage[];
  const metadata = (raw.metadata || {}) as Record<string, string>;

  // Find the user question and final assistant answer
  const userMessages = messages.filter(m => m.role === "user");
  const assistantMessages = messages.filter(m => m.role === "assistant");

  if (userMessages.length === 0 || assistantMessages.length === 0) {
    return null;
  }

  const question = typeof userMessages[0].content === "string"
    ? userMessages[0].content
    : JSON.stringify(userMessages[0].content);

  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  const finalAnswer = typeof lastAssistant.content === "string"
    ? lastAssistant.content
    : JSON.stringify(lastAssistant.content);

  const toolCalls = messages
    .flatMap(m => m.tool_calls || [])
    .map(tc => tc.name);

  return {
    file,
    domain: metadata.domain || inferDomain(question),
    question_id: metadata.question_id || file.replace(".json", ""),
    question,
    messages,
    final_answer: finalAnswer,
    tool_calls_used: [...new Set(toolCalls)],
  };
}

function inferDomain(question: string): string {
  const q = question.toLowerCase();
  if (/voicemail|call|phone|callback/i.test(q)) return "voicemail_triage";
  if (/disease|fiv|felv|positive/i.test(q)) return "disease";
  if (/strategic|focus|priorit|resource/i.test(q)) return "strategic_analysis";
  if (/colony|alteration|altered/i.test(q)) return "colony_status";
  if (/region|county|city|area/i.test(q)) return "regional";
  return "general";
}
