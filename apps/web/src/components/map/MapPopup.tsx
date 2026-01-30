/**
 * MapPopup - Popup Content Builders for Beacon Map
 * Google Maps-inspired popup designs
 */

import { MAP_COLORS, getPriorityColor, getClassificationColor } from '@/lib/map-colors';

// Helper to escape HTML
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Get priority badge class
function getPriorityBadgeClass(priority: string): string {
  const validPriorities = ['critical', 'high', 'medium', 'low', 'success'];
  return validPriorities.includes(priority) ? priority : 'low';
}

interface PlaceData {
  id: string;
  address: string;
  lat?: number;
  lng?: number;
  cat_count?: number;
  priority?: string;
  service_zone?: string;
  has_observation?: boolean;
  primary_person_name?: string | null;
  person_count?: number;
}

/**
 * Build popup content for a place marker
 */
export function buildPlacePopup(place: PlaceData): string {
  const priorityClass = getPriorityBadgeClass(place.priority || 'low');

  // Build person info line if available
  let personInfo = '';
  if (place.primary_person_name) {
    const catText = place.cat_count && place.cat_count > 0
      ? ` brought in ${place.cat_count} cat${place.cat_count !== 1 ? 's' : ''}`
      : '';
    personInfo = `
      <div class="map-popup__person">
        <span style="color: #6366f1; font-weight: 500;">
          ${escapeHtml(place.primary_person_name)}
        </span>${catText}
      </div>
    `;
  }

  return `
    <div class="map-popup map-popup--place">
      <header class="map-popup__header">
        <h3 class="map-popup__title">${escapeHtml(place.address)}</h3>
        ${place.cat_count !== undefined ? `
          <span class="map-popup__badge map-popup__badge--${priorityClass}">
            ${place.cat_count} cat${place.cat_count !== 1 ? 's' : ''}
          </span>
        ` : ''}
      </header>
      ${personInfo}
      <div class="map-popup__meta">
        ${place.service_zone ? `
          <span class="map-popup__zone">${place.service_zone}</span>
        ` : ''}
        <span style="color: ${place.has_observation ? '#16a34a' : '#ca8a04'}">
          ${place.has_observation ? 'Has observation data' : 'Needs observation'}
        </span>
      </div>
      <footer class="map-popup__actions">
        ${place.lat && place.lng ? `
          <button onclick="window.atlasMapOpenStreetView(${place.lat}, ${place.lng}, '${escapeHtml(place.address).replace(/'/g, "\\'")}')"
                  class="map-popup__btn map-popup__btn--street-view">
            Street View
          </button>
        ` : ''}
        <a href="/places/${place.id}" class="map-popup__btn map-popup__btn--primary" target="_blank">
          View Place
        </a>
      </footer>
    </div>
  `;
}

interface TNRPriorityData {
  id: string;
  address: string;
  cat_count?: number;
  altered_count?: number;
  alteration_rate?: number;
  tnr_priority?: string;
  service_zone?: string;
}

/**
 * Build popup content for a TNR priority marker
 */
export function buildTNRPriorityPopup(data: TNRPriorityData): string {
  const priorityColors: Record<string, string> = {
    critical: '#dc2626',
    high: '#ea580c',
    medium: '#ca8a04',
    managed: '#16a34a',
  };
  const priorityColor = priorityColors[data.tnr_priority || 'unknown'] || '#6b7280';
  const rate = data.alteration_rate !== undefined ? Math.round(data.alteration_rate * 100) : 0;

  return `
    <div class="map-popup map-popup--tnr">
      <header class="map-popup__header">
        <h3 class="map-popup__title">${escapeHtml(data.address)}</h3>
        <span class="map-popup__badge" style="background: ${priorityColor}15; color: ${priorityColor}">
          ${(data.tnr_priority || 'unknown').toUpperCase()}
        </span>
      </header>
      ${data.service_zone ? `
        <div class="map-popup__meta">
          <span class="map-popup__zone">${data.service_zone}</span>
        </div>
      ` : ''}
      <div class="map-popup__content">
        <div class="map-popup__stat-grid">
          <div class="map-popup__stat">
            <div class="map-popup__stat-value">${data.cat_count || 0}</div>
            <div class="map-popup__stat-label">Total Cats</div>
          </div>
          <div class="map-popup__stat">
            <div class="map-popup__stat-value">${data.altered_count || 0}</div>
            <div class="map-popup__stat-label">Altered</div>
          </div>
        </div>
        <div class="map-popup__progress">
          <div class="map-popup__progress-bar">
            <div class="map-popup__progress-fill" style="width: ${rate}%; background: ${priorityColor}"></div>
          </div>
          <div class="map-popup__progress-label">${rate}% complete</div>
        </div>
      </div>
      <footer class="map-popup__actions">
        <a href="/places/${data.id}" class="map-popup__btn map-popup__btn--primary" target="_blank">
          View Details
        </a>
      </footer>
    </div>
  `;
}

