'use client';

import { useState } from 'react';

interface LogObservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  placeId: string;
  placeName: string;
  onSuccess?: () => void;
  isCompletionFlow?: boolean;  // If true, show as completion prompt
  onSkip?: () => void;         // Callback for skipping observation
}

interface ObservationResult {
  success: boolean;
  observation: {
    estimate_id: string;
    total_cats_observed: number;
    eartip_count_observed: number;
    observation_date: string;
  };
  chapman_estimate: number | null;
  message: string;
}

const TIME_OF_DAY_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'morning', label: 'Morning (6am-12pm)' },
  { value: 'afternoon', label: 'Afternoon (12pm-5pm)' },
  { value: 'evening', label: 'Evening (5pm-9pm)' },
  { value: 'night', label: 'Night (9pm-6am)' },
];

export default function LogObservationModal({
  isOpen,
  onClose,
  placeId,
  placeName,
  onSuccess,
  isCompletionFlow = false,
  onSkip,
}: LogObservationModalProps) {
  const [catsSeen, setCatsSeen] = useState<number | ''>('');
  const [eartipsSeen, setEartipsSeen] = useState<number | ''>('');
  const [timeOfDay, setTimeOfDay] = useState('');
  const [atFeedingStation, setAtFeedingStation] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ObservationResult | null>(null);

  const resetForm = () => {
    setCatsSeen('');
    setEartipsSeen('');
    setTimeOfDay('');
    setAtFeedingStation(false);
    setNotes('');
    setError(null);
    setResult(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (catsSeen === '' || catsSeen < 0) {
      setError('Please enter the number of cats seen');
      return;
    }
    if (eartipsSeen === '' || eartipsSeen < 0) {
      setError('Please enter the number of ear-tipped cats seen');
      return;
    }
    if (Number(eartipsSeen) > Number(catsSeen)) {
      setError('Ear-tipped cats cannot exceed total cats seen');
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`/api/places/${placeId}/observations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cats_seen: Number(catsSeen),
          eartips_seen: Number(eartipsSeen),
          time_of_day: timeOfDay || undefined,
          at_feeding_station: atFeedingStation || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to log observation');
      }

      const data: ObservationResult = await response.json();
      setResult(data);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log observation');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary, #fff)',
          borderRadius: '8px',
          padding: '1.5rem',
          maxWidth: '480px',
          width: '90%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>{isCompletionFlow ? 'Final Site Observation' : 'Log Site Observation'}</span>
            </h2>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
              {placeName}
            </p>
            {isCompletionFlow && (
              <p style={{ margin: '0.5rem 0 0', color: '#198754', fontSize: '0.85rem', fontWeight: 500 }}>
                Before completing this request, log a final observation to capture the post-TNR colony state.
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              cursor: 'pointer',
              color: 'var(--muted)',
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Success State */}
        {result ? (
          <div>
            <div
              style={{
                background: '#d4edda',
                border: '1px solid #c3e6cb',
                borderRadius: '6px',
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ fontWeight: 600, color: '#155724', marginBottom: '0.5rem' }}>
                Observation Logged
              </div>
              <div style={{ color: '#155724', fontSize: '0.9rem' }}>
                Recorded {result.observation.total_cats_observed} cats seen, {result.observation.eartip_count_observed} with ear tips
              </div>
            </div>

            {result.chapman_estimate && (
              <div
                style={{
                  background: '#e3f2fd',
                  border: '1px solid #90caf9',
                  borderRadius: '6px',
                  padding: '1rem',
                  marginBottom: '1rem',
                }}
              >
                <div style={{ fontWeight: 600, color: '#1565c0', marginBottom: '0.25rem' }}>
                  Chapman Population Estimate
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1565c0' }}>
                  ~{result.chapman_estimate} cats
                </div>
                <div style={{ color: '#1976d2', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  Based on mark-resight calculation using clinic data
                </div>
              </div>
            )}

            <button
              onClick={handleClose}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: isCompletionFlow ? '#198754' : 'var(--primary, #0d6efd)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              {isCompletionFlow ? 'Complete Request' : 'Done'}
            </button>
          </div>
        ) : (
          /* Form State */
          <form onSubmit={handleSubmit}>
            {error && (
              <div
                style={{
                  background: '#f8d7da',
                  border: '1px solid #f5c6cb',
                  color: '#721c24',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  marginBottom: '1rem',
                  fontSize: '0.9rem',
                }}
              >
                {error}
              </div>
            )}

            {/* Required Fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                  Total Cats Seen <span style={{ color: '#dc3545' }}>*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  value={catsSeen}
                  onChange={(e) => setCatsSeen(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border-color, #ddd)',
                    borderRadius: '4px',
                    fontSize: '1rem',
                  }}
                  placeholder="0"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                  Ear-Tipped Cats <span style={{ color: '#dc3545' }}>*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  value={eartipsSeen}
                  onChange={(e) => setEartipsSeen(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border-color, #ddd)',
                    borderRadius: '4px',
                    fontSize: '1rem',
                  }}
                  placeholder="0"
                  required
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                  Cats with left ear tip (indicates fixed)
                </div>
              </div>
            </div>

            {/* Optional Fields */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                Time of Day
              </label>
              <select
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  background: 'var(--bg-secondary, #fff)',
                }}
              >
                {TIME_OF_DAY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={atFeedingStation}
                  onChange={(e) => setAtFeedingStation(e.target.checked)}
                  style={{ width: '1rem', height: '1rem' }}
                />
                <span style={{ fontWeight: 500 }}>Observed at feeding station/time</span>
              </label>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: '1.5rem' }}>
                Cats are more likely to be visible during feeding
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: '4px',
                  fontSize: '0.9rem',
                  resize: 'vertical',
                }}
                placeholder="e.g., 3 unfixed males seen near barn"
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', flexDirection: isCompletionFlow ? 'column' : 'row' }}>
              {isCompletionFlow ? (
                <>
                  <button
                    type="submit"
                    disabled={submitting}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: submitting ? '#6c757d' : '#198754',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: submitting ? 'not-allowed' : 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {submitting ? 'Saving...' : 'Log Observation & Complete Request'}
                  </button>
                  <button
                    type="button"
                    onClick={onSkip}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: 'var(--bg-tertiary, #f5f5f5)',
                      color: 'var(--text, #666)',
                      border: '1px solid var(--border-color, #ddd)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 500,
                      fontSize: '0.9rem',
                    }}
                    disabled={submitting}
                  >
                    Skip & Complete Without Observation
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleClose}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background: 'var(--bg-tertiary, #f5f5f5)',
                      color: 'var(--text, #333)',
                      border: '1px solid var(--border-color, #ddd)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background: submitting ? '#6c757d' : 'var(--primary, #28a745)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: submitting ? 'not-allowed' : 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {submitting ? 'Saving...' : 'Log Observation'}
                  </button>
                </>
              )}
            </div>

            {/* Help Text */}
            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem',
                background: 'var(--bg-tertiary, #f9f9f9)',
                borderRadius: '6px',
                fontSize: '0.8rem',
                color: 'var(--muted)',
              }}
            >
              <strong>Why this matters:</strong> Observation data enables the Chapman mark-resight estimator
              to calculate colony population size. Clinic data provides the known altered count (M), and your
              observation provides cats seen (C) and ear-tipped seen (R).
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
