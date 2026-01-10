"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

interface SearchResult {
  entity_type: string;
  entity_id: string;
  display_name: string;
  subtitle: string | null;
  match_strength: string;
  match_reason: string;
  score: number;
}

interface SuggestionsResponse {
  suggestions: SearchResult[];
}

function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export default function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&suggestions=true`);
      if (response.ok) {
        const data: SuggestionsResponse = await response.json();
        setSuggestions(data.suggestions || []);
      }
    } catch (error) {
      console.error("Error fetching suggestions:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const debouncedFetch = useCallback(
    debounce((q: string) => fetchSuggestions(q), 200),
    [fetchSuggestions]
  );

  useEffect(() => {
    if (query.trim().length >= 2) {
      debouncedFetch(query);
      setIsOpen(true);
    } else {
      setSuggestions([]);
      setIsOpen(false);
    }
  }, [query, debouncedFetch]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const navigateToEntity = (result: SearchResult) => {
    setIsOpen(false);
    setQuery("");
    switch (result.entity_type) {
      case "cat":
        router.push(`/cats/${result.entity_id}`);
        break;
      case "person":
        router.push(`/people/${result.entity_id}`);
        break;
      case "place":
        router.push(`/places/${result.entity_id}`);
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || suggestions.length === 0) {
      if (e.key === "Enter" && query.trim()) {
        router.push(`/search?q=${encodeURIComponent(query)}`);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          navigateToEntity(suggestions[selectedIndex]);
        } else if (query.trim()) {
          router.push(`/search?q=${encodeURIComponent(query)}`);
          setIsOpen(false);
        }
        break;
      case "Escape":
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const getMatchBadge = (reason: string) => {
    if (reason.startsWith("exact")) return "Exact";
    if (reason.startsWith("prefix")) return "Prefix";
    if (reason.startsWith("similar")) return "Similar";
    return null;
  };

  const getEntityIcon = (type: string) => {
    switch (type) {
      case "cat":
        return "🐱";
      case "person":
        return "👤";
      case "place":
        return "📍";
      default:
        return "•";
    }
  };

  // Group suggestions by type
  const groupedSuggestions = suggestions.reduce(
    (acc, suggestion) => {
      if (!acc[suggestion.entity_type]) {
        acc[suggestion.entity_type] = [];
      }
      acc[suggestion.entity_type].push(suggestion);
      return acc;
    },
    {} as Record<string, SearchResult[]>
  );

  const typeOrder = ["cat", "person", "place"];
  let flatIndex = -1;

  return (
    <div className="search-container">
      <input
        ref={inputRef}
        type="text"
        placeholder="Search cats, people, places..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => query.trim().length >= 2 && setIsOpen(true)}
        className="search-input"
        autoComplete="off"
      />
      {loading && <span className="search-loading">...</span>}

      {isOpen && suggestions.length > 0 && (
        <div ref={dropdownRef} className="search-dropdown">
          {typeOrder.map((type) => {
            const items = groupedSuggestions[type];
            if (!items || items.length === 0) return null;

            return (
              <div key={type} className="search-group">
                <div className="search-group-header">
                  {getEntityIcon(type)} {type.charAt(0).toUpperCase() + type.slice(1)}s
                </div>
                {items.map((suggestion) => {
                  flatIndex++;
                  const currentIndex = flatIndex;
                  const matchBadge = getMatchBadge(suggestion.match_reason);

                  return (
                    <div
                      key={`${suggestion.entity_type}-${suggestion.entity_id}`}
                      className={`search-suggestion ${
                        selectedIndex === currentIndex ? "selected" : ""
                      }`}
                      onClick={() => navigateToEntity(suggestion)}
                      onMouseEnter={() => setSelectedIndex(currentIndex)}
                    >
                      <div className="search-suggestion-content">
                        <span className="search-suggestion-name">
                          {suggestion.display_name}
                        </span>
                        {matchBadge && (
                          <span className="search-match-badge">{matchBadge}</span>
                        )}
                      </div>
                      {suggestion.subtitle && (
                        <div className="search-suggestion-subtitle">
                          {suggestion.subtitle}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div className="search-footer">
            Press Enter to see all results
          </div>
        </div>
      )}

      <style jsx>{`
        .search-container {
          position: relative;
          flex: 1;
          max-width: 400px;
        }

        .search-input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 0.875rem;
          background: var(--background);
          color: var(--foreground);
        }

        .search-input:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 20%, transparent);
        }

        .search-loading {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--muted);
          font-size: 0.75rem;
        }

        .search-dropdown {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          z-index: 1000;
          max-height: 400px;
          overflow-y: auto;
        }

        .search-group {
          padding: 0.25rem 0;
        }

        .search-group:not(:last-child) {
          border-bottom: 1px solid var(--border);
        }

        .search-group-header {
          padding: 0.5rem 0.75rem 0.25rem;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .search-suggestion {
          padding: 0.5rem 0.75rem;
          cursor: pointer;
        }

        .search-suggestion:hover,
        .search-suggestion.selected {
          background: color-mix(in srgb, var(--primary) 10%, transparent);
        }

        .search-suggestion-content {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .search-suggestion-name {
          font-weight: 500;
        }

        .search-match-badge {
          font-size: 0.625rem;
          padding: 0.125rem 0.375rem;
          background: color-mix(in srgb, var(--primary) 15%, transparent);
          color: var(--primary);
          border-radius: 3px;
          font-weight: 500;
        }

        .search-suggestion-subtitle {
          font-size: 0.75rem;
          color: var(--muted);
          margin-top: 0.125rem;
        }

        .search-footer {
          padding: 0.5rem 0.75rem;
          font-size: 0.75rem;
          color: var(--muted);
          text-align: center;
          border-top: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}
