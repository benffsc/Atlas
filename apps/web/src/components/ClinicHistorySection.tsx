'use client';

import { useState, useEffect, useCallback } from 'react';
import AppointmentDetailModal from './AppointmentDetailModal';

interface AppointmentRow {
  appointment_id: string;
  appointment_date: string;
  appointment_number: string;
  appointment_category: string;
  service_type: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  vet_name: string | null;
  cat_id: string | null;
  cat_name: string | null;
  cat_microchip: string | null;
  cat_photo_url: string | null;
  vaccines: string[];
  treatments: string[];
}

interface ClinicHistorySectionProps {
  personId?: string;
  placeId?: string;
}

const categoryColors: Record<string, string> = {
  'Spay/Neuter': '#198754',
  'Wellness': '#0d6efd',
  'Recheck': '#6f42c1',
  'Euthanasia': '#dc3545',
  'Other': '#6c757d',
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const INITIAL_DISPLAY = 10;

export default function ClinicHistorySection({ personId, placeId }: ClinicHistorySectionProps) {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);

  const fetchAppointments = useCallback(async () => {
    const params = new URLSearchParams();
    if (personId) params.set('person_id', personId);
    if (placeId) params.set('place_id', placeId);
    params.set('limit', '200');

    try {
      const res = await fetch(`/api/appointments?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setAppointments(data.appointments || []);
      setTotal(data.total || 0);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, [personId, placeId]);

  useEffect(() => {
    if (personId || placeId) fetchAppointments();
  }, [personId, placeId, fetchAppointments]);

  if (loading) {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>Clinic History</h4>
        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--muted, #6c757d)', fontSize: '0.85rem' }}>
          Loading clinic history...
        </div>
      </div>
    );
  }

  if (appointments.length === 0) {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>Clinic History</h4>
        <p style={{ color: 'var(--muted, #6c757d)', fontSize: '0.85rem' }}>No clinic appointments found.</p>
      </div>
    );
  }

  const displayRows = expanded ? appointments : appointments.slice(0, INITIAL_DISPLAY);
  const hasMore = appointments.length > INITIAL_DISPLAY;

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>
        Clinic History
        <span style={{ fontWeight: 400, color: 'var(--muted, #6c757d)', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
          {total} appointment{total !== 1 ? 's' : ''}
        </span>
      </h4>

      <div className="table-container" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border, #dee2e6)' }}>
              <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: 'var(--muted, #6c757d)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Date</th>
              <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: 'var(--muted, #6c757d)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Cat</th>
              <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: 'var(--muted, #6c757d)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Type</th>
              <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: 'var(--muted, #6c757d)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Services</th>
              <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: 'var(--muted, #6c757d)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Vet</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((appt) => (
              <tr
                key={appt.appointment_id}
                onClick={() => setSelectedAppointmentId(appt.appointment_id)}
                style={{ cursor: 'pointer', borderBottom: '1px solid var(--border, #e9ecef)' }}
                onMouseOver={(e) => { e.currentTarget.style.background = 'var(--section-bg, #f8f9fa)'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = ''; }}
              >
                <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                  {formatDate(appt.appointment_date)}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  {appt.cat_id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {/* Cat photo thumbnail */}
                      {appt.cat_photo_url ? (
                        <img
                          src={appt.cat_photo_url}
                          alt=""
                          style={{
                            width: 32, height: 32,
                            borderRadius: '50%',
                            objectFit: 'cover',
                            flexShrink: 0,
                            border: '1px solid var(--border, #dee2e6)',
                          }}
                        />
                      ) : (
                        <div style={{
                          width: 32, height: 32,
                          borderRadius: '50%',
                          background: 'var(--section-bg, #e9ecef)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          fontSize: '0.7rem',
                          color: 'var(--muted, #6c757d)',
                          border: '1px solid var(--border, #dee2e6)',
                        }}>
                          {appt.cat_name ? appt.cat_name.charAt(0).toUpperCase() : '?'}
                        </div>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <a
                          href={`/cats/${appt.cat_id}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: '#0d6efd', textDecoration: 'none', fontWeight: 500, fontSize: '0.85rem' }}
                          onMouseOver={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                          onMouseOut={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                        >
                          {appt.cat_name || 'Unknown'}
                        </a>
                        {appt.cat_microchip && (
                          <div>
                            <a
                              href={`/cats/${appt.cat_id}`}
                              onClick={(e) => e.stopPropagation()}
                              style={{ color: 'var(--muted, #6c757d)', textDecoration: 'none', fontSize: '0.7rem', fontFamily: 'monospace' }}
                              onMouseOver={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                              onMouseOut={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                            >
                              {appt.cat_microchip}
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--muted, #6c757d)', fontStyle: 'italic', fontSize: '0.8rem' }}>Unlinked</span>
                  )}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: '#fff',
                    background: categoryColors[appt.appointment_category] || '#6c757d',
                  }}>
                    {appt.appointment_category}
                  </span>
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem' }}>
                    {appt.is_spay && <span style={{ padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.65rem', background: '#d1e7dd', color: '#0f5132' }}>Spay</span>}
                    {appt.is_neuter && <span style={{ padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.65rem', background: '#d1e7dd', color: '#0f5132' }}>Neuter</span>}
                    {appt.vaccines?.map((v, i) => (
                      <span key={`v-${i}`} style={{ padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.65rem', background: '#d1e7dd', color: '#0f5132' }}>{v}</span>
                    ))}
                    {appt.treatments?.map((t, i) => (
                      <span key={`t-${i}`} style={{ padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.65rem', background: '#cfe2ff', color: '#084298' }}>{t}</span>
                    ))}
                  </div>
                </td>
                <td style={{ padding: '0.5rem', color: appt.vet_name ? 'inherit' : 'var(--muted, #6c757d)' }}>
                  {appt.vet_name || '\u2014'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div style={{ marginTop: '0.5rem', textAlign: 'center' }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none',
              border: 'none',
              color: '#0d6efd',
              cursor: 'pointer',
              fontSize: '0.85rem',
              padding: '0.25rem 0.75rem',
            }}
          >
            {expanded ? 'Show less' : `Show all ${total} appointments`}
          </button>
        </div>
      )}

      <AppointmentDetailModal
        appointmentId={selectedAppointmentId}
        onClose={() => setSelectedAppointmentId(null)}
      />
    </div>
  );
}
