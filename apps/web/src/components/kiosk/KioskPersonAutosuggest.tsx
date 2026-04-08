"use client";

/**
 * KioskPersonAutosuggest — mobile-modal-first custodian picker for the
 * kiosk equipment flows.
 *
 * Drop-in replacement for PersonReferencePicker in kiosk contexts. Differs
 * from PersonReferencePicker in three intentional ways:
 *
 * 1. **Modal, not inline dropdown.** Suggestions appear in a full-screen
 *    bottom-sheet style modal with large tap targets — much easier to use
 *    on a tablet kiosk than the cramped inline dropdown.
 *
 * 2. **"Use what I typed" is the FIRST and most prominent option.** When
 *    suggestions exist, the modal headline is the user's typed name with a
 *    big primary button that just commits it as free text. Suggested
 *    matches are listed BELOW that as secondary options. Saying "no" is
 *    one tap and is the easier path.
 *
 * 3. **No inline person creation.** The kiosk doesn't try to create person
 *    records on the fly. The user just types a name; the backend's data
 *    engine resolves identity from email/phone via subsequent ingest paths,
 *    OR staff can promote the free-text name to a real person later via
 *    /admin/people. The kiosk's only job is to NOT lose the typed name.
 *
 * Same `PersonReference` interface as PersonReferencePicker so it's a clean
 * drop-in: pass `value` + `onChange` and you're done.
 *
 * Trap 0106 lesson (2026-04-08): the kiosk previously was the only place
 * the custodian name lived for non-resolved checkouts, and a parallel
 * Airtable cron clobbered it every 4 hours. The cron is dead now, but the
 * design lesson stands: the kiosk has to be honest about what it knows.
 * If staff says "Krystianna Enriquez" and there's no exact match, store
 * exactly that string and let backend identity resolution catch up later.
 * Don't aggressively pre-link.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api-client";
import { useDebounce } from "@/hooks/useDebounce";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export interface PersonReference {
  person_id: string | null;
  display_name: string;
  is_resolved: boolean;
}

interface SearchResult {
  entity_id: string;
  display_name: string;
  subtitle: string;
}

interface KioskPersonAutosuggestProps {
  value: PersonReference;
  onChange: (ref: PersonReference) => void;
  placeholder?: string;
  label?: string;
  /** Disable the entire input (e.g. while parent form is submitting) */
  disabled?: boolean;
  /** Min characters before triggering suggestion search. Default 2. */
  minQueryLength?: number;
}

