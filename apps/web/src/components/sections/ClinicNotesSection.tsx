'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '@/lib/api-client';

interface ClinicNote {
  account_id: string;
  client_name: string;
  quick_notes: string | null;
  long_notes: string | null;
  tags: string | null;
  notes_updated_at: string | null;
  clinichq_client_id: number | null;
}

interface ClinicNotesSectionProps {
  personId?: string;
  placeId?: string;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Unknown';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const INITIAL_DISPLAY = 3;

export default function ClinicNotesSection({ personId, placeId }: ClinicNotesSectionProps) {
  const [notes, setNotes] = useState<ClinicNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  const fetchNotes = useCallback(async () => {
    const params = new URLSearchParams();
    if (personId) params.set('person_id', personId);
    if (placeId) params.set('place_id', placeId);

    try {
      const data = await fetchApi<{ notes: ClinicNote[] }>(
        `/api/clinic-notes?${params}`
      );
      setNotes(data.notes || []);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, [personId, placeId]);

  useEffect(() => {
    if (personId || placeId) fetchNotes();
  }, [personId, placeId, fetchNotes]);

  const toggleNoteExpand = (accountId: string) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>
          ClinicHQ Notes
        </h4>
        <div style={{
          padding: '1rem',
          textAlign: 'center',
          color: 'var(--muted, #6c757d)',
          fontSize: '0.85rem'
        }}>
          Loading notes...
        </div>
      </div>
    );
  }

  if (notes.length === 0) {
    return null; // Don't render section if no notes
  }

  const displayNotes = expanded ? notes : notes.slice(0, INITIAL_DISPLAY);
  const hasMore = notes.length > INITIAL_DISPLAY;

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>
        ClinicHQ Notes
        <span style={{
          fontWeight: 400,
          color: 'var(--muted, #6c757d)',
          fontSize: '0.8rem',
          marginLeft: '0.5rem'
        }}>
          ({notes.length})
        </span>
      </h4>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {displayNotes.map((note) => {
          const isExpanded = expandedNotes.has(note.account_id);
          const hasLongContent = note.long_notes && note.long_notes.length > 200;

          return (
            <div
              key={note.account_id}
              style={{
                padding: '0.75rem',
                backgroundColor: 'var(--card-bg, #f8f9fa)',
                borderRadius: '8px',
                borderLeft: '3px solid var(--warning, #ffc107)',
              }}
            >
              {/* Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '0.5rem'
              }}>
                <span style={{
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  color: 'var(--text, #212529)'
                }}>
                  {note.client_name}
                </span>
                {note.notes_updated_at && (
                  <span style={{
                    fontSize: '0.75rem',
                    color: 'var(--muted, #6c757d)'
                  }}>
                    {formatDate(note.notes_updated_at)}
                  </span>
                )}
              </div>

              {/* Tags */}
              {note.tags && (
                <div style={{ marginBottom: '0.5rem' }}>
                  {note.tags.split(',').map((tag, i) => (
                    <span
                      key={i}
                      style={{
                        display: 'inline-block',
                        padding: '0.15rem 0.4rem',
                        backgroundColor: 'var(--info-bg, #cfe2ff)',
                        color: 'var(--info, #0d6efd)',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        marginRight: '0.25rem',
                        marginBottom: '0.25rem',
                      }}
                    >
                      {tag.trim()}
                    </span>
                  ))}
                </div>
              )}

              {/* Quick Notes */}
              {note.quick_notes && (
                <div style={{
                  padding: '0.5rem',
                  backgroundColor: 'var(--warning-bg, #fff3cd)',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                  marginBottom: note.long_notes ? '0.5rem' : 0,
                  color: 'var(--warning-dark, #856404)',
                }}>
                  <strong>Quick:</strong> {note.quick_notes}
                </div>
              )}

              {/* Long Notes */}
              {note.long_notes && (
                <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
                  <div style={{
                    whiteSpace: 'pre-wrap',
                    color: 'var(--text-muted, #495057)',
                  }}>
                    {isExpanded || !hasLongContent
                      ? note.long_notes
                      : note.long_notes.slice(0, 200) + '...'}
                  </div>
                  {hasLongContent && (
                    <button
                      onClick={() => toggleNoteExpand(note.account_id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--primary, #0d6efd)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        padding: '0.25rem 0',
                        marginTop: '0.25rem',
                      }}
                    >
                      {isExpanded ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: '0.75rem',
            background: 'none',
            border: '1px solid var(--border, #dee2e6)',
            borderRadius: '6px',
            padding: '0.5rem 1rem',
            color: 'var(--primary, #0d6efd)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            width: '100%',
          }}
        >
          {expanded ? 'Show less' : `Show all ${notes.length} notes`}
        </button>
      )}
    </div>
  );
}
