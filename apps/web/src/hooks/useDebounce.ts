import { useRef, useCallback, useEffect } from "react";

/**
 * Returns a stable debounced version of the given callback.
 * The debounced function delays invoking the callback until `delayMs`
 * milliseconds have elapsed since the last invocation.
 * Automatically cleans up pending timeouts on unmount.
 *
 * @example
 * ```tsx
 * const debouncedSearch = useDebounce((query: string) => {
 *   fetchResults(query);
 * }, 300);
 *
 * <input onChange={(e) => debouncedSearch(e.target.value)} />
 * ```
 */
export function useDebounce<T extends (...args: never[]) => void>(
  callback: T,
  delayMs: number = 300,
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const callbackRef = useRef(callback);

  // Keep callback ref fresh without re-creating the debounced function
  callbackRef.current = callback;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}

export default useDebounce;
