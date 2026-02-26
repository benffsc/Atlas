"use client";

import { useState, useEffect } from "react";

interface GoogleMapEntry {
  entry_id: string;
  kml_name: string | null;
  original_content: string | null;
  ai_summary: string | null;
  display_content: string | null;
  is_ai_summarized: boolean;
  parsed_cat_count: number | null;
  parsed_altered_count: number | null;
  parsed_date: string | null;
  parsed_trapper: string | null;
  match_status: string;
  imported_at: string;
}

interface GoogleMapContextCardProps {
  placeId: string;
  className?: string;
}

export function GoogleMapContextCard({ placeId, className = "" }: GoogleMapContextCardProps) {
  const [entries, setEntries] = useState<GoogleMapEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function fetchContext() {
      try {
        const res = await fetch(`/api/places/${placeId}/google-map-context`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setEntries(data.entries || []);
      } catch (err) {
        setError("Failed to load historical context");
      } finally {
        setLoading(false);
      }
    }
    fetchContext();
  }, [placeId]);

  if (loading) return null;
  if (error || entries.length === 0) return null;

  const displayEntries = expanded ? entries : entries.slice(0, 2);

  return (
    <div className={`bg-amber-50 border border-amber-200 rounded-lg p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <h3 className="font-medium text-amber-900">Google Maps History</h3>
        <span className="text-xs text-amber-600 ml-auto">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
      </div>

      <div className="space-y-3">
        {displayEntries.map((entry) => (
          <div key={entry.entry_id} className="bg-white rounded border border-amber-100 p-3">
            {entry.kml_name && (
              <div className="text-sm font-medium text-gray-900 mb-1">{entry.kml_name}</div>
            )}
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {(entry.display_content || entry.original_content || "")
                .replace(/<br\s*\/?>/gi, "\n")}
            </p>
            <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
              {entry.parsed_cat_count && (
                <span>{entry.parsed_cat_count} cats</span>
              )}
              {entry.parsed_altered_count != null && (
                <span className="text-green-600">{entry.parsed_altered_count} fixed</span>
              )}
              {entry.parsed_trapper && (
                <span>Trapper: {entry.parsed_trapper}</span>
              )}
              {entry.parsed_date && (
                <span>{new Date(entry.parsed_date).toLocaleDateString()}</span>
              )}
              {entry.is_ai_summarized && (
                <span className="text-cyan-600 bg-cyan-50 px-1.5 py-0.5 rounded">AI parsed</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {entries.length > 2 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 text-sm text-amber-700 hover:text-amber-900"
        >
          {expanded ? "Show less" : `Show ${entries.length - 2} more`}
        </button>
      )}

      <p className="text-xs text-amber-600 mt-3 italic">
        Historical notes from Google Maps, preserved for context.
        {entries.some(e => e.is_ai_summarized) && " Some entries summarized by AI."}
      </p>
    </div>
  );
}

// Compact version for person detail showing place context
interface PersonPlaceContextProps {
  personId: string;
  className?: string;
}

interface PersonPlaceContext {
  person_id: string;
  place_id: string;
  relationship_type: string;
  place_name: string;
  formatted_address: string;
  entry_id: string;
  context_preview: string;
  parsed_cat_count: number | null;
  is_ai_summarized: boolean;
}

export function PersonPlaceGoogleContext({ personId, className = "" }: PersonPlaceContextProps) {
  const [contexts, setContexts] = useState<PersonPlaceContext[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchContext() {
      try {
        const res = await fetch(`/api/people/${personId}/google-map-context`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setContexts(data.contexts || []);
      } catch {
        // Silently fail - this is supplementary info
      } finally {
        setLoading(false);
      }
    }
    fetchContext();
  }, [personId]);

  if (loading || contexts.length === 0) return null;

  // Group by place
  const byPlace = contexts.reduce((acc, ctx) => {
    if (!acc[ctx.place_id]) {
      acc[ctx.place_id] = {
        place_name: ctx.place_name,
        formatted_address: ctx.formatted_address,
        entries: []
      };
    }
    acc[ctx.place_id].entries.push(ctx);
    return acc;
  }, {} as Record<string, { place_name: string; formatted_address: string; entries: PersonPlaceContext[] }>);

  return (
    <div className={`bg-amber-50 border border-amber-200 rounded-lg p-4 ${className}`}>
      <h4 className="text-sm font-medium text-amber-900 mb-2">Location Context</h4>
      {Object.entries(byPlace).map(([placeId, place]) => (
        <div key={placeId} className="mb-3 last:mb-0">
          <div className="text-sm text-gray-700">
            <span className="font-medium">{place.place_name || place.formatted_address}</span>
          </div>
          {place.entries.slice(0, 1).map(entry => (
            <p key={entry.entry_id} className="text-sm text-gray-600 mt-1 italic">
              &ldquo;{entry.context_preview}&rdquo;
              {entry.is_ai_summarized && (
                <span className="text-xs text-amber-600 ml-1">(AI summarized)</span>
              )}
            </p>
          ))}
        </div>
      ))}
      <p className="text-xs text-amber-600 mt-2">From Google Maps history</p>
    </div>
  );
}
