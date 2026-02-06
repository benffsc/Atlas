'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatPhone } from '@/lib/formatters';

/**
 * Check if a raw ClinicHQ field value indicates a positive/true condition.
 * ClinicHQ uses various formats: 'Yes', 'TRUE', 'true', 'Positive', 'Y', etc.
 * This prevents false positives from notes, status text, or other non-boolean values.
 */
function isPositiveValue(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ['yes', 'true', 'y', 'positive', '1', 'checked'].includes(normalized);
}

/**
 * Check if a raw value indicates presence (for surgical/condition flags that may have descriptive values).
 * Returns the original value if it's a meaningful positive indicator, null otherwise.
 */
function getPositiveValueOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  // Skip explicit negatives
  if (['no', 'none', 'n', 'false', '0', 'n/a', 'na', ''].includes(normalized)) return null;
  // Accept explicit positives
  if (['yes', 'true', 'y', 'positive', '1', 'checked'].includes(normalized)) return value;
  // For surgical conditions, also accept descriptive values like 'Left', 'Right', 'Bilateral'
  if (['left', 'right', 'bilateral', 'both', 'mild', 'moderate', 'severe'].includes(normalized)) return value;
  // Reject anything else (notes, questions, etc.)
  return null;
}

interface RawDetails {
  felv_fiv_snap: string | null;
  felv_test: string | null;
  body_composition_score: string | null;
  overweight: string | null;
  underweight: string | null;
  weight: string | null;
  uri: string | null;
  dental_disease: string | null;
  ear_issue: string | null;
  ear_infections: string | null;
  eye_issue: string | null;
  skin_issue: string | null;
  mouth_issue: string | null;
  diarrhea: string | null;
  nauseous: string | null;
  mats: string | null;
  fleas: string | null;
  ticks: string | null;
  tapeworms: string | null;
  ear_mites: string | null;
  lice: string | null;
  heartworm_positive: string | null;
  ringworm_test: string | null;
  skin_scrape_test: string | null;
  no_surgery_reason: string | null;
  cryptorchid: string | null;
  pre_scrotal: string | null;
  hernia: string | null;
  pyometra: string | null;
  staples: string | null;
  bruising_expected: string | null;
  swelling_expected: string | null;
  cold_compress: string | null;
  warm_compress_dry: string | null;
  warm_compress_wet: string | null;
  clipper_abrasion: string | null;
  recheck_needed: string | null;
  bmbt_test: string | null;
  bradycardia: string | null;
  too_young_for_rabies: string | null;
  polydactyl: string | null;
  death_type: string | null;
  invoiced: string | null;
  total_invoiced: string | null;
}

interface Procedure {
  procedure_id: string;
  procedure_type: string;
  status: string;
  performed_by: string | null;
  complications: string[] | null;
  post_op_notes: string | null;
}

interface AppointmentDetail {
  appointment_id: string;
  appointment_date: string;
  appointment_number: string;
  clinic_day_number: number | null;
  appointment_category: string;
  service_type: string | null;
  vet_name: string | null;
  technician: string | null;
  temperature: number | null;
  medical_notes: string | null;
  is_spay: boolean;
  is_neuter: boolean;
  is_pregnant: boolean;
  is_lactating: boolean;
  is_in_heat: boolean;
  // Enriched vitals
  weight_lbs: number | null;
  cat_age_years: number | null;
  cat_age_months: number | null;
  body_composition_score: string | null;
  // Enriched health screening
  has_uri: boolean;
  has_dental_disease: boolean;
  has_ear_issue: boolean;
  has_eye_issue: boolean;
  has_skin_issue: boolean;
  has_mouth_issue: boolean;
  has_fleas: boolean;
  has_ticks: boolean;
  has_tapeworms: boolean;
  has_ear_mites: boolean;
  has_ringworm: boolean;
  felv_fiv_result: string | null;
  no_surgery_reason: string | null;
  // Financial
  total_invoiced: number | null;
  subsidy_value: number | null;
  // Client
  ownership_type: string | null;
  cat_id: string | null;
  cat_name: string | null;
  cat_sex: string | null;
  cat_microchip: string | null;
  cat_photo_url: string | null;
  person_id: string | null;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  client_address: string | null;
  vaccines: string[];
  treatments: string[];
  procedures: Procedure[];
  raw_details: RawDetails | null;
}

