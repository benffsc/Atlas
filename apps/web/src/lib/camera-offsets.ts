/**
 * Camera Clock Offsets
 *
 * Known clock offsets for cameras used at FFSC clinic days.
 * Canon G7 X Mark III clock is +1 day off — photos taken on
 * e.g. March 17 have EXIF dates of March 18.
 *
 * Linear: FFS-1197
 */

interface CameraOffset {
  offsetMs: number;
  note: string;
}

const KNOWN_OFFSETS: Record<string, CameraOffset> = {
  "Canon PowerShot G7 X Mark III": { offsetMs: -86400000, note: "Clock +1 day" },
};

/**
 * Get the clock offset in milliseconds for a known camera.
 * Returns 0 for unknown cameras.
 */
export function getCameraOffset(make: string | null, model: string | null): number {
  if (!model) return 0;

  // Try exact model match first
  const exact = KNOWN_OFFSETS[model];
  if (exact) return exact.offsetMs;

  // Try "Make Model" combo
  if (make) {
    const combo = KNOWN_OFFSETS[`${make} ${model}`];
    if (combo) return combo.offsetMs;
  }

  return 0;
}

/**
 * Get human-readable offset description for display.
 */
export function getCameraOffsetLabel(make: string | null, model: string | null): string | null {
  if (!model) return null;

  const exact = KNOWN_OFFSETS[model];
  if (exact) return exact.note;

  if (make) {
    const combo = KNOWN_OFFSETS[`${make} ${model}`];
    if (combo) return combo.note;
  }

  return null;
}

/**
 * Apply camera offset to an EXIF timestamp.
 */
export function applyOffset(exifTimestamp: string, offsetMs: number): string {
  if (offsetMs === 0) return exifTimestamp;
  const adjusted = new Date(new Date(exifTimestamp).getTime() + offsetMs);
  return adjusted.toISOString();
}
