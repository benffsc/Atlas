// ---------------------------------------------------------------------------
// Pure measurement helpers (no Leaflet dependency)
// ---------------------------------------------------------------------------

export function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function formatDistance(meters: number): string {
  if (meters < 400) {
    const feet = Math.round(meters * 3.28084);
    const m = Math.round(meters);
    return `${feet} ft (${m} m)`;
  }
  const miles = meters / 1609.344;
  const km = meters / 1000;
  return `${miles.toFixed(1)} mi (${km.toFixed(1)} km)`;
}
