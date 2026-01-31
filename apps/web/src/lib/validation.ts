const GARBAGE_PATTERNS = [
  /^unknown$/i,
  /^n\/?a$/i,
  /^none$/i,
  /^test$/i,
  /^asdf/i,
  /^xxx+$/i,
  /^aaa+$/i,
  /^zzz+$/i,
  /^\d+$/, // all numbers
  /^(.)\1+$/, // all same character
  /^null$/i,
  /^undefined$/i,
  /^delete$/i,
  /^remove$/i,
];

export function validatePersonName(name: string): { valid: boolean; error?: string; warning?: string } {
  const trimmed = name.trim();

  if (!trimmed) {
    return { valid: false, error: "Name is required" };
  }

  if (trimmed.length < 2) {
    return { valid: false, error: "Name must be at least 2 characters" };
  }

  for (const pattern of GARBAGE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: `"${trimmed}" is not a valid name` };
    }
  }

  // Warn on ALL CAPS (but allow save)
  if (trimmed.length > 2 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
    return { valid: true, warning: "Name is in ALL CAPS — consider using proper case" };
  }

  return { valid: true };
}
