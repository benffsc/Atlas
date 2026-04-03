/**
 * Resource Scraper — Phone & Address Extraction Engine
 *
 * Fetches a web page and extracts contact information (phone numbers, addresses)
 * to compare against stored values in ops.community_resources.
 *
 * NOT an auto-updater — flags changes for staff review.
 * Designed to be resilient to HTML structure changes by using regex patterns
 * rather than CSS selectors.
 *
 * FFS-1113 (Resource scraper engine + verification cron)
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScrapeResult {
  url: string;
  success: boolean;
  phones_found: string[];
  addresses_found: string[];
  /** Raw text content (truncated) for debugging */
  text_preview: string;
  error?: string;
  fetched_at: string;
}

export interface ResourceDiff {
  field: string;
  stored: string | null;
  found: string | null;
  confidence: "high" | "medium" | "low";
}

export interface VerificationResult {
  slug: string;
  scrape_result: ScrapeResult;
  diffs: ResourceDiff[];
  status: "ok" | "changed" | "error" | "unreachable";
}

// ── Phone Extraction ─────────────────────────────────────────────────────────

/**
 * US phone number patterns — captures common formats:
 * (707) 576-7999, 707-576-7999, 707.576.7999, 7075767999, 1-707-576-7999,
 * +1 (707) 576-7999, (707) 284-FIXX
 */
const US_PHONE_PATTERNS = [
  // (NNN) NNN-NNNN or (NNN) NNN NNNN
  /\((\d{3})\)\s*(\d{3})[-.\s](\d{4}|\w{4})/g,
  // NNN-NNN-NNNN or NNN.NNN.NNNN
  /(?<!\d)(\d{3})[-.](\d{3})[-.](\d{4})(?!\d)/g,
  // 1-NNN-NNN-NNNN
  /1[-.](\d{3})[-.](\d{3})[-.](\d{4})/g,
  // +1 NNN NNN NNNN
  /\+1\s*(\d{3})\s*(\d{3})\s*(\d{4})/g,
];

/** Vanity letter map for phone numbers like 284-FIXX */
const VANITY_MAP: Record<string, string> = {
  A: "2", B: "2", C: "2",
  D: "3", E: "3", F: "3",
  G: "4", H: "4", I: "4",
  J: "5", K: "5", L: "5",
  M: "6", N: "6", O: "6",
  P: "7", Q: "7", R: "7", S: "7",
  T: "8", U: "8", V: "8",
  W: "9", X: "9", Y: "9", Z: "9",
};

function resolveVanity(phone: string): string {
  return phone.replace(/[A-Z]/gi, (ch) => VANITY_MAP[ch.toUpperCase()] || ch);
}

/**
 * Normalize a phone string to 10-digit format: "7075767999"
 */
export function normalizePhone(raw: string): string {
  const resolved = resolveVanity(raw);
  const digits = resolved.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits; // return as-is for non-standard lengths
}

/**
 * Format a 10-digit phone to display: "(707) 576-7999"
 */
export function formatPhoneDisplay(digits: string): string {
  if (digits.length !== 10) return digits;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Extract all US phone numbers from text content.
 * Returns unique normalized 10-digit strings.
 */
export function extractPhones(text: string): string[] {
  const found = new Set<string>();

  for (const pattern of US_PHONE_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      const normalized = normalizePhone(raw);
      if (normalized.length === 10) {
        found.add(normalized);
      }
    }
  }

  return Array.from(found);
}

// ── Address Extraction ───────────────────────────────────────────────────────

/**
 * Common California address patterns.
 * Looks for: number + street, city, state zip
 */
const ADDRESS_PATTERNS = [
  // Full address: 1234 Street Name, City, CA 95404
  /\d{1,6}\s+[\w\s.]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Rd|Road|Way|Hwy|Highway|Pkwy|Parkway)[\s.,]+[\w\s]+,\s*CA\s+\d{5}/gi,
  // Shorter: 1234 Street Name, City
  /\d{1,6}\s+[\w\s.]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Rd|Road|Way|Hwy|Highway|Pkwy|Parkway)[\s.,]+(?:Santa Rosa|Petaluma|Sonoma|Rohnert Park|Sebastopol|Windsor|Healdsburg|Cloverdale|Cotati)/gi,
];

/**
 * Extract addresses from text content.
 * Returns unique address strings, cleaned up.
 */
