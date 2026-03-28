/**
 * Name parsing utilities for splitting display names into structured parts.
 * Used by PersonReferencePicker and PersonSection.
 */

const PARTICLES = new Set([
  "de", "del", "della", "di", "du", "el", "la", "le", "lo",
  "van", "von", "der", "den", "het", "ter",
]);

const SUFFIXES = new Set([
  "jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "esq", "esq.",
]);

export interface ParsedName {
  first_name: string;
  last_name: string;
  suffix: string;
}

/**
 * Parse a display name into first_name, last_name, and suffix.
 *
 * Algorithm:
 * 1. Strip trailing suffix (Jr, Sr, II, III, IV, Esq)
 * 2. First token = first_name
 * 3. Scan remaining tokens: particles (de, van, von, etc.) attach to last_name
 *
 * Examples:
 *   "Maria de la Cruz Jr." → { first_name: "Maria", last_name: "de la Cruz", suffix: "Jr." }
 *   "Sarah Jones" → { first_name: "Sarah", last_name: "Jones", suffix: "" }
 *   "Cher" → { first_name: "Cher", last_name: "", suffix: "" }
 */
export function parseName(displayName: string): ParsedName {
  const tokens = displayName.trim().split(/\s+/);
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === "")) {
    return { first_name: "", last_name: "", suffix: "" };
  }

  // Strip trailing suffix
  let suffix = "";
  if (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) {
    suffix = tokens.pop()!;
  }

  if (tokens.length === 0) {
    return { first_name: "", last_name: "", suffix };
  }

  if (tokens.length === 1) {
    return { first_name: tokens[0], last_name: "", suffix };
  }

  const firstName = tokens[0];
  const rest = tokens.slice(1);

  // Scan from the start of rest: if a token is a particle, it and everything
  // after it form the last name (particles attach forward).
  let lastNameStart = rest.length; // default: no particles found
  for (let i = 0; i < rest.length; i++) {
    if (PARTICLES.has(rest[i].toLowerCase())) {
      lastNameStart = i;
      break;
    }
  }

  // If no particles found, last token(s) = last name.
  // For "John Michael Smith": first="John", last="Michael Smith"?
  // Simpler: first token = first, everything else = last.
  // That matches the original behavior and handles particles correctly.
  const lastName = rest.join(" ");

  return { first_name: firstName, last_name: lastName, suffix };
}
