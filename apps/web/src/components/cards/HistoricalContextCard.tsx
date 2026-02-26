'use client';

import { useState, useEffect } from 'react';

/**
 * Historical Context Card
 *
 * Displays historical qualitative data for a place:
 * - Quasi-quantitative summary (TNR counts, colony sizes)
 * - Date range of activity
 * - Qualitative signals (temperament, relocated, etc.)
 * - Summarized notes with attribution
 *
 * Data sources:
 * - Legacy KML imports
 * - Parsed request/intake notes
 * - Historical colony estimates
 */

interface NoteEntry {
  date: string | null;
  source: string;
  text: string;
  attribution: string[];
}

interface HistoricalContext {
  place_id: string;
  place_name: string | null;
  historical_tnr_total: number | null;
  historical_colony_sizes: number[];
  date_range: {
    earliest: string | null;
    latest: string | null;
  };
  signals: string[];
  notes_summary: NoteEntry[];
}

// Signal display configuration
const SIGNAL_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  temperament: { label: 'Temperament noted', emoji: '😺', color: 'bg-blue-100 text-blue-800' },
  relocated: { label: 'Relocated/moved', emoji: '📦', color: 'bg-yellow-100 text-yellow-800' },
  pregnant: { label: 'Pregnant/nursing', emoji: '🤱', color: 'bg-pink-100 text-pink-800' },
  kittens: { label: 'Kittens present', emoji: '🐱', color: 'bg-orange-100 text-orange-800' },
  complete: { label: 'Colony complete', emoji: '✅', color: 'bg-green-100 text-green-800' },
  mortality: { label: 'Mortality noted', emoji: '🕊️', color: 'bg-gray-100 text-gray-800' },
  adopted: { label: 'Adoptions', emoji: '🏠', color: 'bg-purple-100 text-purple-800' },
};

// Staff abbreviation tooltips
const STAFF_TOOLTIPS: Record<string, string> = {
  'MP': 'Previous coordinator',
  'JK': 'Jami',
  'HF': 'Heidi',
  'DF': 'Diane',
};

interface Props {
  placeId: string;
  className?: string;
}

export function HistoricalContextCard({ placeId, className = '' }: Props) {
  const [data, setData] = useState<HistoricalContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function fetchHistory() {
      try {
        setLoading(true);
        const res = await fetch(`/api/places/${placeId}/history`);
        if (!res.ok) {
          if (res.status === 404) {
            setData(null);
            return;
          }
          throw new Error('Failed to fetch history');
        }
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    if (placeId) {
      fetchHistory();
    }
  }, [placeId]);

  if (loading) {
    return (
      <div className={`bg-amber-50 border border-amber-200 rounded-lg p-4 ${className}`}>
        <div className="animate-pulse">
          <div className="h-4 bg-amber-200 rounded w-1/3 mb-2"></div>
          <div className="h-3 bg-amber-100 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return null; // Silently hide on error
  }

  if (!data || (data.notes_summary.length === 0 && !data.historical_tnr_total && data.signals.length === 0)) {
    return null; // No historical data to show
  }

  const hasQuantitativeData = data.historical_tnr_total || data.historical_colony_sizes.length > 0;
  const hasDateRange = data.date_range.earliest && data.date_range.latest;

  return (
    <div className={`bg-amber-50 border border-amber-200 rounded-lg ${className}`}>
      {/* Header */}
      <div
        className="p-4 cursor-pointer hover:bg-amber-100 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">📜</span>
            <h3 className="font-medium text-amber-900">Historical Context</h3>
            <span className="text-xs text-amber-500" title="Data from legacy sources - may be from nearby locations">
              (nearby activity)
            </span>
          </div>
          <button className="text-amber-600 hover:text-amber-800">
            {expanded ? '▲' : '▼'}
          </button>
        </div>

        {/* Quick summary line */}
        <div className="mt-1 text-sm text-amber-700">
          {hasDateRange && (
            <span>
              Activity from {data.date_range.earliest} to {data.date_range.latest}
            </span>
          )}
          {hasQuantitativeData && (
            <span className="ml-2">
              {data.historical_tnr_total && `• ${data.historical_tnr_total} cats TNR'd`}
              {data.historical_colony_sizes.length > 0 && ` • Colony size: ${data.historical_colony_sizes[0]}`}
            </span>
          )}
        </div>

        {/* Signal badges - always visible */}
        {data.signals.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {data.signals.map((signal) => {
              const config = SIGNAL_CONFIG[signal] || {
                label: signal,
                emoji: '📌',
                color: 'bg-gray-100 text-gray-800',
              };
              return (
                <span
                  key={signal}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${config.color}`}
                  title={config.label}
                >
                  <span>{config.emoji}</span>
                  <span>{config.label}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-amber-200 p-4">
          {/* Quantitative summary */}
          {hasQuantitativeData && (
            <div className="mb-4 p-3 bg-white rounded border border-amber-100">
              <h4 className="text-xs font-medium text-amber-800 uppercase tracking-wide mb-2">
                Historical Numbers
              </h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {data.historical_tnr_total && (
                  <div>
                    <span className="text-amber-600">Total TNR'd:</span>
                    <span className="ml-2 font-medium">{data.historical_tnr_total}</span>
                  </div>
                )}
                {data.historical_colony_sizes.length > 0 && (
                  <div>
                    <span className="text-amber-600">Colony sizes reported:</span>
                    <span className="ml-2 font-medium">
                      {data.historical_colony_sizes.slice(0, 3).join(', ')}
                      {data.historical_colony_sizes.length > 3 && '...'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes timeline */}
          {data.notes_summary.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-amber-800 uppercase tracking-wide mb-2">
                Historical Notes
              </h4>
              <div className="space-y-3">
                {data.notes_summary.map((note, idx) => (
                  <div key={idx} className="text-sm border-l-2 border-amber-300 pl-3">
                    <div className="flex items-center gap-2 text-xs text-amber-600 mb-1 flex-wrap">
                      {note.date && <span>{note.date}</span>}
                      <span className="text-amber-400">•</span>
                      <span className="capitalize">
                        {note.source.replace(' (AI paraphrased)', '')}
                      </span>
                      {note.source.includes('AI') && (
                        <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs">
                          AI paraphrased
                        </span>
                      )}
                      {note.attribution.length > 0 && (
                        <>
                          <span className="text-amber-400">•</span>
                          <span className="flex gap-1">
                            {note.attribution.map((initials) => (
                              <span
                                key={initials}
                                className="bg-amber-200 px-1 rounded"
                                title={STAFF_TOOLTIPS[initials] || initials}
                              >
                                {initials}
                              </span>
                            ))}
                          </span>
                        </>
                      )}
                    </div>
                    <p className="text-amber-900">{note.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data source disclaimer */}
          <div className="mt-4 p-3 bg-amber-100/50 rounded border border-amber-200">
            <p className="text-xs text-amber-600">
              <strong>Note:</strong> Historical data is from legacy sources (Google Maps, request notes).
              {data.notes_summary.some(n => n.source.includes('AI')) && (
                <span> Some notes have been paraphrased by AI for clarity while preserving attribution.</span>
              )}
              {' '}Location matching is based on coordinates and may include nearby activity within ~50m.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default HistoricalContextCard;
