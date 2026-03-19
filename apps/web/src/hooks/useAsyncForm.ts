"use client";

import { useState, useCallback } from "react";

interface UseAsyncFormOptions<TResult = unknown> {
  /** Async function to execute on submit */
  onSubmit: () => Promise<TResult>;
  /** Called after successful submit with the result */
  onSuccess?: (result: TResult) => void;
  /** Called after failed submit with the error */
  onError?: (error: Error) => void;
}

interface UseAsyncFormResult {
  /** Whether the form is currently submitting */
  loading: boolean;
  /** Error message from the last failed submission, or null */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
  /** Submit handler — wraps onSubmit with loading/error state management */
  handleSubmit: () => Promise<void>;
}

/**
 * Hook for managing async form submission with loading/error state.
 *
 * Encapsulates the common pattern of: loading state, error state,
 * try/catch/finally, and error clearing.
 *
 * @example
 * const { loading, error, clearError, handleSubmit } = useAsyncForm({
 *   onSubmit: async () => {
 *     const res = await fetch('/api/requests/' + id, { method: 'PATCH', body: ... });
 *     if (!res.ok) throw new Error('Failed');
 *     return res.json();
 *   },
 *   onSuccess: () => {
 *     onClose();
 *     onComplete?.();
 *   },
 * });
 */
export function useAsyncForm<TResult = unknown>(
  options: UseAsyncFormOptions<TResult>
): UseAsyncFormResult {
  const { onSubmit, onSuccess, onError } = options;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const handleSubmit = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await onSubmit();
      onSuccess?.(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
      onError?.(err instanceof Error ? err : new Error(message));
    } finally {
      setLoading(false);
    }
  }, [onSubmit, onSuccess, onError]);

  return { loading, error, clearError, handleSubmit };
}
