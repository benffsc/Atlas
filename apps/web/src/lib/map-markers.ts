/**
 * Map Marker Factory Functions
 * Modern, Google Maps-inspired marker icons
 */

import L from 'leaflet';
import { lightenColor } from './map-colors';

/**
 * Create a modern drop-pin marker (Google Maps style)
 */
export function createPinMarker(
  color: string,
  options?: {
    size?: number;
    label?: string;
    isAlert?: boolean;
    showRing?: boolean;
  }
): L.DivIcon {
  const { size = 32, label, isAlert, showRing } = options || {};
  const lighterColor = lightenColor(color, 15);
  const uniqueId = Math.random().toString(36).substr(2, 9);

  const svg = `
    <svg width="${size}" height="${Math.round(size * 1.35)}" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="pin-grad-${uniqueId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${lighterColor}"/>
          <stop offset="100%" stop-color="${color}"/>
        </linearGradient>
        <filter id="pin-shadow-${uniqueId}" x="-30%" y="-10%" width="160%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-opacity="0.3"/>
        </filter>
      </defs>
      <ellipse cx="12" cy="30" rx="4" ry="1.5" fill="rgba(0,0,0,0.15)"/>
      <path
        filter="url(#pin-shadow-${uniqueId})"
        fill="url(#pin-grad-${uniqueId})"
        stroke="#fff"
        stroke-width="1.5"
        d="M12 0C6.5 0 2 4.5 2 10c0 7 10 20 10 20s10-13 10-20c0-5.5-4.5-10-10-10z"
      />
      <circle cx="12" cy="10" r="4.5" fill="white"/>
      ${label ? `
        <text x="12" y="13" text-anchor="middle" fill="${color}" font-size="8" font-weight="bold" font-family="system-ui, sans-serif">${label}</text>
      ` : `
        <circle cx="12" cy="10" r="2" fill="${color}"/>
      `}
      ${showRing ? `
        <circle cx="12" cy="10" r="7" fill="none" stroke="${color}" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.5">
          <animateTransform attributeName="transform" type="rotate" from="0 12 10" to="360 12 10" dur="10s" repeatCount="indefinite"/>
        </circle>
      ` : ''}
    </svg>
  `;

  return L.divIcon({
    className: `map-marker-pin ${isAlert ? 'marker-alert' : ''}`,
    html: svg,
    iconSize: [size, Math.round(size * 1.35)],
    iconAnchor: [size / 2, Math.round(size * 1.35)],
    popupAnchor: [0, -Math.round(size * 1.1)],
  });
}

/**
 * Create a circular marker (for places, historical)
 */
export function createCircleMarker(
  color: string,
  options?: {
    size?: number;
    borderColor?: string;
    borderWidth?: number;
    opacity?: number;
  }
): L.DivIcon {
  const {
    size = 12,
    borderColor = 'white',
    borderWidth = 2,
    opacity = 1
  } = options || {};

  const html = `
    <div style="
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border: ${borderWidth}px solid ${borderColor};
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      opacity: ${opacity};
    "></div>
  `;

  return L.divIcon({
    className: 'map-marker-circle',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
  });
}

/**
 * Create a star marker (for volunteers)
 */
export function createStarMarker(
  color: string,
  options?: {
    size?: number;
  }
): L.DivIcon {
  const { size = 20 } = options || {};
  const lighterColor = lightenColor(color, 20);
  const uniqueId = Math.random().toString(36).substr(2, 9);

  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="star-grad-${uniqueId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${lighterColor}"/>
          <stop offset="100%" stop-color="${color}"/>
        </linearGradient>
        <filter id="star-shadow-${uniqueId}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.3"/>
        </filter>
      </defs>
      <polygon
        filter="url(#star-shadow-${uniqueId})"
        fill="url(#star-grad-${uniqueId})"
        stroke="#fff"
        stroke-width="1.5"
        points="12,2 15,9 22,9 17,14 19,22 12,18 5,22 7,14 2,9 9,9"
      />
    </svg>
  `;

  return L.divIcon({
    className: 'map-marker-star',
    html: svg,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
  });
}

/**
 * Create a clinic/hospital marker
 */
export function createClinicMarker(
  color: string,
  options?: {
    size?: number;
  }
): L.DivIcon {
  const { size = 18 } = options || {};
  const lighterColor = lightenColor(color, 15);
  const uniqueId = Math.random().toString(36).substr(2, 9);

  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="clinic-grad-${uniqueId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${lighterColor}"/>
          <stop offset="100%" stop-color="${color}"/>
        </linearGradient>
        <filter id="clinic-shadow-${uniqueId}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.3"/>
        </filter>
      </defs>
      <rect
        filter="url(#clinic-shadow-${uniqueId})"
        x="2" y="2" width="20" height="20" rx="4"
        fill="url(#clinic-grad-${uniqueId})"
        stroke="#fff"
        stroke-width="1.5"
      />
      <path d="M11 7v4H7v2h4v4h2v-4h4v-2h-4V7h-2z" fill="white"/>
    </svg>
  `;

  return L.divIcon({
    className: 'map-marker-clinic',
    html: svg,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
  });
}

