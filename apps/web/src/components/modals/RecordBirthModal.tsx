'use client';

import { useState, useEffect } from 'react';

interface RecordBirthModalProps {
  isOpen: boolean;
  onClose: () => void;
  catId: string;
  catName: string;
  onSuccess?: () => void;
  linkedPlaces?: Array<{ place_id: string; label: string }>;
  existingBirthEvent?: {
    birth_event_id: string;
    birth_date: string | null;
    birth_date_precision: string;
    birth_year: number | null;
    birth_month: number | null;
    birth_season: string | null;
    place_id: string | null;
    kitten_count_in_litter: number | null;
    survived_to_weaning: boolean | null;
    mother_cat_id: string | null;
    notes: string | null;
  } | null;
}

const DATE_PRECISIONS = [
  { value: 'exact', label: 'Exact date known' },
  { value: 'week', label: 'Within a week' },
  { value: 'month', label: 'Within a month' },
  { value: 'season', label: 'Season only' },
  { value: 'year', label: 'Year only' },
  { value: 'estimated', label: 'Estimated from age' },
] as const;

const SEASONS = [
  { value: '', label: 'Unknown' },
  { value: 'spring', label: 'Spring (Mar-May)' },
  { value: 'summer', label: 'Summer (Jun-Aug)' },
  { value: 'fall', label: 'Fall (Sep-Nov)' },
  { value: 'winter', label: 'Winter (Dec-Feb)' },
] as const;

const MONTHS = [
  { value: '', label: 'Unknown' },
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
] as const;

export default function RecordBirthModal({
  isOpen,
  onClose,
  catId,
  catName,
  onSuccess,
  linkedPlaces = [],
  existingBirthEvent,
}: RecordBirthModalProps) {
  const [birthDate, setBirthDate] = useState('');
  const [datePrecision, setDatePrecision] = useState('estimated');
  const [birthYear, setBirthYear] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [birthSeason, setBirthSeason] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [kittenCount, setKittenCount] = useState('');
  const [survivedToWeaning, setSurvivedToWeaning] = useState<boolean | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isEditing = !!existingBirthEvent;

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      if (existingBirthEvent) {
        setBirthDate(existingBirthEvent.birth_date || '');
        setDatePrecision(existingBirthEvent.birth_date_precision || 'estimated');
        setBirthYear(existingBirthEvent.birth_year?.toString() || '');
        setBirthMonth(existingBirthEvent.birth_month?.toString() || '');
        setBirthSeason(existingBirthEvent.birth_season || '');
        setPlaceId(existingBirthEvent.place_id || '');
        setKittenCount(existingBirthEvent.kitten_count_in_litter?.toString() || '');
        setSurvivedToWeaning(existingBirthEvent.survived_to_weaning);
        setNotes(existingBirthEvent.notes || '');
      } else {
        setBirthDate('');
        setDatePrecision('estimated');
        setBirthYear('');
        setBirthMonth('');
        setBirthSeason('');
        setPlaceId(linkedPlaces.length > 0 ? linkedPlaces[0].place_id : '');
        setKittenCount('');
        setSurvivedToWeaning(null);
        setNotes('');
      }
      setError(null);
      setSuccess(false);
    }
  }, [isOpen, linkedPlaces, existingBirthEvent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`/api/cats/${catId}/birth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          birth_date: birthDate || null,
          birth_date_precision: datePrecision,
          birth_year: birthYear ? parseInt(birthYear) : null,
          birth_month: birthMonth ? parseInt(birthMonth) : null,
          birth_season: birthSeason || null,
          place_id: placeId || null,
          kitten_count_in_litter: kittenCount ? parseInt(kittenCount) : null,
          survived_to_weaning: survivedToWeaning,
          notes: notes.trim() || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to record birth');
      }

      setSuccess(true);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record birth');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Remove birth information for this cat?')) return;

    setSubmitting(true);
    try {
      const response = await fetch(`/api/cats/${catId}/birth`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to remove birth record');
      }

      setSuccess(true);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove birth record');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // Generate year options (last 20 years)
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 20 }, (_, i) => currentYear - i);

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
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#198754' }}>
              {isEditing ? 'Edit Birth Information' : 'Record Birth Information'}
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
                background: '#d1e7dd',
                border: '1px solid #badbcc',
                borderRadius: '6px',
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ fontWeight: 600, color: '#0f5132', marginBottom: '0.5rem' }}>
                {isEditing ? 'Birth Information Updated' : 'Birth Information Recorded'}
              </div>
              <div style={{ color: '#0f5132', fontSize: '0.9rem' }}>
                Birth data for {catName} has been saved. This information will be used for
                breeding pattern analysis.
              </div>
            </div>

            <button
              onClick={onClose}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: 'var(--primary, #198754)',
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

            {/* Date Precision */}
            <div style={{ marginBottom: '1rem' }}>
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

            {/* Exact Date - shown when precision is exact or week */}
            {(datePrecision === 'exact' || datePrecision === 'week') && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                  Birth Date
                </label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
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
            )}

            {/* Year and Month/Season */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                  Birth Year
                </label>
                <select
                  value={birthYear}
                  onChange={(e) => setBirthYear(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border-color, #ddd)',
                    borderRadius: '4px',
                    fontSize: '1rem',
                    background: 'var(--bg-secondary, #fff)',
                  }}
                >
                  <option value="">Unknown</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
              {datePrecision === 'month' ? (
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                    Birth Month
                  </label>
                  <select
                    value={birthMonth}
                    onChange={(e) => setBirthMonth(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border-color, #ddd)',
                      borderRadius: '4px',
                      fontSize: '1rem',
                      background: 'var(--bg-secondary, #fff)',
                    }}
                  >
                    {MONTHS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : datePrecision === 'season' ? (
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                    Birth Season
                  </label>
                  <select
                    value={birthSeason}
                    onChange={(e) => setBirthSeason(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border-color, #ddd)',
                      borderRadius: '4px',
                      fontSize: '1rem',
                      background: 'var(--bg-secondary, #fff)',
                    }}
                  >
                    {SEASONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            {/* Litter Info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                  Kittens in Litter
                </label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={kittenCount}
                  onChange={(e) => setKittenCount(e.target.value)}
                  placeholder="e.g., 4"
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
                  Survived to Weaning?
                </label>
                <select
                  value={survivedToWeaning === null ? '' : survivedToWeaning ? 'yes' : 'no'}
                  onChange={(e) => {
                    if (e.target.value === '') setSurvivedToWeaning(null);
                    else setSurvivedToWeaning(e.target.value === 'yes');
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border-color, #ddd)',
                    borderRadius: '4px',
                    fontSize: '1rem',
                    background: 'var(--bg-secondary, #fff)',
                  }}
                >
                  <option value="">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>

            {/* Location */}
            {linkedPlaces.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                  Birth Location
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
                placeholder="Any additional context about the birth..."
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              {isEditing && (
                <button
                  type="button"
                  onClick={handleDelete}
                  style={{
                    padding: '0.75rem',
                    background: '#dc3545',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                  disabled={submitting}
                >
                  Delete
                </button>
              )}
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
                  background: submitting ? '#6c757d' : '#198754',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontWeight: 500,
                }}
              >
                {submitting ? 'Saving...' : isEditing ? 'Update' : 'Save'}
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
              <strong>Why this matters:</strong> Birth data helps calculate breeding rates
              and kitten survival for population modeling. Seasonal patterns help predict
              "kitten season" resource needs.
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
