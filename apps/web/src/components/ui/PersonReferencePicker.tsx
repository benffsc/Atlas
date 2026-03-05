"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";

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
}

export function PersonReferencePicker({
  value,
  onChange,
  placeholder = "Search for a person...",
  label,
  required,
  inputStyle: customInputStyle,
}: PersonReferencePickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [hasSearched, setHasSearched] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

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
      setHasSearched(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchApi<{ results: PersonSearchResult[] }>(
        `/api/search?q=${encodeURIComponent(q)}&type=person&limit=8`
      );
      setResults(data.results || []);
      setHasSearched(true);
      setShowDropdown(true);
    } catch (err) {
      console.error("Person search failed:", err);
      setResults([]);
      setHasSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuery(newValue);
    setSelectedIndex(-1);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (newValue.length < 2) {
      setResults([]);
      setShowDropdown(false);
      setHasSearched(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      searchPeople(newValue);
    }, 300);
  };

  const handleSelect = (person: PersonSearchResult) => {
    onChange({
      person_id: person.entity_id,
      display_name: person.display_name,
      is_resolved: true,
    });
    setQuery("");
    setResults([]);
    setShowDropdown(false);
    setHasSearched(false);
  };

  const handleUseFreeText = () => {
    onChange({
      person_id: null,
      display_name: query.trim(),
      is_resolved: false,
    });
    setResults([]);
    setShowDropdown(false);
    setHasSearched(false);
  };

  const handleClear = () => {
    onChange({ person_id: null, display_name: "", is_resolved: false });
    setQuery("");
    setResults([]);
    setShowDropdown(false);
    setHasSearched(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) {
      if (e.key === "Enter" && query.trim().length > 0) {
        e.preventDefault();
        handleUseFreeText();
      }
      return;
    }

    const totalItems = results.length + (query.trim().length >= 2 ? 1 : 0); // +1 for "Use" option

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
        } else if (selectedIndex === results.length && query.trim().length >= 2) {
          handleUseFreeText();
        } else if (query.trim().length > 0) {
          handleUseFreeText();
        }
        break;
      case "Escape":
        setShowDropdown(false);
        break;
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
      setShowDropdown(false);
    }, 200);
  };

  // Outside-click close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

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
          onFocus={() => {
            if (results.length > 0 || (hasSearched && query.length >= 2)) {
              setShowDropdown(true);
            }
          }}
          placeholder={loading ? "Searching..." : placeholder}
          required={required && !value.display_name}
          style={baseInputStyle}
        />

        {showDropdown && (results.length > 0 || (hasSearched && query.trim().length >= 2)) && (
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

            {/* "Use as free text" option */}
            {query.trim().length >= 2 && (
              <div
                onClick={handleUseFreeText}
                onMouseEnter={() => setSelectedIndex(results.length)}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  background:
                    selectedIndex === results.length
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

            {/* No results message (only when we have searched and got nothing) */}
            {hasSearched && results.length === 0 && query.trim().length >= 2 && (
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
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.85rem",
  fontWeight: 500,
  marginBottom: "6px",
};