/**
 * Create a square marker (for zones)
 */
export function createSquareMarker(
  color: string,
  options?: {
    size?: number;
    label?: string;
  }
): L.DivIcon {
  const { size = 24, label } = options || {};

  const html = `
    <div style="
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border: 2px solid white;
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 10px;
      font-weight: 700;
      font-family: system-ui, sans-serif;
    ">${label || ''}</div>
  `;

  return L.divIcon({
    className: 'map-marker-square',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
  });
}

/**
 * Create user location marker
 */
export function createUserLocationMarker(): L.DivIcon {
  const html = `
    <div class="map-user-location">
      <div class="map-user-location__ring"></div>
      <div class="map-user-location__dot"></div>
    </div>
  `;

  return L.divIcon({
    className: 'map-marker-user-location',
    html,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

/**
 * Create Google Maps-style Atlas pin marker
 * Used for the main atlas_pins layer with status-specific styling
 */
export function createAtlasPinMarker(
  color: string,
  options?: {
    size?: number;
    pinStyle?: 'disease' | 'watch_list' | 'active' | 'active_requests' | 'has_history' | 'minimal';
    isClustered?: boolean;
    unitCount?: number;
    catCount?: number;
    hasVolunteer?: boolean;
  }
): L.DivIcon {
  const {
    size = 32,
    pinStyle = 'minimal',
    isClustered = false,
    unitCount = 1,
    catCount = 0,
    hasVolunteer = false,
  } = options || {};

  const lighterColor = lightenColor(color, 15);
  const uniqueId = Math.random().toString(36).substr(2, 9);

  // Choose inner icon based on status/content
  let innerIcon: string;
  let innerContent: string;

  if (isClustered && unitCount > 1) {
    // Building cluster icon
    innerContent = `
      <rect x="8" y="12" width="8" height="6" fill="${color}" rx="1"/>
      <text x="12" y="9" text-anchor="middle" fill="${color}" font-size="6" font-weight="bold" font-family="system-ui">${unitCount}</text>
    `;
    innerIcon = 'building';
  } else if (pinStyle === 'disease') {
    // Warning triangle
    innerContent = `
      <path d="M12 6 L16 14 H8 Z" fill="${color}" stroke="white" stroke-width="0.5"/>
      <text x="12" y="13" text-anchor="middle" fill="white" font-size="6" font-weight="bold">!</text>
    `;
    innerIcon = 'warning';
  } else if (pinStyle === 'watch_list') {
    // Eye icon
    innerContent = `
      <ellipse cx="12" cy="10" rx="4" ry="2.5" fill="none" stroke="${color}" stroke-width="1.5"/>
      <circle cx="12" cy="10" r="1.5" fill="${color}"/>
    `;
    innerIcon = 'eye';
  } else if (pinStyle === 'active' && catCount > 0) {
    // Cat count
    innerContent = `
      <circle cx="12" cy="10" r="4" fill="${color}"/>
      <text x="12" y="12.5" text-anchor="middle" fill="white" font-size="6" font-weight="bold" font-family="system-ui">${catCount > 9 ? '9+' : catCount}</text>
    `;
    innerIcon = 'count';
  } else if (pinStyle === 'active_requests') {
    // Clipboard/request icon for places with requests but no verified cats
    innerContent = `
      <rect x="9" y="7" width="6" height="7" fill="none" stroke="${color}" stroke-width="1.2" rx="0.5"/>
      <line x1="10.5" y1="9.5" x2="13.5" y2="9.5" stroke="${color}" stroke-width="0.8"/>
      <line x1="10.5" y1="11.5" x2="13.5" y2="11.5" stroke="${color}" stroke-width="0.8"/>
    `;
    innerIcon = 'request';
  } else if (pinStyle === 'has_history') {
    // Document/history icon
    innerContent = `
      <rect x="9" y="6" width="6" height="8" fill="${color}" rx="1"/>
      <line x1="10" y1="8" x2="14" y2="8" stroke="white" stroke-width="0.8"/>
      <line x1="10" y1="10" x2="14" y2="10" stroke="white" stroke-width="0.8"/>
      <line x1="10" y1="12" x2="12" y2="12" stroke="white" stroke-width="0.8"/>
    `;
    innerIcon = 'history';
  } else {
    // Default dot
    innerContent = `<circle cx="12" cy="10" r="3" fill="${color}"/>`;
    innerIcon = 'default';
  }

  // Small star badge overlay for places with volunteers/staff
  const volunteerBadge = hasVolunteer ? `
    <g transform="translate(17, 0)">
      <circle cx="0" cy="0" r="5" fill="#7c3aed" stroke="white" stroke-width="1"/>
      <polygon points="0,-3.2 1.2,-1 3.4,-1 1.6,0.6 2.4,3 0,1.6 -2.4,3 -1.6,0.6 -3.4,-1 -1.2,-1" fill="white" transform="scale(0.7)"/>
    </g>
  ` : '';

  const svg = `
    <svg width="${size}" height="${Math.round(size * 1.35)}" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="atlas-pin-grad-${uniqueId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${lighterColor}"/>
          <stop offset="100%" stop-color="${color}"/>
        </linearGradient>
        <filter id="atlas-pin-shadow-${uniqueId}" x="-30%" y="-10%" width="160%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-opacity="0.35"/>
        </filter>
      </defs>
      <!-- Ground shadow -->
      <ellipse cx="12" cy="30" rx="5" ry="2" fill="rgba(0,0,0,0.2)"/>
      <!-- Pin body -->
      <path
        filter="url(#atlas-pin-shadow-${uniqueId})"
        fill="url(#atlas-pin-grad-${uniqueId})"
        stroke="#fff"
        stroke-width="1.5"
        d="M12 0C6.5 0 2 4.5 2 10c0 7 10 20 10 20s10-13 10-20c0-5.5-4.5-10-10-10z"
      />
      <!-- Inner white circle -->
      <circle cx="12" cy="10" r="6" fill="white"/>
      <!-- Status icon -->
      ${innerContent}
      <!-- Volunteer/staff star badge -->
      ${volunteerBadge}
    </svg>
  `;

  return L.divIcon({
    className: `map-marker-atlas-pin marker-${pinStyle} ${isClustered ? 'marker-clustered' : ''}`,
    html: `<div class="atlas-pin-wrapper" data-icon="${innerIcon}">${svg}</div>`,
    iconSize: [size, Math.round(size * 1.35)],
    iconAnchor: [size / 2, Math.round(size * 1.35)],
    popupAnchor: [0, -Math.round(size * 1.1)],
  });
}

/**
 * Create small dot marker for historical/unlinked entries
 */
export function createHistoricalDotMarker(
  color: string,
  options?: {
    size?: number;
    isDiseaseRisk?: boolean;
    isWatchList?: boolean;
  }
): L.DivIcon {
  const { size = 10, isDiseaseRisk = false, isWatchList = false } = options || {};
  const uniqueId = Math.random().toString(36).substr(2, 9);

  // Add warning indicator for disease/watch list
  const badge = isDiseaseRisk || isWatchList ? `
    <circle cx="${size - 2}" cy="3" r="3" fill="${isDiseaseRisk ? '#ef4444' : '#8b5cf6'}" stroke="white" stroke-width="1"/>
  ` : '';

  const svg = `
    <svg width="${size + 4}" height="${size + 4}" viewBox="0 0 ${size + 4} ${size + 4}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="dot-shadow-${uniqueId}" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.25"/>
        </filter>
      </defs>
      <circle cx="${(size + 4) / 2}" cy="${(size + 4) / 2}" r="${size / 2}"
              fill="${color}" stroke="white" stroke-width="1.5"
              filter="url(#dot-shadow-${uniqueId})"/>
      ${badge}
    </svg>
  `;

  return L.divIcon({
    className: 'map-marker-historical-dot',
    html: svg,
    iconSize: [size + 4, size + 4],
    iconAnchor: [(size + 4) / 2, (size + 4) / 2],
    popupAnchor: [0, -size / 2 - 4],
  });
}

/**
 * Create cluster icon
 */
export function createClusterIcon(
  count: number,
  color: string
): L.DivIcon {
  const size = count > 100 ? 'large' : count > 20 ? 'medium' : 'small';
  const sizeValue = size === 'large' ? 50 : size === 'medium' ? 40 : 32;

  const html = `
    <div class="map-cluster map-cluster--${size}" style="--cluster-color: ${color}">
      <span>${count}</span>
    </div>
  `;

  return L.divIcon({
    className: 'map-cluster-icon',
    html,
    iconSize: [sizeValue, sizeValue],
    iconAnchor: [sizeValue / 2, sizeValue / 2],
  });
}