export function extractAddresses(text: string): string[] {
  const found = new Set<string>();

  for (const pattern of ADDRESS_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const cleaned = match[0]
        .replace(/\s+/g, " ")
        .replace(/,\s*$/, "")
        .trim();
      if (cleaned.length > 10) {
        found.add(cleaned);
      }
    }
  }

  return Array.from(found);
}

// ── HTML to Text ─────────────────────────────────────────────────────────────

/**
 * Strip HTML tags and decode common entities.
 * Lightweight — no dependency on DOM parser.
 */
export function htmlToText(html: string): string {
  return html
    // Remove script and style blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Replace block elements with newlines
    .replace(/<\/?(?:div|p|br|hr|h[1-6]|li|tr|td|th|section|article|header|footer|nav)[^>]*>/gi, "\n")
    // Remove remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

// ── Page Fetcher ─────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 500_000; // 500KB max — we only need text content

/**
 * Fetch a web page and extract phone numbers and addresses.
 */
export async function scrapePage(url: string): Promise<ScrapeResult> {
  const fetchedAt = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Atlas-Resource-Verifier/1.0 (FFSC community resource verification)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        url,
        success: false,
        phones_found: [],
        addresses_found: [],
        text_preview: "",
        error: `HTTP ${response.status}: ${response.statusText}`,
        fetched_at: fetchedAt,
      };
    }

    // Read body with size limit
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return {
        url,
        success: false,
        phones_found: [],
        addresses_found: [],
        text_preview: "",
        error: `Unexpected content-type: ${contentType}`,
        fetched_at: fetchedAt,
      };
    }

    const html = await response.text();
    const truncatedHtml = html.slice(0, MAX_BODY_BYTES);
    const text = htmlToText(truncatedHtml);

    const phones = extractPhones(text);
    const addresses = extractAddresses(text);

    return {
      url,
      success: true,
      phones_found: phones,
      addresses_found: addresses,
      text_preview: text.slice(0, 500),
      fetched_at: fetchedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes("abort");

    return {
      url,
      success: false,
      phones_found: [],
      addresses_found: [],
      text_preview: "",
      error: isTimeout ? "Request timed out" : message,
      fetched_at: fetchedAt,
    };
  }
}

// ── Diff Computation ─────────────────────────────────────────────────────────

/**
 * Compare scraped data against stored resource data.
 * Returns diffs with confidence levels.
 */
export function computeDiffs(
  stored: { phone: string | null; address: string | null },
  scrapeResult: ScrapeResult,
): ResourceDiff[] {
  const diffs: ResourceDiff[] = [];

  // Phone comparison
  if (stored.phone && scrapeResult.phones_found.length > 0) {
    const storedNorm = normalizePhone(stored.phone);
    const foundOnPage = scrapeResult.phones_found.includes(storedNorm);

    if (!foundOnPage) {
      // Our stored phone wasn't found on the page
      // Check if any found phone is in the same area code (local replacement)
      const storedArea = storedNorm.slice(0, 3);
      const sameAreaPhones = scrapeResult.phones_found.filter(
        (p) => p.slice(0, 3) === storedArea,
      );

      diffs.push({
        field: "phone",
        stored: stored.phone,
        found: sameAreaPhones.length > 0
          ? formatPhoneDisplay(sameAreaPhones[0])
          : `Not found (page has: ${scrapeResult.phones_found.map(formatPhoneDisplay).join(", ")})`,
        confidence: sameAreaPhones.length > 0 ? "medium" : "low",
      });
    }
    // If found on page: no diff, phone is confirmed
  }

  // Address comparison (fuzzy — just check if stored address keywords appear)
  if (stored.address && scrapeResult.addresses_found.length > 0) {
    const storedLower = stored.address.toLowerCase();
    // Extract the street number as a key identifier
    const streetNum = storedLower.match(/^\d+/)?.[0];
    const foundMatch = scrapeResult.addresses_found.some((addr) => {
      const addrLower = addr.toLowerCase();
      // Match if street number appears in found address
      return streetNum ? addrLower.includes(streetNum) : false;
    });

    if (!foundMatch) {
      diffs.push({
        field: "address",
        stored: stored.address,
        found: scrapeResult.addresses_found[0] || "Not found",
        confidence: "low",
      });
    }
  }

  return diffs;
}
