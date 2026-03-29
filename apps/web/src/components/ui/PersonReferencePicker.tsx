"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { formatPhoneAsYouType } from "@/lib/formatters";
import { usePersonSuggestion } from "@/hooks/usePersonSuggestion";
import { PersonSuggestionBanner } from "@/components/ui/PersonSuggestionBanner";
import { useDebounce } from "@/hooks/useDebounce";
import { Skeleton } from "@/components/feedback/Skeleton";
import { parseName } from "@/lib/name-utils";

export interface PersonReference {
  person_id: string | null;
  display_name: string;
  is_resolved: boolean;
}

interface PersonSearchResult {
  entity_id: string;
  display_name: string;
  subtitle: string;
}

interface PersonReferencePickerProps {
  value: PersonReference;
  onChange: (ref: PersonReference) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  inputStyle?: React.CSSProperties;
  allowCreate?: boolean;
  /** When true, only allows resolved (picked) or created people — no freeform text */
  requireResolved?: boolean;
  /** Called when resolution type changes: resolved (picked from search), unresolved (freeform), created (new person) */
  onResolutionType?: (type: "resolved" | "unresolved" | "created") => void;
}

interface CreatePersonResponse {
  person: {
    person_id: string;
    display_name: string;
  };
  resolution: {
    decision_type: string;
    is_new: boolean;
    is_match: boolean;
  };
}

const MAX_CACHE_ENTRIES = 10;
const MAX_MRU_ENTRIES = 5;

