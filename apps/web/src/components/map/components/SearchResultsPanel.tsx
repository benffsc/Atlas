import { useEffect, useRef, useState } from "react";
import { MAP_COLORS } from "@/lib/map-colors";
import type {
  Place,
  GooglePin,
  Volunteer,
  AtlasSearchResult,
  PlacePrediction,
  TextSearchResult,
} from "@/components/map/types";

interface LocalResult {
  type: string;
  item: Place | GooglePin | Volunteer;
  label: string;
}

interface Props {
  searchResults: LocalResult[];
  atlasSearchResults: AtlasSearchResult[];
  googleSuggestions: PlacePrediction[];
  poiResults: TextSearchResult[];
  searchLoading: boolean;
  searchQuery: string;
  onSearchSelect: (r: LocalResult) => void;
  onAtlasSearchSelect: (r: AtlasSearchResult) => void;
  onGooglePlaceSelect: (p: PlacePrediction) => void;
  onPoiSelect: (r: TextSearchResult) => void;
  onStreetView: (lat: number, lng: number, address?: string) => void;
  onClearSearch: () => void;
  /** Keyboard nav: index of the highlighted item (-1 = none) */
  selectedIndex?: number;
  /** Called on mouse hover to sync keyboard highlight */
  onSelectedIndexChange?: (index: number) => void;
}

// ── Shared inline styles (kept for Google Maps InfoWindow compat) ──────────
const sectionHeader: React.CSSProperties = {
  padding: "8px 16px 4px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  background: "var(--section-bg)",
  borderBottom: "1px solid var(--border)",
};

const itemBase: React.CSSProperties = {
  padding: "10px 16px",
  cursor: "pointer",
  borderBottom: "1px solid var(--border-default)",
  display: "flex",
  alignItems: "center",
  gap: 12,
  transition: "background 0.1s",
};

const itemActive: React.CSSProperties = {
  ...itemBase,
  background: "var(--info-bg, rgba(59,130,246,0.06))",
};

const badge = (color: string): React.CSSProperties => ({
  fontSize: 10,
  fontWeight: 600,
  flexShrink: 0,
  padding: "1px 5px",
  borderRadius: 3,
  color,
});

const streetViewBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "4px 6px",
  fontSize: 14,
  color: "var(--text-secondary)",
  borderRadius: 4,
};

// Max visible items per section before truncation
const MAX_ATLAS = 5;
const MAX_ATLAS_EXPANDED = 15;
const MAX_GOOGLE = 3; // Combined POI + autocomplete
const MAX_GOOGLE_EXPANDED = 8;

const showMoreBtn: React.CSSProperties = {
  width: "100%",
  padding: "8px 16px",
  background: "none",
  border: "none",
  borderBottom: "1px solid var(--border-default)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--primary, #3b82f6)",
  textAlign: "center",
};

