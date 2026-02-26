'use client';

import { useState, useEffect } from 'react';

interface ReportDeceasedModalProps {
  isOpen: boolean;
  onClose: () => void;
  catId: string;
  catName: string;
  onSuccess?: () => void;
  // Optional: pre-populate from cat's linked places
  linkedPlaces?: Array<{ place_id: string; label: string }>;
}

const DEATH_CAUSES = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'natural', label: 'Natural causes (old age)' },
  { value: 'vehicle', label: 'Hit by vehicle' },
  { value: 'predator', label: 'Predator (dog, coyote, etc.)' },
  { value: 'disease', label: 'Disease / Illness' },
  { value: 'euthanasia', label: 'Euthanasia (humane)' },
  { value: 'injury', label: 'Injury (non-vehicle trauma)' },
  { value: 'starvation', label: 'Starvation / Malnutrition' },
  { value: 'weather', label: 'Weather exposure (heat/cold)' },
  { value: 'other', label: 'Other (specify in notes)' },
] as const;

const DATE_PRECISIONS = [
  { value: 'exact', label: 'Exact date known' },
  { value: 'week', label: 'Within a week' },
  { value: 'month', label: 'Within a month' },
  { value: 'estimated', label: 'Approximate / Estimated' },
] as const;

const AGE_CATEGORIES = [
  { value: '', label: 'Unknown', months: null },
  { value: 'kitten', label: 'Kitten (under 6 months)', months: 3 },
  { value: 'juvenile', label: 'Juvenile (6-12 months)', months: 9 },
  { value: 'young_adult', label: 'Young adult (1-3 years)', months: 24 },
  { value: 'adult', label: 'Adult (3-7 years)', months: 60 },
  { value: 'senior', label: 'Senior (7+ years)', months: 96 },
] as const;

export default function ReportDeceasedModal({
  isOpen,
  onClose,
  catId,
  catName,
  onSuccess,
  linkedPlaces = [],
}: ReportDeceasedModalProps) {
  const [deathDate, setDeathDate] = useState('');
  const [datePrecision, setDatePrecision] = useState('estimated');
  const [deathCause, setDeathCause] = useState('unknown');
  const [deathCauseNotes, setDeathCauseNotes] = useState('');
  const [ageCategory, setAgeCategory] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setDeathDate('');
      setDatePrecision('estimated');
      setDeathCause('unknown');
      setDeathCauseNotes('');
      setAgeCategory('');
      setPlaceId(linkedPlaces.length > 0 ? linkedPlaces[0].place_id : '');
      setNotes('');
      setError(null);
      setSuccess(false);
    }
  }, [isOpen, linkedPlaces]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // Find estimated age in months from category
      const ageCat = AGE_CATEGORIES.find(a => a.value === ageCategory);
      const estimatedAgeMonths = ageCat?.months ?? null;

      const response = await fetch(`/api/cats/${catId}/mortality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          death_date: deathDate || null,
          death_date_precision: datePrecision,
          death_cause: deathCause,
          death_cause_notes: deathCauseNotes.trim() || null,
          death_age_months: estimatedAgeMonths,
          place_id: placeId || null,
          notes: notes.trim() || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to report death');
      }

      setSuccess(true);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to report death');
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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary, #fff)',
          borderRadius: '8px',
          padding: '1.5rem',
          maxWidth: '500px',
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
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#dc3545' }}>
              Report Cat as Deceased
            </h2>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
              {catName}
            </p>
          </div>
          <button
            onClick={onClose}
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
        {success ? (
          <div>
            <div
              style={{
                background: '#f8d7da',
                border: '1px solid #f5c6cb',
                borderRadius: '6px',
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ fontWeight: 600, color: '#721c24', marginBottom: '0.5rem' }}>
                Record Updated
              </div>
              <div style={{ color: '#721c24', fontSize: '0.9rem' }}>
                {catName} has been marked as deceased. This information will be used for
                survival rate analysis.
              </div>
            </div>

            <button
              onClick={onClose}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: 'var(--primary, #6c757d)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Close
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

            {/* Death Cause - Required */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                Cause of Death <span style={{ color: '#dc3545' }}>*</span>
              </label>
              <select
                value={deathCause}
                onChange={(e) => setDeathCause(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  background: 'var(--bg-secondary, #fff)',
                }}
              >
                {DEATH_CAUSES.map((cause) => (
                  <option key={cause.value} value={cause.value}>
                    {cause.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Death Cause Notes - Conditional */}
            {(deathCause === 'other' || deathCause === 'disease' || deathCause === 'injury') && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                  Additional Details
                </label>
                <input
                  type="text"
                  value={deathCauseNotes}
                  onChange={(e) => setDeathCauseNotes(e.target.value)}
                  placeholder={
                    deathCause === 'disease' ? 'e.g., FeLV, FIV, respiratory' :
                    deathCause === 'injury' ? 'e.g., dog attack, fall' :
                    'Describe the cause...'
                  }
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border-color, #ddd)',
                    borderRadius: '4px',
                    fontSize: '1rem',
                  }}
                />
              </div>
            )}

            {/* Date Fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                  Date of Death
                </label>
                <input
                  type="date"
                  value={deathDate}
                  onChange={(e) => setDeathDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border-color, #ddd)',
                    borderRadius: '4px',
                    fontSize: '1rem',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                  Date Precision
                </label>
                <select
                  value={datePrecision}
                  onChange={(e) => setDatePrecision(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border-color, #ddd)',
                    borderRadius: '4px',
                    fontSize: '1rem',
                    background: 'var(--bg-secondary, #fff)',
                  }}
                >
                  {DATE_PRECISIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Age at Death */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                Approximate Age at Death
              </label>
              <select
                value={ageCategory}
                onChange={(e) => setAgeCategory(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border-color, #ddd)',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  background: 'var(--bg-secondary, #fff)',
                }}
              >
                {AGE_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                Used for survival rate calculations (kitten vs adult mortality)
              </div>
            </div>

            {/* Location - Optional */}
            {linkedPlaces.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                  Location (where found/reported)
                </label>
                <select
                  value={placeId}
                  onChange={(e) => setPlaceId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border-color, #ddd)',
                    borderRadius: '4px',
                    fontSize: '1rem',
                    background: 'var(--bg-secondary, #fff)',
                  }}
                >
                  <option value="">Unknown / Not specified</option>
                  {linkedPlaces.map((place) => (
                    <option key={place.place_id} value={place.place_id}>
                      {place.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Notes */}
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
                placeholder="Any additional context about the circumstances..."
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={onClose}
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
                  background: submitting ? '#6c757d' : '#dc3545',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontWeight: 500,
                }}
              >
                {submitting ? 'Reporting...' : 'Report Deceased'}
              </button>
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
              <strong>Why this matters:</strong> Mortality data helps calculate survival rates
              for population modeling. Kitten vs adult survival rates are key parameters in the
              Vortex population model used by Beacon.
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
