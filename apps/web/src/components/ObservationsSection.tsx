'use client';

import { useState, useEffect } from 'react';
import LogObservationModal from './LogObservationModal';
import { formatRelativeDate } from '@/lib/formatters';

interface Observation {
  estimate_id: string;
  total_cats_observed: number;
  eartip_count_observed: number;
  observation_time_of_day: string | null;
  is_at_feeding_station: boolean | null;
  observation_date: string;
  notes: string | null;
  reporter_name: string | null;
  created_at: string;
}

interface ObservationsSectionProps {
  placeId: string;
  placeName: string;
  className?: string;
}

const TIME_OF_DAY_LABELS: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};

// Use centralized formatRelativeDate from @/lib/formatters
const formatDate = formatRelativeDate;

export default function ObservationsSection({
  placeId,
  placeName,
  className = '',
}: ObservationsSectionProps) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchObservations = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/places/${placeId}/observations`);
      if (!res.ok) throw new Error('Failed to fetch observations');
      const data = await res.json();
      setObservations(data.observations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (placeId) {
      fetchObservations();
    }
  }, [placeId]);

  const handleObservationAdded = () => {
    fetchObservations();
  };

  if (loading) {
    return (
      <div className={`bg-slate-50 border border-slate-200 rounded-lg p-4 ${className}`}>
        <div className="animate-pulse">
          <div className="h-4 bg-slate-200 rounded w-1/3 mb-2"></div>
          <div className="h-3 bg-slate-100 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return null; // Silently hide on error
  }

  const displayedObservations = expanded ? observations : observations.slice(0, 3);

  return (
    <div className={`bg-slate-50 border border-slate-200 rounded-lg ${className}`}>
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">👁️</span>
          <h3 className="font-medium text-slate-900">Site Observations</h3>
          <span className="text-xs text-slate-500">
            ({observations.length} total)
          </span>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            background: '#28a745',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            padding: '0.375rem 0.75rem',
            fontSize: '0.85rem',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}
        >
          <span>+</span>
          <span>Log Visit</span>
        </button>
      </div>

      {/* Observations List */}
      {observations.length === 0 ? (
        <div className="border-t border-slate-200 p-4">
          <p className="text-sm text-slate-500 text-center">
            No observations recorded yet. Log a site visit to help estimate colony size.
          </p>
        </div>
      ) : (
        <div className="border-t border-slate-200">
          {displayedObservations.map((obs, idx) => (
            <div
              key={obs.estimate_id}
              className={`p-3 ${idx > 0 ? 'border-t border-slate-100' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {/* Cat count badges */}
                  <div className="flex gap-1">
                    <span
                      style={{
                        background: '#e3f2fd',
                        color: '#1565c0',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '999px',
                        fontSize: '0.8rem',
                        fontWeight: 500,
                      }}
                    >
                      {obs.total_cats_observed} seen
                    </span>
                    <span
                      style={{
                        background: obs.eartip_count_observed > 0 ? '#e8f5e9' : '#f5f5f5',
                        color: obs.eartip_count_observed > 0 ? '#2e7d32' : '#757575',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '999px',
                        fontSize: '0.8rem',
                        fontWeight: 500,
                      }}
                    >
                      {obs.eartip_count_observed} tipped
                    </span>
                  </div>

                  {/* Time/feeding info */}
                  {(obs.observation_time_of_day || obs.is_at_feeding_station) && (
                    <div className="text-xs text-slate-500">
                      {obs.observation_time_of_day && TIME_OF_DAY_LABELS[obs.observation_time_of_day]}
                      {obs.observation_time_of_day && obs.is_at_feeding_station && ' • '}
                      {obs.is_at_feeding_station && 'At feeding'}
                    </div>
                  )}
                </div>

                {/* Date and reporter */}
                <div className="text-right">
                  <div className="text-xs text-slate-600">{formatDate(obs.observation_date)}</div>
                  {obs.reporter_name && (
                    <div className="text-xs text-slate-400">{obs.reporter_name}</div>
                  )}
                </div>
              </div>

              {/* Notes */}
              {obs.notes && (
                <p className="text-sm text-slate-600 mt-1 italic">&quot;{obs.notes}&quot;</p>
              )}

              {/* Alteration ratio */}
              {obs.total_cats_observed > 0 && (
                <div className="mt-1">
                  <div className="text-xs text-slate-500">
                    {Math.round((obs.eartip_count_observed / obs.total_cats_observed) * 100)}% appeared altered
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Expand/collapse */}
          {observations.length > 3 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full p-2 text-sm text-slate-600 hover:bg-slate-100 transition-colors border-t border-slate-200"
            >
              {expanded ? 'Show less' : `Show ${observations.length - 3} more`}
            </button>
          )}
        </div>
      )}

      {/* Help text */}
      <div className="border-t border-slate-200 p-3 bg-slate-100/50">
        <p className="text-xs text-slate-500">
          Site observations help estimate colony size using the Chapman mark-resight method.
          Regular observations improve accuracy.
        </p>
      </div>

      {/* Modal */}
      <LogObservationModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        placeId={placeId}
        placeName={placeName}
        onSuccess={handleObservationAdded}
      />
    </div>
  );
}