export function PersonReferencePicker({
  value,
  onChange,
  placeholder = "Search for a person...",
  label,
  required,
  inputStyle: customInputStyle,
  allowCreate = false,
  requireResolved = false,
  onResolutionType,
}: PersonReferencePickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonSearchResult[]>([]);
  const [fuzzyResults, setFuzzyResults] = useState<PersonSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [hasSearched, setHasSearched] = useState(false);

  // Inline creation state
  const [showCreateFields, setShowCreateFields] = useState(false);
  const [createFirstName, setCreateFirstName] = useState("");
  const [createLastName, setCreateLastName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);

  // AbortController for cancelling in-flight requests
  const abortRef = useRef<AbortController>();
  const searchIdRef = useRef(0);

  // Prefix cache: stores recent search results for instant filtering
  const cacheRef = useRef<Map<string, PersonSearchResult[]>>(new Map());

  // MRU: most recently used/selected people
  const mruRef = useRef<PersonSearchResult[]>([]);

  // Dedup check for inline creation
  const { suggestions: createSuggestions, loading: suggestLoading, dismissed: suggestDismissed, dismiss: suggestDismiss } =
    usePersonSuggestion({ email: createEmail, phone: createPhone, enabled: showCreateFields });

  const baseInputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--card-border, #e5e7eb)",
    borderRadius: "8px",
    fontSize: "0.9rem",
    background: "var(--background, #fff)",
    ...customInputStyle,
  };

  const searchPeople = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setFuzzyResults([]);
      setHasSearched(false);
      return;
    }

    // Abort previous in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const currentSearchId = ++searchIdRef.current;

    setLoading(true);
    setShowDropdown(true);
    try {
      const data = await fetchApi<{
        results: PersonSearchResult[];
        fuzzy_results?: PersonSearchResult[];
      }>(
        `/api/search?q=${encodeURIComponent(q)}&type=person&limit=8&fuzzy=true`,
        { signal: controller.signal }
      );

      // Stale response guard
      if (searchIdRef.current !== currentSearchId) return;

      const exactResults = data.results || [];
      setResults(exactResults);
      setFuzzyResults(data.fuzzy_results || []);
      setHasSearched(true);
      setShowDropdown(true);

      // Cache results for prefix matching
      const cache = cacheRef.current;
      cache.set(q.toLowerCase(), exactResults);
      // Evict oldest entries if over limit
      if (cache.size > MAX_CACHE_ENTRIES) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
      }
    } catch (err) {
      // Don't log aborted requests
      if (controller.signal.aborted) return;
      console.error("Person search failed:", err);
      if (searchIdRef.current !== currentSearchId) return;
      setResults([]);
      setFuzzyResults([]);
      setHasSearched(true);
    } finally {
      if (searchIdRef.current === currentSearchId) {
        setLoading(false);
      }
    }
  }, []);

  const debouncedSearch = useDebounce(searchPeople, 300);

  // Check prefix cache for instant results before debounced API call
  const checkPrefixCache = useCallback((q: string): PersonSearchResult[] | null => {
    const qLower = q.toLowerCase();
    const cache = cacheRef.current;
    for (const [key, cachedResults] of cache) {
      if (qLower.startsWith(key) && qLower !== key) {
        // Filter cached results client-side
        return cachedResults.filter(
          (r) =>
            r.display_name.toLowerCase().includes(qLower) ||
            r.subtitle?.toLowerCase().includes(qLower)
        );
      }
    }
    return null;
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuery(newValue);
    setSelectedIndex(-1);
    setShowCreateFields(false);
    setCreateError(null);

    if (newValue.length < 2) {
      setResults([]);
      setFuzzyResults([]);
      setShowDropdown(false);
      setHasSearched(false);
      return;
    }

    // Check prefix cache for instant results
    const cached = checkPrefixCache(newValue);
    if (cached) {
      setResults(cached);
      setFuzzyResults([]);
      setShowDropdown(true);
      setHasSearched(true);
    }

    // Always fire debounced API call for fresh results
    debouncedSearch(newValue);
  };

  const handleSelect = (person: PersonSearchResult) => {
    onChange({
      person_id: person.entity_id,
      display_name: person.display_name,
      is_resolved: true,
    });
    onResolutionType?.("resolved");

    // Add to MRU (dedupe, cap at MAX_MRU_ENTRIES)
    const mru = mruRef.current;
    const filtered = mru.filter((p) => p.entity_id !== person.entity_id);
    mruRef.current = [person, ...filtered].slice(0, MAX_MRU_ENTRIES);

    setQuery("");
    setResults([]);
    setFuzzyResults([]);
    setShowDropdown(false);
    setHasSearched(false);
    setShowCreateFields(false);
  };

  const handleUseFreeText = () => {
    onChange({
      person_id: null,
      display_name: query.trim(),
      is_resolved: false,
    });
    onResolutionType?.("unresolved");
    setResults([]);
    setFuzzyResults([]);
    setShowDropdown(false);
    setHasSearched(false);
    setShowCreateFields(false);
  };

  const handleClear = () => {
    onChange({ person_id: null, display_name: "", is_resolved: false });
    setQuery("");
    setResults([]);
    setFuzzyResults([]);
    setShowDropdown(false);
    setHasSearched(false);
    setShowCreateFields(false);
    setCreateFirstName("");
    setCreateLastName("");
    setCreatePhone("");
    setCreateEmail("");
    setCreateError(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleStartCreate = () => {
    // Auto-split query into first/last name using shared parseName
    const parsed = parseName(query.trim());
    setCreateFirstName(parsed.first_name);
    setCreateLastName(parsed.last_name);
    setShowDropdown(false);
    setShowCreateFields(true);
    setCreatePhone("");
    setCreateEmail("");
    setCreateError(null);
  };

  const handleCancelCreate = () => {
    setShowCreateFields(false);
    setCreateFirstName("");
    setCreateLastName("");
    setCreatePhone("");
    setCreateEmail("");
    setCreateError(null);
  };

  const handleCreate = async () => {
    const hasEmail = createEmail.includes("@");
    const hasPhone = createPhone.replace(/\D/g, "").length >= 7;
    if (!hasEmail && !hasPhone) {
      setCreateError("Email or phone is required");
      return;
    }

    const firstName = createFirstName.trim() || query.trim();
    const lastName = createLastName.trim() || null;

    setCreating(true);
    setCreateError(null);
    try {
      const resp = await postApi<CreatePersonResponse>("/api/people", {
        first_name: firstName,
        last_name: lastName,
        email: createEmail.trim() || null,
        phone: createPhone.trim() || null,
      });

      onChange({
        person_id: resp.person.person_id,
        display_name: resp.person.display_name,
        is_resolved: true,
      });
      onResolutionType?.("created");
      setQuery("");
      setResults([]);
      setFuzzyResults([]);
      setShowCreateFields(false);
      setCreateFirstName("");
      setCreateLastName("");
      setCreatePhone("");
      setCreateEmail("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create person");
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) {
      if (e.key === "Enter" && query.trim().length > 0 && !requireResolved) {
        e.preventDefault();
        handleUseFreeText();
      }
      return;
    }

    // Count total dropdown items: results + fuzzy + "Create" option (if allowCreate) + "Use" option
    const hasCreateOption = allowCreate && hasSearched && results.length === 0 && fuzzyResults.length === 0 && query.trim().length >= 2;
    const hasUseOption = !requireResolved && query.trim().length >= 2;
    let totalItems = results.length + fuzzyResults.length;
    if (hasCreateOption) totalItems++;
    if (hasUseOption) totalItems++;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : prev));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          handleSelect(results[selectedIndex]);
        } else if (selectedIndex >= results.length && selectedIndex < results.length + fuzzyResults.length) {
          handleSelect(fuzzyResults[selectedIndex - results.length]);
        } else if (hasCreateOption && selectedIndex === results.length + fuzzyResults.length) {
          handleStartCreate();
        } else if (hasUseOption && selectedIndex === totalItems - 1) {
          handleUseFreeText();
        } else if (!requireResolved && query.trim().length > 0) {
          handleUseFreeText();
        }
        break;
      case "Escape":
        setShowDropdown(false);
        break;
    }
  };

  const handleFocus = () => {
    // Show MRU when focusing with empty input
    if (!query && mruRef.current.length > 0) {
      setResults(mruRef.current);
      setFuzzyResults([]);
      setHasSearched(false); // MRU, not a search
      setShowDropdown(true);
      return;
    }
    if (results.length > 0 || (hasSearched && query.length >= 2)) {
      setShowDropdown(true);
    }
  };

  const handleBlur = () => {
    // Delay to allow click on dropdown items
    setTimeout(() => {
      if (
        dropdownRef.current &&
        dropdownRef.current.contains(document.activeElement)
      ) {
        return;
      }
      // Don't close dropdown if create fields are shown
      if (showCreateFields && createRef.current?.contains(document.activeElement)) {
        return;
      }
      setShowDropdown(false);
    }, 200);
  };

  // Outside-click close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        inputRef.current &&
        !inputRef.current.contains(target) &&
        (!createRef.current || !createRef.current.contains(target))
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      // Abort in-flight request on unmount
      if (abortRef.current) abortRef.current.abort();
      cacheRef.current.clear();
    };
  }, []);

  // Show MRU header when displaying MRU (empty query, not searched)
  const showingMru = !query && !hasSearched && results.length > 0 && showDropdown;

  // Determine if dropdown should be visible (includes loading skeleton state)
  const showDropdownContent = showDropdown && (
    results.length > 0 ||
    fuzzyResults.length > 0 ||
    (hasSearched && query.trim().length >= 2) ||
    (loading && query.length >= 2) ||
    showingMru
  );

  // Resolved state: show linked name with badge + clear button
  if (value.is_resolved && value.display_name) {
    return (
      <div>
        {label && (
          <label style={labelStyle}>
            {label} {required && "*"}
          </label>
        )}
        <div
          style={{
            ...baseInputStyle,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--section-bg, #f9fafb)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "#22c55e",
                flexShrink: 0,
              }}
            />
            {value.display_name}
          </span>
          <button
            type="button"
            onClick={handleClear}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted, #6b7280)",
              fontSize: "1rem",
              padding: "0 4px",
              lineHeight: 1,
            }}
            title="Clear and search for a different person"
          >
            x
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {label && (
        <label style={labelStyle}>
          {label} {required && "*"}
        </label>
      )}
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={handleFocus}
          placeholder={placeholder}
          required={required && !value.display_name}
          style={baseInputStyle}
        />

        {showDropdownContent && (
          <div
            ref={dropdownRef}
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              maxHeight: "200px",
              overflowY: "auto",
              zIndex: 1000,
              background: "var(--card-bg, #fff)",
              border: "1px solid var(--card-border, #e5e7eb)",
              borderRadius: "0 0 8px 8px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            }}
          >
            {/* MRU header */}
            {showingMru && (
              <div
                style={{
                  padding: "6px 12px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: "var(--text-muted, #6b7280)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  borderBottom: "1px solid var(--card-border, #e5e7eb)",
                }}
              >
                Recent
              </div>
            )}

            {/* Skeleton loading rows — shown while API is in-flight and no cached results */}
            {loading && query.length >= 2 && results.length === 0 && (
              <>
                {[0.85, 0.65, 0.75].map((widthFraction, i) => (
                  <div key={i} style={{ padding: "8px 12px", borderBottom: "1px solid var(--card-border, #e5e7eb)" }}>
                    <Skeleton height={14} width={`${widthFraction * 100}%`} style={{ marginBottom: 4 }} />
                    <Skeleton height={10} width={`${widthFraction * 60}%`} />
                  </div>
                ))}
              </>
            )}

            {/* Exact match results */}
            {results.map((person, index) => (
              <div
                key={person.entity_id}
                onClick={() => handleSelect(person)}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--card-border, #e5e7eb)",
                  background:
                    selectedIndex === index
                      ? "rgba(13, 110, 253, 0.1)"
                      : "transparent",
                }}
              >
                <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>
                  {person.display_name}
                </div>
                {person.subtitle && (
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #6b7280)" }}>
                    {person.subtitle}
                  </div>
                )}
              </div>
            ))}

            {/* Fuzzy match results — "Similar contacts" section */}
            {fuzzyResults.length > 0 && (
              <>
                <div
                  style={{
                    padding: "6px 12px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "#92400e",
                    background: "#fffbeb",
                    borderBottom: "1px solid var(--card-border, #e5e7eb)",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span style={{ fontSize: "0.8rem" }}>&#9888;</span>
                  Similar contacts:
                </div>
                {fuzzyResults.map((person, index) => {
                  const globalIndex = results.length + index;
                  return (
                    <div
                      key={`fuzzy-${person.entity_id}`}
                      onClick={() => handleSelect(person)}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                      style={{
                        padding: "8px 12px",
                        cursor: "pointer",
                        borderBottom: "1px solid var(--card-border, #e5e7eb)",
                        background:
                          selectedIndex === globalIndex
                            ? "rgba(13, 110, 253, 0.1)"
                            : "#fffbeb",
                      }}
                    >
                      <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>
                        {person.display_name}
                      </div>
                      {person.subtitle && (
                        <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #6b7280)" }}>
                          {person.subtitle}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* "Create new person" option — shown when allowCreate, searched, no results */}
            {allowCreate && hasSearched && results.length === 0 && fuzzyResults.length === 0 && query.trim().length >= 2 && (
              <div
                onClick={handleStartCreate}
                onMouseEnter={() => setSelectedIndex(results.length + fuzzyResults.length)}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  background:
                    selectedIndex === results.length + fuzzyResults.length
                      ? "rgba(13, 110, 253, 0.1)"
                      : "transparent",
                  color: "#2563eb",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                }}
              >
                + Create &ldquo;{query.trim()}&rdquo; as new person
              </div>
            )}

            {/* "Use as free text" option — hidden when requireResolved */}
            {!requireResolved && query.trim().length >= 2 && (
              <div
                onClick={handleUseFreeText}
                onMouseEnter={() => {
                  const createIdx = (allowCreate && hasSearched && results.length === 0 && fuzzyResults.length === 0) ? 1 : 0;
                  setSelectedIndex(results.length + fuzzyResults.length + createIdx);
                }}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  background:
                    selectedIndex === results.length + fuzzyResults.length + ((allowCreate && hasSearched && results.length === 0 && fuzzyResults.length === 0) ? 1 : 0)
                      ? "rgba(13, 110, 253, 0.1)"
                      : "transparent",
                  color: "var(--text-muted, #6b7280)",
                  fontSize: "0.85rem",
                  fontStyle: "italic",
                }}
              >
                Use &ldquo;{query.trim()}&rdquo;
              </div>
            )}

            {/* No results message (only when we have searched and got nothing and no create) */}
            {hasSearched && results.length === 0 && fuzzyResults.length === 0 && query.trim().length >= 2 && !allowCreate && (
              <div
                style={{
                  padding: "8px 12px",
                  fontSize: "0.8rem",
                  color: "var(--text-muted, #6b7280)",
                }}
              >
                No people found matching &ldquo;{query}&rdquo;
              </div>
            )}
          </div>
        )}
      </div>

      {/* Inline creation fields — shown below input when user clicks "Create" */}
      {showCreateFields && (
        <div
          ref={createRef}
          style={{
            marginTop: "8px",
            padding: "12px",
            border: "1px solid #93c5fd",
            borderRadius: "8px",
            background: "#eff6ff",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "#1e40af", fontWeight: 600, marginBottom: "8px" }}>
            Create new person — add contact info:
          </div>

          {/* Dedup banner */}
          <PersonSuggestionBanner
            suggestions={createSuggestions}
            loading={suggestLoading}
            dismissed={suggestDismissed}
            onDismiss={suggestDismiss}
            onSelect={(person) => {
              onChange({
                person_id: person.person_id,
                display_name: person.display_name,
                is_resolved: true,
              });
              onResolutionType?.("resolved");
              setQuery("");
              setShowCreateFields(false);
              setCreateFirstName("");
              setCreateLastName("");
              setCreatePhone("");
              setCreateEmail("");
            }}
          />

          <div style={{ display: "grid", gap: "8px" }}>
            {/* Editable first/last name fields */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <input
                type="text"
                value={createFirstName}
                onChange={(e) => setCreateFirstName(e.target.value)}
                placeholder="First name"
                style={{ ...baseInputStyle, padding: "6px 10px", fontSize: "0.85rem" }}
              />
              <input
                type="text"
                value={createLastName}
                onChange={(e) => setCreateLastName(e.target.value)}
                placeholder="Last name"
                style={{ ...baseInputStyle, padding: "6px 10px", fontSize: "0.85rem" }}
              />
            </div>
            {/* Phone first — highest value for ClinicHQ auto-linking */}
            <input
              type="tel"
              value={createPhone}
              onChange={(e) => setCreatePhone(formatPhoneAsYouType(e.target.value))}
              placeholder="Phone (best for auto-linking)"
              style={{ ...baseInputStyle, padding: "6px 10px", fontSize: "0.85rem" }}
            />
            <input
              type="email"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              placeholder="Email"
              style={{ ...baseInputStyle, padding: "6px 10px", fontSize: "0.85rem" }}
            />
          </div>

          {createError && (
            <div style={{ color: "#dc3545", fontSize: "0.8rem", marginTop: "6px" }}>
              {createError}
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              style={{
                padding: "4px 12px",
                background: creating ? "#9ca3af" : "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.8rem",
                fontWeight: 500,
                cursor: creating ? "not-allowed" : "pointer",
              }}
            >
              {creating ? "Creating..." : "Create"}
            </button>
            {!requireResolved && (
              <button
                type="button"
                onClick={handleUseFreeText}
                style={{
                  padding: "4px 12px",
                  background: "transparent",
                  color: "#2563eb",
                  border: "1px solid #93c5fd",
                  borderRadius: "6px",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Skip — just use name
              </button>
            )}
            <button
              type="button"
              onClick={handleCancelCreate}
              style={{
                padding: "4px 12px",
                background: "transparent",
                color: "var(--text-muted, #6b7280)",
                border: "1px solid var(--border, #e5e7eb)",
                borderRadius: "6px",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.85rem",
  fontWeight: 500,
  marginBottom: "6px",
};