interface GooglePinData {
  id: string;
  name?: string;
  notes?: string;
  cat_count?: number;
  display_label?: string;
  display_color?: string;
  ai_meaning?: string;
  ai_confidence?: number;
  staff_alert?: string;
  disease_mentions?: string[];
  safety_concerns?: string[];
  linked_place_id?: string;
  linked_person_id?: string;
}

/**
 * Build popup content for a Google Maps historical pin
 */
export function buildGooglePinPopup(pin: GooglePinData): string {
  const hasAlert = pin.staff_alert || (pin.disease_mentions && pin.disease_mentions.length > 0) || (pin.safety_concerns && pin.safety_concerns.length > 0);
  const confidencePercent = pin.ai_confidence ? Math.round(pin.ai_confidence * 100) : null;

  // Truncate notes
  const maxNotes = 200;
  const truncatedNotes = pin.notes && pin.notes.length > maxNotes
    ? pin.notes.substring(0, maxNotes) + '...'
    : pin.notes;

  return `
    <div class="map-popup map-popup--google-pin">
      ${hasAlert ? `
        <div class="map-popup__alert map-popup__alert--${pin.disease_mentions?.length ? 'danger' : 'warning'}">
          <span class="map-popup__alert-icon">${pin.disease_mentions?.length ? '🔴' : '⚠️'}</span>
          <div class="map-popup__alert-text">
            ${pin.staff_alert || ''}
            ${pin.disease_mentions?.length ? `<br/><strong>Disease:</strong> ${pin.disease_mentions.join(', ')}` : ''}
            ${pin.safety_concerns?.length ? `<br/><strong>Safety:</strong> ${pin.safety_concerns.join(', ')}` : ''}
          </div>
        </div>
      ` : ''}
      <header class="map-popup__header">
        <h3 class="map-popup__title">${escapeHtml(pin.name || 'Historical Pin')}</h3>
        ${pin.display_label ? `
          <span class="map-popup__badge" style="background: ${pin.display_color || '#6b7280'}20; color: ${pin.display_color || '#6b7280'}">
            ${pin.display_label}
          </span>
        ` : ''}
      </header>
      <div class="map-popup__meta">
        ${confidencePercent ? `
          <span style="font-size: 12px; color: #6b7280">
            AI confidence: ${confidencePercent}%
          </span>
        ` : ''}
        ${pin.cat_count ? `
          <span style="font-size: 12px; color: #6b7280">
            ${pin.cat_count} cats mentioned
          </span>
        ` : ''}
      </div>
      ${truncatedNotes ? `
        <div class="map-popup__notes">
          ${escapeHtml(truncatedNotes)}
        </div>
      ` : ''}
      ${(pin.linked_place_id || pin.linked_person_id) ? `
        <footer class="map-popup__actions">
          ${pin.linked_place_id ? `
            <a href="/places/${pin.linked_place_id}" class="map-popup__btn map-popup__btn--primary" target="_blank">
              View Place
            </a>
          ` : ''}
          ${pin.linked_person_id ? `
            <a href="/people/${pin.linked_person_id}" class="map-popup__btn map-popup__btn--secondary" target="_blank">
              View Person
            </a>
          ` : ''}
        </footer>
      ` : ''}
    </div>
  `;
}

interface VolunteerData {
  id: string;
  name: string;
  role?: string;
  role_label?: string;
  service_zone?: string;
  is_active?: boolean;
}

/**
 * Build popup content for a volunteer marker
 */
