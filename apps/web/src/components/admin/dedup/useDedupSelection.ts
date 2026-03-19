import { useState, useCallback } from "react";

export function useDedupSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback((keys: string[]) => {
    setSelected((prev) => {
      if (prev.size === keys.length) return new Set();
      return new Set(keys);
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const removeFromSelection = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  return { selected, toggleSelect, selectAll, clearSelection, removeFromSelection };
}
