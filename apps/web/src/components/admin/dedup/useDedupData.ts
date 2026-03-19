import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import type { DedupConfig, BaseDedupResponse } from "./types";

export function useDedupData<C>(config: DedupConfig<C>) {
  const [data, setData] = useState<BaseDedupResponse<C> | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(config.defaultFilterValue);
  const [offset, setOffset] = useState(0);
  const [resolving, setResolving] = useState<string | null>(null);
  const [batchAction, setBatchAction] = useState(false);
  const { error: toastError } = useToast();

  const limit = 30;

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchApi<BaseDedupResponse<C>>(
        `${config.apiPath}?${config.filterParamName}=${filter}&limit=${limit}&offset=${offset}`
      );
      setData(result);
    } catch (err) {
      console.error(`Failed to fetch ${config.entityName} dedup candidates:`, err);
    } finally {
      setLoading(false);
    }
  }, [config.apiPath, config.filterParamName, config.entityName, filter, offset]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  useEffect(() => {
    setOffset(0);
  }, [filter]);

  const handleResolve = useCallback(
    async (candidate: C, action: string, onRemoveFromSelection?: (key: string) => void) => {
      const key = config.getPairKey(candidate);
      setResolving(key);
      try {
        await postApi(config.apiPath, {
          ...config.getSinglePayload(candidate, action),
          action,
        });
        fetchCandidates();
        onRemoveFromSelection?.(key);
      } catch (err) {
        toastError(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      } finally {
        setResolving(null);
      }
    },
    [config, fetchCandidates, toastError]
  );

  const handleBatchResolve = useCallback(
    async (
      action: string,
      selectedKeys: Set<string>,
      candidates: C[],
      onClearSelection: () => void
    ) => {
      if (!selectedKeys.size) return;

      const actionLabel = config.actions.find((a) => a.key === action)?.batchLabel || action;
      if (!confirm(`${actionLabel} ${selectedKeys.size} selected pair(s)?`)) return;

      setBatchAction(true);
      const pairs = Array.from(selectedKeys).map((key) =>
        config.getBatchPairPayload(key, candidates)
      );

      try {
        const result = await postApi<{
          success: number;
          errors: number;
          results: Array<{ success: boolean; error?: string }>;
        }>(config.apiPath, { action, pairs });
        if (result.errors > 0) {
          const failed = result.results
            .filter((r) => !r.success)
            .map((r) => r.error)
            .join(", ");
          alert(`${result.success} succeeded, ${result.errors} failed: ${failed}`);
        }
        onClearSelection();
        fetchCandidates();
      } catch (err) {
        console.error("Batch resolve failed:", err);
      } finally {
        setBatchAction(false);
      }
    },
    [config, fetchCandidates]
  );

  const totalPairs = data?.summary.reduce((sum, s) => sum + s.pair_count, 0) || 0;

  return {
    data,
    loading,
    filter,
    setFilter,
    offset,
    setOffset,
    limit,
    resolving,
    batchAction,
    fetchCandidates,
    handleResolve,
    handleBatchResolve,
    totalPairs,
  };
}