export function KioskPersonAutosuggest({
  value,
  onChange,
  placeholder = "Type a name...",
  label,
  disabled = false,
  minQueryLength = 2,
}: KioskPersonAutosuggestProps) {
  const [query, setQuery] = useState(value.display_name || "");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController>();
  const searchIdRef = useRef(0);

  // Keep query in sync with value when parent resets
  useEffect(() => {
    setQuery(value.display_name || "");
  }, [value.display_name]);

  const fetchSuggestions = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < minQueryLength) {
        setSuggestions([]);
        setHasSearched(false);
        return;
      }

      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const currentSearchId = ++searchIdRef.current;

      setSearching(true);
      try {
        const data = await fetchApi<{
          results: SearchResult[];
          fuzzy_results?: SearchResult[];
        }>(
          `/api/search?q=${encodeURIComponent(trimmed)}&type=person&limit=6&fuzzy=true`,
          { signal: controller.signal },
        );
        // Stale-response guard
        if (searchIdRef.current !== currentSearchId) return;

        // Combine exact + fuzzy, dedupe by entity_id
        const combined: SearchResult[] = [];
        const seen = new Set<string>();
        for (const r of data.results || []) {
          if (!seen.has(r.entity_id)) {
            combined.push(r);
            seen.add(r.entity_id);
          }
        }
        for (const r of data.fuzzy_results || []) {
          if (!seen.has(r.entity_id)) {
            combined.push(r);
            seen.add(r.entity_id);
          }
        }
        setSuggestions(combined);
        setHasSearched(true);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("[KioskPersonAutosuggest] search failed:", err);
        if (searchIdRef.current !== currentSearchId) return;
        setSuggestions([]);
        setHasSearched(true);
      } finally {
        if (searchIdRef.current === currentSearchId) {
          setSearching(false);
        }
      }
    },
    [minQueryLength],
  );

  const debouncedFetch = useDebounce(fetchSuggestions, 300);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setQuery(next);
    // Update the parent immediately as free-text so the value is never lost
    onChange({
      person_id: null,
      display_name: next,
      is_resolved: false,
    });
    debouncedFetch(next);
  };

  const handleClear = () => {
    setQuery("");
    setSuggestions([]);
    setHasSearched(false);
    onChange({ person_id: null, display_name: "", is_resolved: false });
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handlePickSuggestion = (s: SearchResult) => {
    onChange({
      person_id: s.entity_id,
      display_name: s.display_name,
      is_resolved: true,
    });
    setQuery(s.display_name);
    setSuggestions([]);
    setHasSearched(false);
    setModalOpen(false);
  };

  const handleUseTyped = () => {
    onChange({
      person_id: null,
      display_name: query.trim(),
      is_resolved: false,
    });
    setModalOpen(false);
  };

  const handleOpenModal = () => {
    if (query.trim().length >= minQueryLength && hasSearched && suggestions.length > 0) {
      setModalOpen(true);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  const showSuggestionHint =
    !modalOpen &&
    query.trim().length >= minQueryLength &&
    hasSearched &&
    suggestions.length > 0 &&
    !value.is_resolved;

  return (
    <div>
      {label && (
        <label
          style={{
            display: "block",
            fontSize: "0.7rem",
            fontWeight: 600,
            color: "var(--text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            marginBottom: "0.25rem",
          }}
        >
          {label}
        </label>
      )}

      {/* Plain text input — never blocks the user */}
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          style={{
            width: "100%",
            minHeight: 56,
            padding: "12px 44px 12px 14px",
            fontSize: "1.05rem",
            borderRadius: 12,
            border: value.is_resolved
              ? "2px solid var(--success-text, #16a34a)"
              : "1px solid var(--card-border, #e5e7eb)",
            background: value.is_resolved
              ? "var(--success-bg, rgba(34,197,94,0.06))"
              : "var(--background, #fff)",
            color: "var(--text-primary)",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            aria-label="Clear name"
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "none",
              background: "var(--bg-secondary, #f3f4f6)",
              color: "var(--muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: disabled ? "not-allowed" : "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <Icon name="x" size={16} color="var(--muted)" />
          </button>
        )}
      </div>

      {/* Resolved-state badge — clear feedback that we linked to a real person */}
      {value.is_resolved && (
        <div
          style={{
            marginTop: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: "0.75rem",
            color: "var(--success-text, #16a34a)",
            fontWeight: 500,
          }}
        >
          <Icon name="check-circle" size={14} color="var(--success-text, #16a34a)" />
          Linked to existing person
        </div>
      )}

      {/* Suggestion-found hint — small button under the input, NOT a popup */}
      {showSuggestionHint && (
        <button
          type="button"
          onClick={handleOpenModal}
          disabled={disabled}
          style={{
            marginTop: 8,
            width: "100%",
            padding: "10px 14px",
            background: "var(--info-bg, rgba(59,130,246,0.06))",
            border: "1px solid var(--info-border, #93c5fd)",
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: "0.85rem",
            color: "var(--info-text, #1d4ed8)",
            cursor: disabled ? "not-allowed" : "pointer",
            textAlign: "left",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <Icon name="search" size={16} color="var(--info-text, #1d4ed8)" />
          <span style={{ flex: 1 }}>
            Found {suggestions.length} possible match
            {suggestions.length === 1 ? "" : "es"} — tap to review
          </span>
          <Icon name="chevron-right" size={16} color="var(--info-text, #1d4ed8)" />
        </button>
      )}

      {/* Searching indicator — subtle, non-blocking */}
      {searching && !showSuggestionHint && (
        <div
          style={{
            marginTop: 6,
            fontSize: "0.75rem",
            color: "var(--muted)",
          }}
        >
          Looking for matches…
        </div>
      )}

      {/* Modal — opens only when user explicitly taps the hint */}
      {modalOpen && (
        <SuggestionModal
          query={query}
          suggestions={suggestions}
          onPick={handlePickSuggestion}
          onUseTyped={handleUseTyped}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SuggestionModal
// ─────────────────────────────────────────────────────────────────────────────

function SuggestionModal({
  query,
  suggestions,
  onPick,
  onUseTyped,
  onClose,
}: {
  query: string;
  suggestions: SearchResult[];
  onPick: (s: SearchResult) => void;
  onUseTyped: () => void;
  onClose: () => void;
}) {
  // Lock body scroll while modal is open
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Possible name matches"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        animation: "kiosk-modal-fade-in 150ms ease-out",
      }}
      onClick={(e) => {
        // Click backdrop closes
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <style>{`
        @keyframes kiosk-modal-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes kiosk-modal-slide-up {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          background: "var(--background, #fff)",
          borderRadius: "20px 20px 0 0",
          padding: "1.25rem 1.25rem 1.5rem",
          paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))",
          boxShadow: "0 -8px 32px rgba(0, 0, 0, 0.18)",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          overflowY: "auto",
          animation: "kiosk-modal-slide-up 200ms ease-out",
        }}
      >
        {/* Drag handle (visual only) */}
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: "var(--card-border, #e5e7eb)",
            margin: "0 auto -0.25rem",
          }}
        />

        {/* Header */}
        <div>
          <h2
            style={{
              margin: "0 0 0.25rem",
              fontSize: "1.25rem",
              fontWeight: 800,
              color: "var(--text-primary)",
            }}
          >
            Did you mean…
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: "0.85rem",
              color: "var(--text-secondary)",
              lineHeight: 1.4,
            }}
          >
            We found {suggestions.length} possible match
            {suggestions.length === 1 ? "" : "es"} for{" "}
            <strong style={{ color: "var(--text-primary)" }}>“{query}”</strong>.
            If none of these are right, just use what you typed.
          </p>
        </div>

        {/* PRIMARY action: use what they typed. Big, top, friendly. */}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          icon="check"
          onClick={onUseTyped}
          style={{
            minHeight: 64,
            borderRadius: 14,
            fontSize: "1.05rem",
            fontWeight: 700,
          }}
        >
          Use “{query}” as typed
        </Button>

        {/* Divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            color: "var(--muted)",
            fontSize: "0.7rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
          }}
        >
          <div style={{ flex: 1, height: 1, background: "var(--card-border)" }} />
          or pick a match
          <div style={{ flex: 1, height: 1, background: "var(--card-border)" }} />
        </div>

        {/* Suggestions — large tap targets */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {suggestions.map((s) => (
            <button
              key={s.entity_id}
              type="button"
              onClick={() => onPick(s)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.875rem",
                padding: "0.875rem 1rem",
                background: "var(--card-bg, #fff)",
                border: "1px solid var(--card-border, #e5e7eb)",
                borderRadius: 12,
                textAlign: "left",
                cursor: "pointer",
                minHeight: 64,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "var(--bg-secondary, #f3f4f6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon name="user" size={20} color="var(--muted)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "1rem",
                    color: "var(--text-primary)",
                    lineHeight: 1.2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.display_name}
                </div>
                {s.subtitle && (
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--text-secondary)",
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.subtitle}
                  </div>
                )}
              </div>
              <Icon name="chevron-right" size={20} color="var(--muted)" />
            </button>
          ))}
        </div>

        {/* Cancel — also closes the modal but doesn't change the value */}
        <Button
          variant="ghost"
          size="lg"
          fullWidth
          onClick={onClose}
          style={{ minHeight: 52, borderRadius: 12, marginTop: "0.25rem" }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
