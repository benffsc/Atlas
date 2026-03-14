"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";

interface PersonSearchResult {
  entity_id: string;
  display_name: string;
  subtitle: string;
}

export interface UsePersonSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  results: PersonSearchResult[];
  loading: boolean;
  hasSearched: boolean;
  clear: () => void;
}

const DEFAULT_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export function usePersonSearch(
  debounceMs: number = DEFAULT_DEBOUNCE_MS
): UsePersonSearchReturn {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    setQuery("");
    setResults([]);
    setHasSearched(false);
    setLoading(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  useEffect(() => {
    if (query.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setHasSearched(false);
      setLoading(false);
      return;
    }

    setLoading(true);

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const data = await fetchApi<{ results: PersonSearchResult[] }>(
          `/api/search?q=${encodeURIComponent(query)}&type=person&limit=8`,
          { signal: controller.signal }
        );
        if (!controller.signal.aborted) {
          setResults(data.results || []);
          setHasSearched(true);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          console.error("Person search failed:", err);
          setResults([]);
          setHasSearched(true);
          setLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, debounceMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { query, setQuery, results, loading, hasSearched, clear };
}
