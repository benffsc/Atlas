import { MAP_COLORS } from "@/lib/map-colors";
import type { Place, GooglePin, Volunteer, AtlasSearchResult, PlacePrediction, TextSearchResult } from "@/components/map/types";

interface LocalResult { type: string; item: Place | GooglePin | Volunteer; label: string; }
interface Props { searchResults: LocalResult[]; atlasSearchResults: AtlasSearchResult[]; googleSuggestions: PlacePrediction[]; poiResults: TextSearchResult[]; searchLoading: boolean; searchQuery: string; onSearchSelect: (r: LocalResult) => void; onAtlasSearchSelect: (r: AtlasSearchResult) => void; onGooglePlaceSelect: (p: PlacePrediction) => void; onPoiSelect: (r: TextSearchResult) => void; onStreetView: (lat: number, lng: number, address?: string) => void; onClearSearch: () => void; }

export function SearchResultsPanel({ searchResults, atlasSearchResults, googleSuggestions, poiResults, searchLoading, searchQuery, onSearchSelect, onAtlasSearchSelect, onGooglePlaceSelect, onPoiSelect, onStreetView, onClearSearch }: Props) {
  return (
    <div style={{ background: "var(--background)", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", marginTop: 8, maxHeight: 400, overflowY: "auto" }}>
      {(searchResults.length > 0 || atlasSearchResults.length > 0) && (<>
        <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", background: "var(--section-bg)", borderBottom: "1px solid var(--border)" }}>In Atlas</div>
        {searchResults.map((result, i) => (
          <div key={`local-${i}`} onClick={() => onSearchSelect(result)} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: 12 }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--healthy-bg)")} onMouseLeave={(e) => (e.currentTarget.style.background = "var(--background)")}>
            <span style={{ fontSize: 16 }}>{result.type === "place" ? "🐱" : result.type === "google_pin" ? "📍" : "⭐"}</span>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 500, fontSize: 14 }}>{result.label}</div><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{result.type === "place" ? "Colony Site" : result.type === "google_pin" ? "Historical Pin" : "Volunteer"}</div></div>
            {result.item.lat && result.item.lng && (<button onClick={(e) => { e.stopPropagation(); onStreetView(result.item.lat, result.item.lng, result.label); onClearSearch(); }} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", fontSize: 14, color: "var(--text-secondary)", borderRadius: 4 }} title="Street View" onMouseEnter={(e) => (e.currentTarget.style.color = "var(--warning-text)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}>📷</button>)}
            <span style={{ fontSize: 10, color: MAP_COLORS.layers.zones, fontWeight: 500 }}>LOADED</span>
          </div>
        ))}
        {atlasSearchResults.filter((r, i, arr) => !searchResults.some(sr => sr.label === r.display_name) && arr.findIndex(a => a.entity_id === r.entity_id) === i).map((result, i) => (
          <div key={`atlas-${i}`} onClick={() => onAtlasSearchSelect(result)} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: 12 }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--info-bg)")} onMouseLeave={(e) => (e.currentTarget.style.background = "var(--background)")}>
            <span style={{ fontSize: 16 }}>{result.entity_type === "person" ? "👤" : result.entity_type === "cat" ? "🐱" : "📍"}</span>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 500, fontSize: 14 }}>{result.display_name}</div>{result.subtitle && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{result.subtitle}</div>}</div>
            {result.metadata?.lat && result.metadata?.lng && (<button onClick={(e) => { e.stopPropagation(); onStreetView(result.metadata!.lat!, result.metadata!.lng!, result.display_name); onClearSearch(); }} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", fontSize: 14, color: "var(--text-secondary)", borderRadius: 4 }} title="Street View" onMouseEnter={(e) => (e.currentTarget.style.color = "var(--warning-text)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}>📷</button>)}
            <span style={{ fontSize: 10, color: result.metadata?.lat ? "var(--primary)" : "var(--text-tertiary)", fontWeight: 500 }}>{result.entity_type === "person" ? "PERSON" : result.entity_type === "cat" ? "CAT" : "PLACE"}{!result.metadata?.lat && " (detail)"}</span>
          </div>
        ))}
      </>)}
      {poiResults.length > 0 && (<>
        <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", background: "var(--section-bg)", borderBottom: "1px solid var(--border)", marginTop: searchResults.length > 0 || atlasSearchResults.length > 0 ? 8 : 0 }}>Nearby Places</div>
        {poiResults.map((result, i) => (
          <div key={`poi-${i}`} onClick={() => onPoiSelect(result)} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: 12 }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--info-bg)")} onMouseLeave={(e) => (e.currentTarget.style.background = "var(--background)")}>
            <span style={{ fontSize: 16 }}>🏪</span><div style={{ flex: 1 }}><div style={{ fontWeight: 500, fontSize: 14 }}>{result.name}</div><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{result.formatted_address}</div></div>
            <span style={{ fontSize: 10, color: MAP_COLORS.layers.places, fontWeight: 500 }}>PLACE</span>
          </div>
        ))}
      </>)}
      {googleSuggestions.length > 0 && (<>
        <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", background: "var(--section-bg)", borderBottom: "1px solid var(--border)", marginTop: searchResults.length > 0 || atlasSearchResults.length > 0 || poiResults.length > 0 ? 8 : 0 }}>Search All Addresses</div>
        {googleSuggestions.map((s, i) => (
          <div key={`google-${i}`} onClick={() => onGooglePlaceSelect(s)} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: i < googleSuggestions.length - 1 ? "1px solid var(--border-default)" : "none", display: "flex", alignItems: "center", gap: 12 }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--warning-bg)")} onMouseLeave={(e) => (e.currentTarget.style.background = "var(--background)")}>
            <span style={{ fontSize: 16 }}>📍</span><div style={{ flex: 1 }}><div style={{ fontWeight: 500, fontSize: 14 }}>{s.structured_formatting.main_text}</div><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.structured_formatting.secondary_text}</div></div>
            <span style={{ fontSize: 10, color: MAP_COLORS.trapperType.community_trapper, fontWeight: 500 }}>GOOGLE</span>
          </div>
        ))}
      </>)}
      {searchLoading && (<div style={{ padding: "4px 0" }}>{[1,2,3].map(n => (<div key={n} style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}><div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--border-default)", animation: "map-shimmer 1.5s infinite linear", backgroundSize: "200% 100%", backgroundImage: "linear-gradient(90deg, var(--border-default) 25%, var(--bg-secondary) 50%, var(--border-default) 75%)" }} /><div style={{ flex: 1 }}><div style={{ height: 14, width: "70%", borderRadius: 4, background: "var(--border-default)", marginBottom: 4, animation: "map-shimmer 1.5s infinite linear", backgroundSize: "200% 100%", backgroundImage: "linear-gradient(90deg, var(--border-default) 25%, var(--bg-secondary) 50%, var(--border-default) 75%)" }} /><div style={{ height: 10, width: "45%", borderRadius: 4, background: "var(--border-default)", animation: "map-shimmer 1.5s infinite linear", backgroundSize: "200% 100%", backgroundImage: "linear-gradient(90deg, var(--border-default) 25%, var(--bg-secondary) 50%, var(--border-default) 75%)" }} /></div></div>))}</div>)}
      {searchQuery.length >= 3 && !searchLoading && searchResults.length === 0 && atlasSearchResults.length === 0 && googleSuggestions.length === 0 && poiResults.length === 0 && (<div style={{ padding: "16px", textAlign: "center", color: "var(--text-secondary)" }}><div style={{ fontSize: 14, marginBottom: 4 }}>No matches found</div><div style={{ fontSize: 12 }}>Try a different search term</div></div>)}
    </div>
  );
}
