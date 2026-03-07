"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { postApi } from "@/lib/api-client";
import type { PersonSuggestionResult } from "@/app/api/people/suggest/route";

export type { PersonSuggestionResult };

interface UsePersonSuggestionOptions {
  email: string;
  phone: string;
  enabled?: boolean;
}

interface UsePersonSuggestionReturn {
  suggestions: PersonSuggestionResult[];
  loading: boolean;
  dismissed: boolean;
  dismiss: () => void;
  reset: () => void;
  selectPerson: (person: PersonSuggestionResult) => void;
  selectedPerson: PersonSuggestionResult | null;
}

const DEBOUNCE_MS = 500;

function hasValidEmail(email: string): boolean {
  return email.includes("@");
}

function hasValidPhone(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 7;
}

export function usePersonSuggestion({
  email,
  phone,
  enabled = true,
}: UsePersonSuggestionOptions): UsePersonSuggestionReturn {
  const [suggestions, setSuggestions] = useState<PersonSuggestionResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<PersonSuggestionResult | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const prevInputRef = useRef<string>("");

  const dismiss = useCallback(() => setDismissed(true), []);
  const reset = useCallback(() => {
    setDismissed(false);
    setSelectedPerson(null);
  }, []);

  const selectPerson = useCallback((person: PersonSuggestionResult) => {
    setSelectedPerson(person);
    setSuggestions([]);
  }, []);

  useEffect(() => {
    // Build a stable input key to detect changes
    const inputKey = `${email}|${phone}`;
    if (inputKey !== prevInputRef.current) {
      prevInputRef.current = inputKey;
      // Un-dismiss when input changes (user is trying new values)
      if (dismissed) setDismissed(false);
    }

    // Clear previous timer
    if (timerRef.current) clearTimeout(timerRef.current);

    // Don't fetch if disabled or person already selected
    if (!enabled || selectedPerson) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const validEmail = hasValidEmail(email);
    const validPhone = hasValidPhone(phone);

    if (!validEmail && !validPhone) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    timerRef.current = setTimeout(async () => {
      // Cancel any in-flight request
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const body: Record<string, string> = {};
        if (validEmail) body.email = email;
        if (validPhone) body.phone = phone;

        const results = await postApi<PersonSuggestionResult[]>(
          "/api/people/suggest",
          body,
          { signal: controller.signal }
        );

        if (!controller.signal.aborted) {
          setSuggestions(results);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          // Network error or server error — silently clear
          setSuggestions([]);
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [email, phone, enabled, selectedPerson, dismissed]);

  return {
    suggestions,
    loading,
    dismissed,
    dismiss,
    reset,
    selectPerson,
    selectedPerson,
  };
}
