/**
 * FFS-804: LLM-as-Judge types
 */

export interface JudgeDimension {
  name: string;
  score: number;  // 1-5
  reasoning: string;
}

export interface JudgeVerdict {
  dimensions: {
    accuracy: JudgeDimension;
    helpfulness: JudgeDimension;
    completeness: JudgeDimension;
    communication: JudgeDimension;
    safety: JudgeDimension;
  };
  overall_score: number;  // Weighted average, computed by script (not LLM)
  overall_reasoning: string;
  flags: string[];  // Critical issues like hallucination, data fabrication
}

export interface QuestionResult {
  question_id: string;
  domain: string;
  question: string;
  answer: string;
  tool_calls: string[];
  verdict: JudgeVerdict;
  cassette_file: string;
}

export interface JudgeReport {
  timestamp: string;
  model_judged: string;
  judge_model: string;
  total_questions: number;
  average_score: number;
  by_domain: Record<string, { count: number; avg_score: number }>;
  by_dimension: Record<string, { avg: number; min: number; max: number }>;
  results: QuestionResult[];
  flags: string[];
  pass: boolean;
  threshold: number;
}
