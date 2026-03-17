"use client";

import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api-client";

interface SearchResult {
  entity_type: string;
  entity_id: string;
  display_name: string;
  subtitle: string | null;
  match_strength: string;
  match_reason: string;
  score: number;
  metadata?: { lat?: number; lng?: number; [key: string]: unknown };
}

const ENTITY_ICONS: Record<string, string> = {
  cat: "\uD83D\uDC31",
  person: "\uD83D\uDC64",
  place: "\uD83D\uDCCD",
  request: "\uD83D\uDCCB",
};

const ENTITY_PATHS: Record<string, string> = {
  cat: "/cats",
  person: "/people",
  place: "/places",
  request: "/requests",
};

const QUICK_ACTIONS = [
  { id: "nav-dashboard", label: "Go to Dashboard", icon: "\uD83C\uDFE0", href: "/" },
  { id: "nav-map", label: "Go to Map", icon: "\uD83D\uDDFA\uFE0F", href: "/map" },
  { id: "nav-intake", label: "Go to Intake Queue", icon: "\uD83D\uDCE5", href: "/intake/queue" },
  { id: "nav-requests", label: "Go to Requests", icon: "\uD83D\uDCCB", href: "/requests" },
  { id: "nav-cats", label: "Go to Cats", icon: "\uD83D\uDC31", href: "/cats" },
  { id: "nav-people", label: "Go to People", icon: "\uD83D\uDC65", href: "/people" },
  { id: "nav-places", label: "Go to Places", icon: "\uD83D\uDCCD", href: "/places" },
  { id: "nav-trappers", label: "Go to Trappers", icon: "\uD83E\uDE64", href: "/trappers" },
  { id: "nav-admin", label: "Go to Admin", icon: "\u2699\uFE0F", href: "/admin" },
  { id: "new-request", label: "New Request", icon: "\u2795", href: "/requests/new" },
  { id: "new-intake", label: "New Intake Submission", icon: "\u2795", href: "/intake/queue/new" },
];

// ── Context ──

interface CommandPaletteContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  open: () => {},
  close: () => {},
  isOpen: false,
});

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <CommandPaletteContext.Provider value={{ open: () => setIsOpen(true), close: () => setIsOpen(false), isOpen }}>
      {children}
      {isOpen && <CommandPaletteModal onClose={() => setIsOpen(false)} />}
    </CommandPaletteContext.Provider>
  );
}

// ── Modal ──

function CommandPaletteModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await fetchApi<{ suggestions: SearchResult[] }>(
          `/api/search?q=${encodeURIComponent(query)}&limit=8&suggestions=true`
        );
        setResults(data.suggestions || []);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Filtered quick actions
  const filteredActions = query.trim().length === 0
    ? QUICK_ACTIONS
    : QUICK_ACTIONS.filter(a =>
        a.label.toLowerCase().includes(query.toLowerCase())
      );

  // Combined items: search results + quick actions
  const allItems = [
    ...results.map(r => ({ type: "result" as const, ...r })),
    ...filteredActions.map(a => ({ type: "action" as const, ...a })),
  ];

  const totalItems = allItems.length;

  const navigate = (item: typeof allItems[number]) => {
    onClose();
    if (item.type === "result") {
      const path = ENTITY_PATHS[item.entity_type] || "/search";
      router.push(`${path}/${item.entity_id}`);
    } else {
      router.push(item.href);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && totalItems > 0) {
      e.preventDefault();
      navigate(allItems[selectedIndex]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  // Scroll selected into view
  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          zIndex: 9998, backdropFilter: "blur(2px)",
        }}
      />

      {/* Modal */}
      <div style={{
        position: "fixed", top: "15%", left: "50%", transform: "translateX(-50%)",
        width: "560px", maxWidth: "90vw", maxHeight: "480px",
        background: "var(--background)", borderRadius: "12px",
        border: "1px solid var(--border)", boxShadow: "0 16px 40px rgba(0,0,0,0.2)",
        zIndex: 9999, display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", gap: "0.5rem" }}>
          <span style={{ fontSize: "1.1rem", color: "var(--muted)", flexShrink: 0 }}>{"\uD83D\uDD0D"}</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search cats, people, places, or type a command..."
            style={{
              flex: 1, border: "none", outline: "none", background: "transparent",
              fontSize: "1rem", color: "var(--foreground)", padding: 0,
            }}
          />
          {loading && <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>...</span>}
          <kbd style={{
            fontSize: "0.65rem", padding: "2px 6px", border: "1px solid var(--border)",
            borderRadius: "4px", color: "var(--muted)", background: "var(--section-bg)",
          }}>esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflowY: "auto", maxHeight: "400px" }}>
          {/* Search results */}
          {results.length > 0 && (
            <div style={{ padding: "0.5rem 0" }}>
              <div style={{ padding: "0 1rem 0.25rem", fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.5px" }}>
                Results
              </div>
              {results.map((result, idx) => (
                <button
                  key={`r-${result.entity_id}`}
                  onClick={() => navigate({ type: "result", ...result })}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.75rem",
                    width: "100%", padding: "0.5rem 1rem", border: "none",
                    background: selectedIndex === idx ? "var(--info-bg)" : "transparent",
                    cursor: "pointer", textAlign: "left", color: "var(--foreground)",
                    fontSize: "0.875rem",
                  }}
                >
                  <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>{ENTITY_ICONS[result.entity_type] || "\uD83D\uDCCB"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {result.display_name}
                    </div>
                    {result.subtitle && (
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {result.subtitle}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: "0.65rem", padding: "2px 6px", background: "var(--section-bg)", borderRadius: "4px", color: "var(--muted)", textTransform: "capitalize", flexShrink: 0 }}>
                    {result.entity_type}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Quick actions */}
          {filteredActions.length > 0 && (
            <div style={{ padding: "0.5rem 0", borderTop: results.length > 0 ? "1px solid var(--border)" : "none" }}>
              <div style={{ padding: "0 1rem 0.25rem", fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.5px" }}>
                {query ? "Actions" : "Quick Actions"}
              </div>
              {filteredActions.map((action, idx) => {
                const globalIdx = results.length + idx;
                return (
                  <button
                    key={action.id}
                    onClick={() => navigate({ type: "action", ...action })}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.75rem",
                      width: "100%", padding: "0.5rem 1rem", border: "none",
                      background: selectedIndex === globalIdx ? "var(--info-bg)" : "transparent",
                      cursor: "pointer", textAlign: "left", color: "var(--foreground)",
                      fontSize: "0.875rem",
                    }}
                  >
                    <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>{action.icon}</span>
                    <span style={{ flex: 1, fontWeight: 500 }}>{action.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {query.trim().length >= 2 && results.length === 0 && filteredActions.length === 0 && !loading && (
            <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--muted)", fontSize: "0.875rem" }}>
              No results found for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: "0.5rem 1rem", borderTop: "1px solid var(--border)",
          display: "flex", gap: "1rem", fontSize: "0.7rem", color: "var(--muted)",
        }}>
          <span><kbd style={{ padding: "1px 4px", border: "1px solid var(--border)", borderRadius: "3px", fontSize: "0.65rem" }}>{"\u2191\u2193"}</kbd> navigate</span>
          <span><kbd style={{ padding: "1px 4px", border: "1px solid var(--border)", borderRadius: "3px", fontSize: "0.65rem" }}>{"\u21B5"}</kbd> select</span>
          <span><kbd style={{ padding: "1px 4px", border: "1px solid var(--border)", borderRadius: "3px", fontSize: "0.65rem" }}>esc</kbd> close</span>
        </div>
      </div>
    </>
  );
}