interface AppointmentDetailModalProps {
  appointmentId: string | null;
  onClose: () => void;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const categoryColors: Record<string, string> = {
  'Spay/Neuter': '#198754',
  'Wellness': '#0d6efd',
  'Recheck': '#6f42c1',
  'Euthanasia': '#dc3545',
  'Other': '#6c757d',
};

function YesFlag({ label, value }: { label: string; value: string | null }) {
  // Use strict positive value check - don't show for notes or random text
  if (!isPositiveValue(value)) return null;
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.15rem 0.5rem',
      borderRadius: '4px',
      fontSize: '0.75rem',
      fontWeight: 500,
      background: '#fff3cd',
      color: '#664d03',
      border: '1px solid #ffecb5',
      marginRight: '0.25rem',
      marginBottom: '0.25rem',
    }}>
      {label}
    </span>
  );
}

function FieldRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div style={{ display: 'flex', gap: '0.5rem', padding: '0.25rem 0', borderBottom: '1px solid var(--border, #e9ecef)' }}>
      <span style={{ color: 'var(--muted, #6c757d)', minWidth: '120px', fontSize: '0.85rem' }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: '0.85rem' }}>{String(value)}</span>
    </div>
  );
}

export default function AppointmentDetailModal({ appointmentId, onClose }: AppointmentDetailModalProps) {
  const [data, setData] = useState<AppointmentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/appointments/${id}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to fetch');
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load appointment');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (appointmentId) {
      fetchDetail(appointmentId);
    } else {
      setData(null);
    }
  }, [appointmentId, fetchDetail]);

  if (!appointmentId) return null;

  const raw = data?.raw_details;

  // Collect health observations from enriched booleans (gold standard)
  const healthObs: Array<{ label: string }> = [];
  if (data) {
    if (data.has_uri) healthObs.push({ label: 'URI' });
    if (data.has_dental_disease) healthObs.push({ label: 'Dental Disease' });
    if (data.has_ear_issue) healthObs.push({ label: 'Ear Issue' });
    if (data.has_eye_issue) healthObs.push({ label: 'Eye Issue' });
    if (data.has_skin_issue) healthObs.push({ label: 'Skin Issue' });
    if (data.has_mouth_issue) healthObs.push({ label: 'Mouth Issue' });
    // Extra from raw (not on enriched table) - use strict positive check
    if (isPositiveValue(raw?.diarrhea)) healthObs.push({ label: 'Diarrhea' });
    if (isPositiveValue(raw?.nauseous)) healthObs.push({ label: 'Nauseous' });
    if (isPositiveValue(raw?.mats)) healthObs.push({ label: 'Mats' });
  }

  const parasites: Array<{ label: string }> = [];
  if (data) {
    if (data.has_fleas) parasites.push({ label: 'Fleas' });
    if (data.has_ticks) parasites.push({ label: 'Ticks' });
    if (data.has_tapeworms) parasites.push({ label: 'Tapeworms' });
    if (data.has_ear_mites) parasites.push({ label: 'Ear Mites' });
    if (data.has_ringworm) parasites.push({ label: 'Ringworm' });
    // Extra from raw (not on enriched table) - use strict positive check
    if (isPositiveValue(raw?.lice)) parasites.push({ label: 'Lice' });
    if (isPositiveValue(raw?.heartworm_positive)) parasites.push({ label: 'Heartworm+' });
  }

  const surgeryFlags: Array<{ label: string; value: string }> = [];
  if (raw) {
    // Use getPositiveValueOrNull which accepts descriptive values like 'Left', 'Right', 'Bilateral'
    const cryptorchid = getPositiveValueOrNull(raw.cryptorchid);
    const preScrotal = getPositiveValueOrNull(raw.pre_scrotal);
    const hernia = getPositiveValueOrNull(raw.hernia);
    const pyometra = getPositiveValueOrNull(raw.pyometra);
    const staples = getPositiveValueOrNull(raw.staples);
    if (cryptorchid) surgeryFlags.push({ label: 'Cryptorchid', value: cryptorchid });
    if (preScrotal) surgeryFlags.push({ label: 'Pre-Scrotal', value: preScrotal });
    if (hernia) surgeryFlags.push({ label: 'Hernia', value: hernia });
    if (pyometra) surgeryFlags.push({ label: 'Pyometra', value: pyometra });
    if (staples) surgeryFlags.push({ label: 'Staples', value: staples });
  }

  const postOpFlags: Array<{ label: string; value: string }> = [];
  if (raw) {
    // Post-op instructions are boolean flags - use strict positive check
    if (isPositiveValue(raw.bruising_expected)) postOpFlags.push({ label: 'Bruising Expected', value: 'Yes' });
    if (isPositiveValue(raw.swelling_expected)) postOpFlags.push({ label: 'Swelling Expected', value: 'Yes' });
    if (isPositiveValue(raw.cold_compress)) postOpFlags.push({ label: 'Cold Compress', value: 'Yes' });
    if (isPositiveValue(raw.warm_compress_dry)) postOpFlags.push({ label: 'Warm Compress (dry)', value: 'Yes' });
    if (isPositiveValue(raw.warm_compress_wet)) postOpFlags.push({ label: 'Warm Compress (wet)', value: 'Yes' });
    if (isPositiveValue(raw.clipper_abrasion)) postOpFlags.push({ label: 'Clipper Abrasion', value: 'Yes' });
    if (isPositiveValue(raw.recheck_needed)) postOpFlags.push({ label: 'Recheck Needed', value: 'Yes' });
  }

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
          maxWidth: '640px',
          width: '90%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Appointment Detail</h3>
            {data && (
              <div style={{ color: 'var(--muted, #6c757d)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                {formatDate(data.appointment_date)} &middot; #{data.appointment_number}{data.clinic_day_number != null && <> &middot; Cat #{data.clinic_day_number}</>}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: 'var(--muted, #6c757d)',
              padding: '0.25rem',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Cat card */}
        {data && data.cat_id && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.5rem 0.75rem',
            background: 'var(--section-bg, #f8f9fa)',
            borderRadius: '6px',
            marginBottom: '1rem',
          }}>
            {data.cat_photo_url ? (
              <img
                src={data.cat_photo_url}
                alt=""
                style={{
                  width: 40, height: 40,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  flexShrink: 0,
                  border: '1px solid var(--border, #dee2e6)',
                }}
              />
            ) : (
              <div style={{
                width: 40, height: 40,
                borderRadius: '50%',
                background: 'var(--card-bg, #e9ecef)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontSize: '0.9rem',
                fontWeight: 600,
                color: 'var(--muted, #6c757d)',
                border: '1px solid var(--border, #dee2e6)',
              }}>
                {data.cat_name ? data.cat_name.charAt(0).toUpperCase() : '?'}
              </div>
            )}
            <div>
              <a
                href={`/cats/${data.cat_id}`}
                style={{ color: '#0d6efd', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' }}
                onMouseOver={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                onMouseOut={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
              >
                {data.cat_name || 'Unknown Cat'}
              </a>
              {data.cat_microchip && (
                <div>
                  <a
                    href={`/cats/${data.cat_id}`}
                    style={{ color: 'var(--muted, #6c757d)', textDecoration: 'none', fontSize: '0.75rem', fontFamily: 'monospace' }}
                    onMouseOver={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                    onMouseOut={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                  >
                    Chip: {data.cat_microchip}
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {loading && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted, #6c757d)' }}>
            Loading appointment details...
          </div>
        )}

        {error && (
          <div style={{ padding: '1rem', background: 'var(--danger-bg, #f8d7da)', color: 'var(--danger-text, #842029)', borderRadius: '6px', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {data && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Category + Services */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
              <span style={{
                padding: '0.2rem 0.6rem',
                borderRadius: '4px',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: '#fff',
                background: categoryColors[data.appointment_category] || '#6c757d',
              }}>
                {data.appointment_category}
              </span>
              {data.is_spay && <span className="badge" style={{ background: '#d1e7dd', color: '#0f5132', fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>Spay</span>}
              {data.is_neuter && <span className="badge" style={{ background: '#d1e7dd', color: '#0f5132', fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>Neuter</span>}
              {data.vaccines.map((v, i) => <span key={`v-${i}`} style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', background: '#d1e7dd', color: '#0f5132' }}>{v}</span>)}
              {data.treatments.map((t, i) => <span key={`t-${i}`} style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', background: '#cfe2ff', color: '#084298' }}>{t}</span>)}
            </div>

            {/* Provider */}
            {(data.vet_name || data.technician) && (
              <div style={{ background: 'var(--section-bg, #f8f9fa)', borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--muted, #6c757d)', marginBottom: '0.5rem' }}>Provider</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
                  <FieldRow label="Veterinarian" value={data.vet_name} />
                  <FieldRow label="Technician" value={data.technician} />
                </div>
              </div>
            )}

            {/* Vitals */}
            {(data.temperature || data.weight_lbs || data.body_composition_score || data.cat_age_years != null || data.cat_age_months != null || data.is_pregnant || data.is_lactating || data.is_in_heat) && (
              <div style={{ background: 'var(--section-bg, #f8f9fa)', borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--muted, #6c757d)', marginBottom: '0.5rem' }}>Vitals</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
                  <FieldRow label="Temperature" value={data.temperature ? `${data.temperature}\u00B0F` : null} />
                  <FieldRow label="Weight" value={data.weight_lbs ? `${data.weight_lbs} lbs` : null} />
                  <FieldRow label="Age" value={
                    data.cat_age_years != null || data.cat_age_months != null
                      ? [data.cat_age_years ? `${data.cat_age_years}y` : null, data.cat_age_months ? `${data.cat_age_months}m` : null].filter(Boolean).join(' ')
                      : null
                  } />
                  <FieldRow label="Body Condition" value={data.body_composition_score} />
                </div>
                {(data.is_pregnant || data.is_lactating || data.is_in_heat) && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {data.is_pregnant && <span style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 500, background: '#f8d7da', color: '#842029' }}>Pregnant</span>}
                    {data.is_lactating && <span style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 500, background: '#fff3cd', color: '#664d03' }}>Lactating</span>}
                    {data.is_in_heat && <span style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 500, background: '#fff3cd', color: '#664d03' }}>In Heat</span>}
                  </div>
                )}
              </div>
            )}

            {/* Tests */}
            {(data.felv_fiv_result || raw?.felv_test || raw?.ringworm_test || raw?.skin_scrape_test || raw?.bmbt_test) && (
              <div style={{ background: 'var(--section-bg, #f8f9fa)', borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--muted, #6c757d)', marginBottom: '0.5rem' }}>Tests</div>
                <FieldRow label="FeLV/FIV SNAP" value={data.felv_fiv_result} />
                <FieldRow label="FeLV Test" value={raw?.felv_test} />
                <FieldRow label="Ringworm (Wood's Lamp)" value={raw?.ringworm_test} />
                <FieldRow label="Skin Scrape" value={raw?.skin_scrape_test} />
                <FieldRow label="BMBT" value={raw?.bmbt_test} />
              </div>
            )}

            {/* Health Observations */}
            {healthObs.length > 0 && (
              <div style={{ background: 'var(--section-bg, #f8f9fa)', borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--muted, #6c757d)', marginBottom: '0.5rem' }}>Health Observations</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  {healthObs.map((obs, i) => (
                    <span key={i} style={{
                      padding: '0.15rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      background: '#fff3cd',
                      color: '#664d03',
                      border: '1px solid #ffecb5',
                    }}>
                      {obs.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Parasites */}
            {parasites.length > 0 && (
              <div style={{ background: 'var(--section-bg, #f8f9fa)', borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--muted, #6c757d)', marginBottom: '0.5rem' }}>Parasites</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  {parasites.map((p, i) => (
                    <span key={i} style={{
                      padding: '0.15rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      background: '#f8d7da',
                      color: '#842029',
                      border: '1px solid #f5c2c7',
                    }}>
                      {p.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Surgery Details */}
            {(data.procedures.length > 0 || surgeryFlags.length > 0 || data.no_surgery_reason) && (
              <div style={{ background: 'var(--section-bg, #f8f9fa)', borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--muted, #6c757d)', marginBottom: '0.5rem' }}>Surgery</div>
                {data.no_surgery_reason && (
                  <div style={{ padding: '0.5rem', background: '#fff3cd', borderRadius: '4px', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                    <strong>No Surgery:</strong> {data.no_surgery_reason}
                  </div>
                )}
                {data.procedures.map((proc) => (
                  <div key={proc.procedure_id} style={{ marginBottom: '0.5rem' }}>
                    <FieldRow label="Procedure" value={proc.procedure_type} />
                    <FieldRow label="Status" value={proc.status} />
                    <FieldRow label="Performed By" value={proc.performed_by} />
                    {proc.complications && proc.complications.length > 0 && (
                      <FieldRow label="Complications" value={proc.complications.join(', ')} />
                    )}
                    <FieldRow label="Post-Op Notes" value={proc.post_op_notes} />
                  </div>
                ))}
                {surgeryFlags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.25rem' }}>
                    {surgeryFlags.map((f, i) => <YesFlag key={i} label={f.label} value={f.value} />)}
                  </div>
                )}
              </div>
            )}

            {/* Post-Op Instructions */}
            {postOpFlags.length > 0 && (
              <div style={{ background: 'var(--section-bg, #f8f9fa)', borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--muted, #6c757d)', marginBottom: '0.5rem' }}>Post-Op Instructions</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  {postOpFlags.map((f, i) => <YesFlag key={i} label={f.label} value={f.value} />)}
                </div>
              </div>
            )}

            {/* Medical Notes */}
            {data.medical_notes && (
              <div style={{ background: 'var(--section-bg, #f8f9fa)', borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--muted, #6c757d)', marginBottom: '0.5rem' }}>Medical Notes</div>
                <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {data.medical_notes}
                </div>
              </div>
            )}

            {/* Client Info */}
            {(data.client_name || data.client_email || data.client_phone || data.client_address) && (
              <div style={{ background: 'var(--section-bg, #f8f9fa)', borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--muted, #6c757d)', marginBottom: '0.5rem' }}>Client</div>
                <FieldRow label="Name" value={data.client_name} />
                <FieldRow label="Ownership" value={data.ownership_type} />
                <FieldRow label="Email" value={data.client_email} />
                <FieldRow label="Phone" value={formatPhone(data.client_phone)} />
                <FieldRow label="Address" value={data.client_address} />
              </div>
            )}

            {/* Financial */}
            {(data.total_invoiced || data.subsidy_value) && (
              <div style={{ background: 'var(--section-bg, #f8f9fa)', borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--muted, #6c757d)', marginBottom: '0.5rem' }}>Financial</div>
                <FieldRow label="Total Invoiced" value={data.total_invoiced != null ? `$${Number(data.total_invoiced).toFixed(2)}` : null} />
                <FieldRow label="Subsidy Value" value={data.subsidy_value != null ? `$${Number(data.subsidy_value).toFixed(2)}` : null} />
              </div>
            )}

            {/* Services breakdown */}
            {data.service_type && (
              <div style={{ background: 'var(--section-bg, #f8f9fa)', borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--muted, #6c757d)', marginBottom: '0.5rem' }}>All Services</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--foreground, #212529)' }}>
                  {data.service_type.split(';').map((s, i) => (
                    <div key={i} style={{ padding: '0.15rem 0' }}>{s.trim()}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Misc flags */}
            {raw && (raw.too_young_for_rabies || raw.polydactyl || raw.death_type || raw.bradycardia) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                <YesFlag label="Too Young for Rabies" value={raw.too_young_for_rabies} />
                <YesFlag label="Polydactyl" value={raw.polydactyl} />
                <YesFlag label="Bradycardia Intra-Op" value={raw.bradycardia} />
                {raw.death_type && <span style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 500, background: '#f8d7da', color: '#842029' }}>Death: {raw.death_type}</span>}
              </div>
            )}

            {!raw && (
              <div style={{ fontSize: '0.8rem', color: 'var(--muted, #6c757d)', fontStyle: 'italic', textAlign: 'center', padding: '0.5rem' }}>
                Extended clinic details (surgery flags, post-op instructions) not available
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
