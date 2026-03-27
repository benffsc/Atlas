import { ReactNode } from "react";

export interface DedupTab {
  value: string;
  label: string;
  color: string;
}

export interface DedupAction {
  key: string;
  label: string;
  batchLabel: string;
  color: string;
  showInBatch?: boolean;
}

export interface DedupHeaderAction {
  key: string;
  label: string;
  loadingLabel: string;
  color: string;
  confirmMessage?: string;
  /** Only show when this filter value is active */
  showWhenFilter?: string;
  /** Handler may return a string to show as a success toast */
  handler: () => Promise<string | void>;
}

export interface DedupConfig<C> {
  entityName: string;
  apiPath: string;
  description: string;

  tabs: DedupTab[];
  filterParamName: string;
  defaultFilterValue: string;
  summaryGroupKey: string;

  getPairKey: (c: C) => string;
  getSinglePayload: (c: C, action: string) => Record<string, unknown>;
  getBatchPairPayload: (key: string, candidates: C[]) => Record<string, unknown>;

  actions: DedupAction[];
  headerActions?: DedupHeaderAction[];

  renderCanonical: (c: C) => ReactNode;
  renderDuplicate: (c: C) => ReactNode;
  renderCenter: (c: C) => ReactNode;
  renderHeaderMeta?: (c: C) => ReactNode;

  getTierValue: (c: C) => string;

  /** Extra summary cards beyond the standard per-tier ones */
  renderExtraSummary?: (data: BaseDedupResponse<C>) => ReactNode;
}

export interface DedupSummaryItem {
  pair_count: number;
  [key: string]: unknown;
}

export interface BaseDedupResponse<C> {
  candidates: C[];
  summary: DedupSummaryItem[];
  pagination: { hasMore: boolean; [key: string]: unknown };
  note?: string;
  [key: string]: unknown;
}