export function buildVolunteerPopup(volunteer: VolunteerData): string {
  const roleColors: Record<string, string> = {
    coordinator: '#7c3aed',
    head_trapper: '#2563eb',
    ffsc_trapper: '#16a34a',
    community_trapper: '#f59e0b',
  };
  const roleColor = roleColors[volunteer.role || ''] || '#6b7280';

  return `
    <div class="map-popup map-popup--volunteer">
      <header class="map-popup__header">
        <h3 class="map-popup__title">${escapeHtml(volunteer.name)}</h3>
        <span class="map-popup__badge" style="background: ${roleColor}; color: white">
          ${volunteer.role_label || volunteer.role || 'Volunteer'}
        </span>
      </header>
      <div class="map-popup__meta">
        ${volunteer.service_zone ? `
          <span class="map-popup__zone">${volunteer.service_zone}</span>
        ` : ''}
        <span style="color: ${volunteer.is_active ? '#16a34a' : '#6b7280'}">
          ${volunteer.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <footer class="map-popup__actions">
        <a href="/people/${volunteer.id}" class="map-popup__btn map-popup__btn--primary" target="_blank">
          View Profile
        </a>
      </footer>
    </div>
  `;
}

interface ClinicClientData {
  id: string;
  address: string;
  appointment_count?: number;
  cat_count?: number;
  last_visit?: string;
  service_zone?: string;
}

/**
 * Build popup content for a clinic client marker
 */
export function buildClinicClientPopup(client: ClinicClientData): string {
  const lastVisitDate = client.last_visit
    ? new Date(client.last_visit).toLocaleDateString()
    : null;

  return `
    <div class="map-popup map-popup--clinic">
      <header class="map-popup__header">
        <h3 class="map-popup__title">${escapeHtml(client.address)}</h3>
        <span class="map-popup__badge map-popup__badge--success">
          ${client.appointment_count || 0} visits
        </span>
      </header>
      <div class="map-popup__meta">
        ${client.service_zone ? `
          <span class="map-popup__zone">${client.service_zone}</span>
        ` : ''}
        ${lastVisitDate ? `
          <span style="font-size: 12px; color: #6b7280">
            Last: ${lastVisitDate}
          </span>
        ` : ''}
      </div>
      <div class="map-popup__content">
        <div class="map-popup__stat-grid">
          <div class="map-popup__stat">
            <div class="map-popup__stat-value">${client.cat_count || 0}</div>
            <div class="map-popup__stat-label">Cats</div>
          </div>
          <div class="map-popup__stat">
            <div class="map-popup__stat-value">${client.appointment_count || 0}</div>
            <div class="map-popup__stat-label">Appointments</div>
          </div>
        </div>
      </div>
      <footer class="map-popup__actions">
        <a href="/places/${client.id}" class="map-popup__btn map-popup__btn--primary" target="_blank">
          View Place
        </a>
      </footer>
    </div>
  `;
}

interface ZoneData {
  zone_id: string;
  zone_code: string;
  places_count?: number;
  total_cats?: number;
  observation_status?: string;
}

/**
 * Build popup content for a zone marker
 */
export function buildZonePopup(zone: ZoneData): string {
  const statusColors: Record<string, string> = {
    critical: '#dc2626',
    high: '#ea580c',
    medium: '#ca8a04',
    refresh: '#3b82f6',
    current: '#16a34a',
    unknown: '#6b7280',
  };
  const statusColor = statusColors[zone.observation_status || 'unknown'] || '#6b7280';

  return `
    <div class="map-popup map-popup--zone">
      <header class="map-popup__header">
        <h3 class="map-popup__title">Zone ${escapeHtml(zone.zone_code)}</h3>
        <span class="map-popup__badge" style="background: ${statusColor}20; color: ${statusColor}">
          ${(zone.observation_status || 'Unknown').replace('_', ' ')}
        </span>
      </header>
      <div class="map-popup__content">
        <div class="map-popup__stat-grid">
          <div class="map-popup__stat">
            <div class="map-popup__stat-value">${zone.places_count || 0}</div>
            <div class="map-popup__stat-label">Places</div>
          </div>
          <div class="map-popup__stat">
            <div class="map-popup__stat-value">${zone.total_cats || 0}</div>
            <div class="map-popup__stat-label">Cats</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Build loading popup placeholder
 */
export function buildLoadingPopup(): string {
  return `
    <div class="map-popup">
      <div style="display: flex; align-items: center; gap: 12px; padding: 8px 0;">
        <div class="map-loading-spinner"></div>
        <span style="color: #6b7280;">Loading...</span>
      </div>
    </div>
  `;
}