export function SearchResultsPanel({
  searchResults,
  atlasSearchResults,
  googleSuggestions,
  poiResults,
  searchLoading,
  searchQuery,
  onSearchSelect,
  onAtlasSearchSelect,
  onGooglePlaceSelect,
  onPoiSelect,
  onStreetView,
  onClearSearch,
  selectedIndex = -1,
  onSelectedIndexChange,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [atlasExpanded, setAtlasExpanded] = useState(false);
  const [googleExpanded, setGoogleExpanded] = useState(false);

  // Reset expanded state when query changes
  useEffect(() => {
    setAtlasExpanded(false);
    setGoogleExpanded(false);
  }, [searchQuery]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${selectedIndex}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // ── Build flat item list (sequential indices for keyboard nav) ──────────

  const atlasLimit = atlasExpanded ? MAX_ATLAS_EXPANDED : MAX_ATLAS;
  const googleLimit = googleExpanded ? MAX_GOOGLE_EXPANDED : MAX_GOOGLE;

  // Deduplicated atlas results (exclude already-loaded local matches)
  const allDedupedAtlas = atlasSearchResults
    .filter(
      (r, i, arr) =>
        !searchResults.some((sr) => sr.label === r.display_name) &&
        arr.findIndex((a) => a.entity_id === r.entity_id) === i,
    );
  const dedupedAtlas = allDedupedAtlas.slice(0, atlasLimit);
  const hasMoreAtlas = allDedupedAtlas.length > MAX_ATLAS;

  // Merge POI + Google autocomplete into one "Google Places" section
  const allCombinedGoogle: Array<{ kind: "poi"; data: TextSearchResult } | { kind: "autocomplete"; data: PlacePrediction }> = [];
  for (const r of poiResults) {
    allCombinedGoogle.push({ kind: "poi", data: r });
  }
  for (const s of googleSuggestions) {
    allCombinedGoogle.push({ kind: "autocomplete", data: s });
  }
  const combinedGoogle = allCombinedGoogle.slice(0, googleLimit);
  const hasMoreGoogle = allCombinedGoogle.length > MAX_GOOGLE;

  // Sequential flat index counter
  let idx = 0;
  const localStartIdx = idx;
  idx += searchResults.length;
  const atlasStartIdx = idx;
  idx += dedupedAtlas.length;
  const googleStartIdx = idx;
  idx += combinedGoogle.length;
  const totalItems = idx;

  const hasAtlasSection = searchResults.length > 0 || dedupedAtlas.length > 0;
  const hasGoogleSection = combinedGoogle.length > 0;
  const hasAnyResults = hasAtlasSection || hasGoogleSection;
  const showEmpty =
    searchQuery.length >= 3 && !searchLoading && !hasAnyResults;

  const itemStyle = (i: number) => (i === selectedIndex ? itemActive : itemBase);
  const hoverProps = (i: number) => ({
    onMouseEnter: () => onSelectedIndexChange?.(i),
  });

  return (
    <div
      ref={listRef}
      id="map-search-listbox"
      role="listbox"
      aria-label="Search results"
      style={{
        background: "var(--background)",
        borderRadius: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08)",
        marginTop: 8,
        maxHeight: 360,
        overflowY: "auto",
      }}
    >
      {/* ── In Atlas (local loaded + API results) ── */}
      {hasAtlasSection && (
        <>
          <div style={sectionHeader}>In Atlas</div>

          {searchResults.map((result, i) => {
            const flatIdx = localStartIdx + i;
            return (
              <div
                key={`local-${i}`}
                role="option"
                aria-selected={flatIdx === selectedIndex}
                data-idx={flatIdx}
                onClick={() => onSearchSelect(result)}
                style={itemStyle(flatIdx)}
                {...hoverProps(flatIdx)}
              >
                <span style={{ fontSize: 16 }}>
                  {result.type === "place" ? "📍" : result.type === "google_pin" ? "📌" : "⭐"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {result.label}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {result.type === "place" ? "Colony Site" : result.type === "google_pin" ? "Historical Pin" : "Volunteer"}
                  </div>
                </div>
                {result.item.lat && result.item.lng && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onStreetView(result.item.lat, result.item.lng, result.label); onClearSearch(); }}
                    style={streetViewBtn}
                    title="Street View"
                  >
                    📷
                  </button>
                )}
                <span style={badge(MAP_COLORS.layers.zones)}>LOADED</span>
              </div>
            );
          })}

          {dedupedAtlas.map((result, i) => {
            const flatIdx = atlasStartIdx + i;
            const icon = result.entity_type === "person" ? "👤" : result.entity_type === "cat" ? "🐱" : "📍";
            const badgeLabel = result.entity_type === "person" ? "PERSON" : result.entity_type === "cat" ? "CAT" : "PLACE";
            const badgeColor = result.metadata?.lat ? "var(--primary)" : "var(--text-tertiary)";
            return (
              <div
                key={`atlas-${result.entity_id}`}
                role="option"
                aria-selected={flatIdx === selectedIndex}
                data-idx={flatIdx}
                onClick={() => onAtlasSearchSelect(result)}
                style={itemStyle(flatIdx)}
                {...hoverProps(flatIdx)}
              >
                <span style={{ fontSize: 16 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {result.display_name}
                  </div>
                  {result.subtitle && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {result.subtitle}
                    </div>
                  )}
                </div>
                {result.metadata?.lat && result.metadata?.lng && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onStreetView(result.metadata!.lat!, result.metadata!.lng!, result.display_name); onClearSearch(); }}
                    style={streetViewBtn}
                    title="Street View"
                  >
                    📷
                  </button>
                )}
                <span style={badge(badgeColor)}>
                  {badgeLabel}
                  {!result.metadata?.lat && " ↗"}
                </span>
              </div>
            );
          })}

          {hasMoreAtlas && (
            <button
              onClick={() => setAtlasExpanded(!atlasExpanded)}
              style={showMoreBtn}
            >
              {atlasExpanded ? `Show less` : `Show more (${allDedupedAtlas.length} total)`}
            </button>
          )}
        </>
      )}

      {/* ── Google Places (merged POI + autocomplete) ── */}
      {hasGoogleSection && (
        <>
          <div style={{ ...sectionHeader, marginTop: hasAtlasSection ? 4 : 0 }}>
            Google Places
          </div>
          {combinedGoogle.map((entry, i) => {
            const flatIdx = googleStartIdx + i;
            if (entry.kind === "poi") {
              const result = entry.data;
              return (
                <div
                  key={`poi-${result.place_id}`}
                  role="option"
                  aria-selected={flatIdx === selectedIndex}
                  data-idx={flatIdx}
                  onClick={() => onPoiSelect(result)}
                  style={itemStyle(flatIdx)}
                  {...hoverProps(flatIdx)}
                >
                  <span style={{ fontSize: 16 }}>🏪</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {result.name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {result.formatted_address}
                    </div>
                  </div>
                  <span style={badge(MAP_COLORS.layers.places)}>PLACE</span>
                </div>
              );
            }
            const suggestion = entry.data;
            return (
              <div
                key={`google-${suggestion.place_id}`}
                role="option"
                aria-selected={flatIdx === selectedIndex}
                data-idx={flatIdx}
                onClick={() => onGooglePlaceSelect(suggestion)}
                style={itemStyle(flatIdx)}
                {...hoverProps(flatIdx)}
              >
                <span style={{ fontSize: 16 }}>🌐</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {suggestion.structured_formatting.main_text}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {suggestion.structured_formatting.secondary_text}
                  </div>
                </div>
                <span style={badge(MAP_COLORS.trapperType.community_trapper)}>GOOGLE</span>
              </div>
            );
          })}

          {hasMoreGoogle && (
            <button
              onClick={() => setGoogleExpanded(!googleExpanded)}
              style={showMoreBtn}
            >
              {googleExpanded ? `Show less` : `Show more (${allCombinedGoogle.length} total)`}
            </button>
          )}
        </>
      )}

      {/* ── Loading skeleton ── */}
      {searchLoading && !hasAnyResults && (
        <div style={{ padding: "4px 0" }}>
          {[1, 2, 3].map((n) => (
            <div key={n} style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: "var(--border-default)",
                  animation: "map-shimmer 1.5s infinite linear",
                  backgroundSize: "200% 100%",
                  backgroundImage: "linear-gradient(90deg, var(--border-default) 25%, var(--bg-secondary) 50%, var(--border-default) 75%)",
                }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    height: 14, width: "70%", borderRadius: 4, marginBottom: 4,
                    background: "var(--border-default)",
                    animation: "map-shimmer 1.5s infinite linear",
                    backgroundSize: "200% 100%",
                    backgroundImage: "linear-gradient(90deg, var(--border-default) 25%, var(--bg-secondary) 50%, var(--border-default) 75%)",
                  }}
                />
                <div
                  style={{
                    height: 10, width: "45%", borderRadius: 4,
                    background: "var(--border-default)",
                    animation: "map-shimmer 1.5s infinite linear",
                    backgroundSize: "200% 100%",
                    backgroundImage: "linear-gradient(90deg, var(--border-default) 25%, var(--bg-secondary) 50%, var(--border-default) 75%)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {showEmpty && (
        <div style={{ padding: "20px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
          <div style={{ fontSize: 14, marginBottom: 6 }}>
            No results for &ldquo;{searchQuery}&rdquo;
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            Try a street address, place name, or person
          </div>
        </div>
      )}

      {/* ── Screen reader item count ── */}
      {totalItems > 0 && (
        <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
          {totalItems} result{totalItems !== 1 ? "s" : ""} available
        </div>
      )}
    </div>
  );
}
