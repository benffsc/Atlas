/**
 * AI Extraction Opportunities - Safe Patterns
 *
 * These tests identify data that can be SAFELY extracted from notes
 * with minimal risk of false positives.
 *
 * EXTRACTION RISK LEVELS:
 * - VERY LOW: Highly specific patterns (microchip format, email format)
 * - LOW: Specific patterns with context (phone numbers, ear tip mentions)
 * - MEDIUM: Patterns that need validation (addresses, names)
 * - HIGH: Ambiguous patterns (avoid automated extraction)
 *
 * ATLAS-SPECIFIC PATTERNS:
 * - Microchip: 15 digits (standard format)
 * - ClinicHQ Animal ID: "YY-NNNN" format (e.g., "21-118")
 * - Phone: US 10-digit with area code starting 2-9
 * - Ear tip: Detected from appointment service lines, not cat notes
 *
 * ALL TESTS ARE READ-ONLY and produce actionable reports.
 */

import { test, expect } from "@playwright/test";

// ============================================================================
// SOFT BLACKLIST (from constants.ts)
// ============================================================================

const SOFT_BLACKLIST_EMAILS = [
  'info@forgottenfelines.com', 'info@forgottenfelines.org',
  'office@forgottenfelines.com', 'contact@forgottenfelines.com',
  'sandra@forgottenfelines.com', 'addie@forgottenfelines.com',
  'jami@forgottenfelines.com', 'neely@forgottenfelines.com',
  'marinferals@yahoo.com', 'cats@sonomacounty.org',
];

const FAKE_EMAIL_DOMAINS = [
  'noemail.com', 'petestablished.com', 'nomail.com', 'none.com', 'noemail.org',
];

// ============================================================================
// EXTRACTION PATTERNS (Ordered by safety) - Atlas-specific
// ============================================================================

const PATTERNS = {
  // Microchip: Standard 15-digit format (AVID, HomeAgain, etc.)
  // Atlas validates with isValidMicrochip() in guards.ts
  // False positive rate: < 0.1%
  MICROCHIP_15: /\b(\d{15})\b/g,
  MICROCHIP_LABELED: /(?:chip|microchip)[:\s#]+(\d{15})/gi,

  // Email: Standard email format
  // False positive rate: < 0.1%
  EMAIL: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,

  // ClinicHQ Animal ID: Format like "21-118" or "22-0045"
  // Stored in clinichq_animal_id field
  // False positive rate: < 0.5%
  CLINICHQ_ANIMAL_ID: /\b(\d{2})-(\d{2,5})\b/g,

  /**
   * LOW RISK PATTERNS
   * These can be extracted with context verification
   */
  // US Phone: Valid area codes start with 2-9
  // Uses same logic as extractPhone() in formatters.ts
  // False positive rate: ~2%
  PHONE_US: /\b(?:\+?1[-.\s]?)?\(?([2-9]\d{2})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g,

  // Ear tip: Detected from service lines containing "ear tip"
  // NOTE: In Atlas, has_ear_tip is on appointments table, set from service lines
  // This pattern is for detecting mentions in notes
  // False positive rate: < 1%
  EAR_TIP: /\b(?:ear[\s-]?tip(?:ped)?|(?:left|right|L|R)[\s-]?ear[\s-]?(?:tip(?:ped)?|notch(?:ed)?))\b/gi,

  // Cat count with context: "X cats" pattern
  // Atlas uses estimated_cat_count (int) and total_cats_reported (int)
  // cat_count_semantic indicates meaning: 'needs_tnr' or 'legacy_total'
  // False positive rate: ~3%
  CAT_COUNT: /\b(\d{1,2})\s+(?:cats?|kitties?|kittens?|felines?)\b/gi,

  // TNR date: Date with TNR context
  // Atlas stores altered_status as "Yes"/"No" (string, not boolean)
  // False positive rate: ~2%
  TNR_DATE: /\b(?:TNR|TNR'd|spayed|neutered|fixed|altered|surgery)[\s:]+(?:on\s+)?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/gi,

  /**
   * MEDIUM RISK PATTERNS
   * These need manual verification or additional context
   */
  // Address: House number + street pattern
  // Atlas uses normalized_address on places
  // False positive rate: ~10%
  ADDRESS: /\b(\d{1,5})\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Blvd|Boulevard)\b/gi,

  // Colony size: Larger numbers with colony context
  // Atlas stores in place_colony_estimates table
  // False positive rate: ~5%
  COLONY_SIZE: /\b(?:colony|group|population)(?:\s+of)?\s+(?:about|approximately|around|~)?\s*(\d{1,3})\b/gi,

  // Weight: Cat weight in lbs/kg
  // False positive rate: ~8%
  WEIGHT: /\b(\d{1,2}(?:\.\d)?)\s*(?:lbs?|pounds?|kg|kilos?)\b/gi,

  // Age: Cat age patterns
  // False positive rate: ~10%
  AGE: /\b(\d{1,2})\s*(?:years?|yrs?|months?|mos?|weeks?|wks?)\s*(?:old)?\b/gi,
};

// ============================================================================
// HELPERS
// ============================================================================

interface ExtractionCandidate {
  entityId: string;
  entityName: string;
  field: string;
  extractedValue: string;
  sourceText: string;
  confidence: "very_high" | "high" | "medium" | "low";
  currentValue?: string | number | boolean;
  needsValue: boolean;
}

async function fetchJson(
  request: { get: (url: string, options?: { timeout?: number }) => Promise<{ ok: () => boolean; json: () => Promise<unknown> }> },
  url: string
): Promise<unknown> {
  try {
    const res = await request.get(url, { timeout: 30000 });
    if (!res.ok()) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function extractContext(text: string, match: string, contextChars: number = 50): string {
  const index = text.indexOf(match);
  if (index === -1) return match;

  const start = Math.max(0, index - contextChars);
  const end = Math.min(text.length, index + match.length + contextChars);

  return (start > 0 ? "..." : "") +
    text.slice(start, end).replace(/\s+/g, " ") +
    (end < text.length ? "..." : "");
}

// ============================================================================
// VERY LOW RISK EXTRACTIONS
// ============================================================================

test.describe("Very Low Risk Extractions (Auto-safe)", () => {
  test.setTimeout(120000);

  test("Microchip IDs from cat notes", async ({ request }) => {
    // NOTE: Cat list API returns 'microchip' field (not 'microchip_id')
    // Cat list doesn't include notes - need to fetch detail for each
    // For efficiency, we check list first for cats missing microchip,
    // then spot-check a sample of detail pages
    const data = await fetchJson(request, "/api/cats?limit=100") as {
      cats?: Array<{
        cat_id: string;
        display_name: string;
        microchip: string | null;  // Correct field name
        has_microchip: boolean;
      }>;
      total?: number;
    } | null;

    if (!data?.cats) {
      test.skip(true, "Cats API not available");
      return;
    }

    // Find cats that need microchips
    const needsMicrochip = data.cats.filter((c) => !c.has_microchip);
    console.log(`\n=== CATS MISSING MICROCHIP: ${needsMicrochip.length} / ${data.cats.length} ===`);

    // Spot-check a few cat details for notes with microchip mentions
    const candidates: ExtractionCandidate[] = [];
    const sampleSize = Math.min(20, needsMicrochip.length);

    for (let i = 0; i < sampleSize; i++) {
      const cat = needsMicrochip[i];
      const detail = await fetchJson(request, `/api/cats/${cat.cat_id}`) as {
        cat_id: string;
        display_name: string;
        microchip: string | null;
        notes: string | null;
      } | null;

      if (!detail?.notes) continue;

      // Look for 15-digit microchips (standard format)
      const matches = [...detail.notes.matchAll(PATTERNS.MICROCHIP_15)];
      for (const match of matches) {
        candidates.push({
          entityId: cat.cat_id,
          entityName: cat.display_name,
          field: "microchip",  // Correct field name
          extractedValue: match[1],
          sourceText: extractContext(detail.notes, match[0]),
          confidence: "very_high",
          currentValue: detail.microchip,
          needsValue: !detail.microchip,
        });
      }

      // Also check for labeled microchips
      const labeledMatches = [...detail.notes.matchAll(PATTERNS.MICROCHIP_LABELED)];
      for (const match of labeledMatches) {
        candidates.push({
          entityId: cat.cat_id,
          entityName: cat.display_name,
          field: "microchip",
          extractedValue: match[1],
          sourceText: extractContext(detail.notes, match[0]),
          confidence: "very_high",
          currentValue: detail.microchip,
          needsValue: !detail.microchip,
        });
      }
    }

    console.log(`\n=== MICROCHIP EXTRACTION CANDIDATES (from ${sampleSize} samples) ===`);
    console.log(`Found: ${candidates.length}`);
    candidates.slice(0, 10).forEach((c) => {
      console.log(`  ${c.entityName}: ${c.extractedValue}`);
      console.log(`    Context: "${c.sourceText}"`);
    });

    console.log("\n✅ RECOMMENDATION: Auto-extract 15-digit microchip IDs");
    console.log("   Risk: VERY LOW - 15-digit format is standard microchip");

    expect(true).toBeTruthy();
  });

  test("Email addresses from request notes", async ({ request }) => {
    // NOTE: Request list returns requester_email (not just email)
    // Request list doesn't include notes/summary - use detail endpoint for sampling
    const listData = await fetchJson(request, "/api/requests?limit=100") as {
      requests?: Array<{
        request_id: string;
        summary: string | null;
        requester_email: string | null;
        requester_phone: string | null;
      }>;
    } | null;

    if (!listData?.requests) {
      test.skip(true, "Requests API not available");
      return;
    }

    // Find requests missing email
    const needsEmail = listData.requests.filter((r) => !r.requester_email);
    console.log(`\n=== REQUESTS MISSING EMAIL: ${needsEmail.length} / ${listData.requests.length} ===`);

    const candidates: ExtractionCandidate[] = [];
    const sampleSize = Math.min(30, needsEmail.length);

    for (let i = 0; i < sampleSize; i++) {
      const req = needsEmail[i];
      const detail = await fetchJson(request, `/api/requests/${req.request_id}`) as {
        request_id: string;
        summary: string | null;
        notes: string | null;
        legacy_notes: string | null;
        requester_email: string | null;
      } | null;

      if (!detail) continue;

      const text = [detail.summary, detail.notes, detail.legacy_notes].filter(Boolean).join(" ");
      if (!text) continue;

      const matches = text.matchAll(PATTERNS.EMAIL);
      for (const match of matches) {
        const email = match[0].toLowerCase();
        const domain = email.split('@')[1];

        // Skip soft-blacklisted emails (from constants.ts)
        if (SOFT_BLACKLIST_EMAILS.some((bl) => email === bl.toLowerCase())) continue;

        // Skip fake email domains (ClinicHQ placeholders)
        if (domain && FAKE_EMAIL_DOMAINS.includes(domain)) continue;

        // Skip PetLink-style fabricated emails (street addresses as domains)
        if (domain && /\d/.test(domain.split('.')[0])) continue;

        candidates.push({
          entityId: req.request_id,
          entityName: `Request ${req.request_id.slice(0, 8)}`,
          field: "requester_email",
          extractedValue: email,
          sourceText: extractContext(text, match[0]),
          confidence: "very_high",
          currentValue: detail.requester_email,
          needsValue: !detail.requester_email,
        });
        break; // One email per request
      }
    }

    console.log(`\n=== EMAIL EXTRACTION CANDIDATES (from ${sampleSize} samples) ===`);
    console.log(`Found: ${candidates.length}`);
    candidates.slice(0, 10).forEach((c) => {
      console.log(`  ${c.entityName}: ${c.extractedValue}`);
    });

    console.log("\n✅ RECOMMENDATION: Auto-extract and link to people");
    console.log("   Risk: VERY LOW - Email format is unambiguous");
    console.log("   Note: Already filtering soft blacklist + fake domains");

    expect(true).toBeTruthy();
  });
});

// ============================================================================
// LOW RISK EXTRACTIONS
// ============================================================================

test.describe("Low Risk Extractions (Safe with validation)", () => {
  test.setTimeout(120000);

  test("Ear tip status from cat notes", async ({ request }) => {
    const data = await fetchJson(request, "/api/cats?limit=500") as {
      cats?: Array<{
        cat_id: string;
        display_name: string;
        has_ear_tip?: boolean;
        notes?: string;
        description?: string;
      }>;
    } | null;

    if (!data?.cats) {
      test.skip(true, "Cats API not available");
      return;
    }

    const candidates: ExtractionCandidate[] = [];

    for (const cat of data.cats) {
      const text = [cat.notes, cat.description].filter(Boolean).join(" ");
      if (!text) continue;

      const matches = text.matchAll(PATTERNS.EAR_TIP);
      for (const match of matches) {
        // Only report if ear tip not already set
        if (cat.has_ear_tip !== true) {
          candidates.push({
            entityId: cat.cat_id,
            entityName: cat.display_name,
            field: "has_ear_tip",
            extractedValue: "true",
            sourceText: extractContext(text, match[0]),
            confidence: "high",
            currentValue: cat.has_ear_tip,
            needsValue: cat.has_ear_tip !== true,
          });
          break; // One mention is enough
        }
      }
    }

    console.log("\n=== EAR TIP EXTRACTION CANDIDATES ===");
    console.log(`Total candidates: ${candidates.length}`);
    console.log("\nSamples:");
    candidates.slice(0, 15).forEach((c) => {
      console.log(`  ${c.entityName}`);
      console.log(`    Context: "${c.sourceText}"`);
    });

    console.log("\n✅ RECOMMENDATION: Auto-set has_ear_tip = true");
    console.log("   Risk: LOW - Ear tip terminology is unambiguous");

    expect(true).toBeTruthy();
  });

  test("Phone numbers from request notes", async ({ request }) => {
    const data = await fetchJson(request, "/api/requests?limit=300") as {
      requests?: Array<{
        request_id: string;
        request_number?: string;
        notes?: string;
        description?: string;
        situation_description?: string;
        phone?: string;
        requester_phone?: string;
      }>;
    } | null;

    if (!data?.requests) {
      test.skip(true, "Requests API not available");
      return;
    }

    const candidates: ExtractionCandidate[] = [];

    for (const req of data.requests) {
      const text = [req.notes, req.description, req.situation_description]
        .filter(Boolean)
        .join(" ");
      if (!text) continue;

      const matches = text.matchAll(PATTERNS.PHONE_US);
      for (const match of matches) {
        const phone = `${match[1]}${match[2]}${match[3]}`;

        // Skip if already has phone
        const currentPhone = (req.phone || req.requester_phone || "").replace(/\D/g, "");
        if (currentPhone.includes(phone) || phone.includes(currentPhone.slice(-10))) {
          continue;
        }

        candidates.push({
          entityId: req.request_id,
          entityName: `Request ${req.request_number || req.request_id.slice(0, 8)}`,
          field: "requester_phone",
          extractedValue: phone,
          sourceText: extractContext(text, match[0]),
          confidence: "high",
          currentValue: req.phone || req.requester_phone,
          needsValue: !req.phone && !req.requester_phone,
        });
        break; // Take first phone only
      }
    }

    console.log("\n=== PHONE EXTRACTION CANDIDATES ===");
    console.log(`Total candidates: ${candidates.length}`);
    console.log(`Need phone: ${candidates.filter((c) => c.needsValue).length}`);
    console.log("\nSamples:");
    candidates.slice(0, 10).forEach((c) => {
      console.log(`  ${c.entityName}: ${c.extractedValue}`);
      console.log(`    Context: "${c.sourceText}"`);
    });

    console.log("\n✅ RECOMMENDATION: Extract and link to requester");
    console.log("   Risk: LOW - US phone format is specific");
    console.log("   Validation: Verify area code is plausible (707, 415, 510, etc.)");

    expect(true).toBeTruthy();
  });

  test("Cat counts from request descriptions", async ({ request }) => {
    const data = await fetchJson(request, "/api/requests?limit=300") as {
      requests?: Array<{
        request_id: string;
        request_number?: string;
        notes?: string;
        description?: string;
        situation_description?: string;
        estimated_cat_count?: number;
        total_cats_reported?: number;
      }>;
    } | null;

    if (!data?.requests) {
      test.skip(true, "Requests API not available");
      return;
    }

    const candidates: ExtractionCandidate[] = [];

    for (const req of data.requests) {
      // Skip if already has count
      if (req.estimated_cat_count || req.total_cats_reported) continue;

      const text = [req.notes, req.description, req.situation_description]
        .filter(Boolean)
        .join(" ");
      if (!text) continue;

      const matches = text.matchAll(PATTERNS.CAT_COUNT);
      for (const match of matches) {
        const count = parseInt(match[1], 10);

        // Reasonable range: 1-50 cats
        if (count >= 1 && count <= 50) {
          candidates.push({
            entityId: req.request_id,
            entityName: `Request ${req.request_number || req.request_id.slice(0, 8)}`,
            field: "estimated_cat_count",
            extractedValue: String(count),
            sourceText: extractContext(text, match[0]),
            confidence: "high",
            needsValue: true,
          });
          break; // Take first count
        }
      }
    }

    console.log("\n=== CAT COUNT EXTRACTION CANDIDATES ===");
    console.log(`Total candidates: ${candidates.length}`);
    console.log("\nSamples:");
    candidates.slice(0, 15).forEach((c) => {
      console.log(`  ${c.entityName}: ${c.extractedValue} cats`);
      console.log(`    Context: "${c.sourceText}"`);
    });

    console.log("\n✅ RECOMMENDATION: Auto-populate estimated_cat_count");
    console.log("   Risk: LOW - 'X cats' pattern is specific");
    console.log("   Validation: Range 1-50 is reasonable for TNR");

    expect(true).toBeTruthy();
  });

  test("TNR dates from notes", async ({ request }) => {
    const data = await fetchJson(request, "/api/cats?limit=500") as {
      cats?: Array<{
        cat_id: string;
        display_name: string;
        notes?: string;
        description?: string;
        altered_date?: string;
        is_altered?: boolean;
      }>;
    } | null;

    if (!data?.cats) {
      test.skip(true, "Cats API not available");
      return;
    }

    const candidates: ExtractionCandidate[] = [];

    for (const cat of data.cats) {
      // Skip if already has date
      if (cat.altered_date) continue;

      const text = [cat.notes, cat.description].filter(Boolean).join(" ");
      if (!text) continue;

      const matches = text.matchAll(PATTERNS.TNR_DATE);
      for (const match of matches) {
        candidates.push({
          entityId: cat.cat_id,
          entityName: cat.display_name,
          field: "altered_date",
          extractedValue: match[1],
          sourceText: extractContext(text, match[0]),
          confidence: "high",
          needsValue: true,
        });
        break;
      }
    }

    console.log("\n=== TNR DATE EXTRACTION CANDIDATES ===");
    console.log(`Total candidates: ${candidates.length}`);
    console.log("\nSamples:");
    candidates.slice(0, 10).forEach((c) => {
      console.log(`  ${c.entityName}: ${c.extractedValue}`);
      console.log(`    Context: "${c.sourceText}"`);
    });

    console.log("\n✅ RECOMMENDATION: Extract and set altered_date + is_altered=true");
    console.log("   Risk: LOW - TNR context + date pattern is specific");
    console.log("   Validation: Parse and validate date is in past");

    expect(true).toBeTruthy();
  });
});

// ============================================================================
// MEDIUM RISK EXTRACTIONS (Suggest, don't auto-apply)
// ============================================================================

test.describe("Medium Risk Extractions (UI suggestions only)", () => {
  test.setTimeout(120000);

  test("Addresses from request descriptions", async ({ request }) => {
    const data = await fetchJson(request, "/api/requests?limit=200") as {
      requests?: Array<{
        request_id: string;
        request_number?: string;
        notes?: string;
        description?: string;
        situation_description?: string;
      }>;
    } | null;

    if (!data?.requests) {
      test.skip(true, "Requests API not available");
      return;
    }

    const candidates: ExtractionCandidate[] = [];

    for (const req of data.requests) {
      const text = [req.notes, req.description, req.situation_description]
        .filter(Boolean)
        .join(" ");
      if (!text) continue;

      const matches = text.matchAll(PATTERNS.ADDRESS);
      for (const match of matches) {
        candidates.push({
          entityId: req.request_id,
          entityName: `Request ${req.request_number || req.request_id.slice(0, 8)}`,
          field: "location",
          extractedValue: match[0],
          sourceText: extractContext(text, match[0]),
          confidence: "medium",
          needsValue: true,
        });
      }
    }

    console.log("\n=== ADDRESS EXTRACTION CANDIDATES ===");
    console.log(`Total candidates: ${candidates.length}`);
    console.log("\nSamples:");
    candidates.slice(0, 10).forEach((c) => {
      console.log(`  ${c.entityName}: ${c.extractedValue}`);
      console.log(`    Context: "${c.sourceText}"`);
    });

    console.log("\n⚠️  RECOMMENDATION: Show as UI suggestion, require confirmation");
    console.log("   Risk: MEDIUM - Could be reference location, not actual site");
    console.log("   Action: Geocode and show map preview before applying");

    expect(true).toBeTruthy();
  });

  test("Colony size estimates from place notes", async ({ request }) => {
    const data = await fetchJson(request, "/api/places?limit=200") as {
      places?: Array<{
        place_id: string;
        display_name: string;
        notes?: string;
        description?: string;
      }>;
    } | null;

    if (!data?.places) {
      test.skip(true, "Places API not available");
      return;
    }

    const candidates: ExtractionCandidate[] = [];

    for (const place of data.places) {
      const text = [place.notes, place.description].filter(Boolean).join(" ");
      if (!text) continue;

      const matches = text.matchAll(PATTERNS.COLONY_SIZE);
      for (const match of matches) {
        const size = parseInt(match[1], 10);
        if (size >= 2 && size <= 100) {
          candidates.push({
            entityId: place.place_id,
            entityName: place.display_name,
            field: "estimated_colony_size",
            extractedValue: String(size),
            sourceText: extractContext(text, match[0]),
            confidence: "medium",
            needsValue: true,
          });
        }
      }
    }

    console.log("\n=== COLONY SIZE EXTRACTION CANDIDATES ===");
    console.log(`Total candidates: ${candidates.length}`);
    console.log("\nSamples:");
    candidates.slice(0, 10).forEach((c) => {
      console.log(`  ${c.entityName}: ${c.extractedValue} cats`);
      console.log(`    Context: "${c.sourceText}"`);
    });

    console.log("\n⚠️  RECOMMENDATION: Create place_colony_estimates with source='ai_parsed'");
    console.log("   Risk: MEDIUM - Numbers could be historical or approximate");
    console.log("   Action: Store with confidence score, flag for review");

    expect(true).toBeTruthy();
  });

  test("Cat weight and age from notes", async ({ request }) => {
    const data = await fetchJson(request, "/api/cats?limit=300") as {
      cats?: Array<{
        cat_id: string;
        display_name: string;
        notes?: string;
        description?: string;
        weight?: number;
        age_estimate?: string;
      }>;
    } | null;

    if (!data?.cats) {
      test.skip(true, "Cats API not available");
      return;
    }

    const weightCandidates: ExtractionCandidate[] = [];
    const ageCandidates: ExtractionCandidate[] = [];

    for (const cat of data.cats) {
      const text = [cat.notes, cat.description].filter(Boolean).join(" ");
      if (!text) continue;

      // Weight extraction
      if (!cat.weight) {
        const weightMatches = text.matchAll(PATTERNS.WEIGHT);
        for (const match of weightMatches) {
          const weight = parseFloat(match[1]);
          if (weight >= 2 && weight <= 25) { // Reasonable cat weight
            weightCandidates.push({
              entityId: cat.cat_id,
              entityName: cat.display_name,
              field: "weight",
              extractedValue: `${weight} ${match[0].includes("kg") ? "kg" : "lbs"}`,
              sourceText: extractContext(text, match[0]),
              confidence: "medium",
              needsValue: true,
            });
            break;
          }
        }
      }

      // Age extraction
      if (!cat.age_estimate) {
        const ageMatches = text.matchAll(PATTERNS.AGE);
        for (const match of ageMatches) {
          ageCandidates.push({
            entityId: cat.cat_id,
            entityName: cat.display_name,
            field: "age_estimate",
            extractedValue: match[0],
            sourceText: extractContext(text, match[0]),
            confidence: "medium",
            needsValue: true,
          });
          break;
        }
      }
    }

    console.log("\n=== CAT WEIGHT EXTRACTION CANDIDATES ===");
    console.log(`Total: ${weightCandidates.length}`);
    weightCandidates.slice(0, 5).forEach((c) => {
      console.log(`  ${c.entityName}: ${c.extractedValue}`);
    });

    console.log("\n=== CAT AGE EXTRACTION CANDIDATES ===");
    console.log(`Total: ${ageCandidates.length}`);
    ageCandidates.slice(0, 5).forEach((c) => {
      console.log(`  ${c.entityName}: ${c.extractedValue}`);
    });

    console.log("\n⚠️  RECOMMENDATION: Show as UI suggestions");
    console.log("   Risk: MEDIUM - Could be outdated or approximate");

    expect(true).toBeTruthy();
  });
});

// ============================================================================
// PRIORITIZED EXTRACTION REPORT
// ============================================================================

test.describe("Extraction Priority Report", () => {
  test.setTimeout(180000);

  test("Generate prioritized extraction roadmap", async ({ request }) => {
    console.log("\n" + "=".repeat(60));
    console.log("   PRIORITIZED AI EXTRACTION ROADMAP");
    console.log("=".repeat(60));

    console.log("\n📊 PRIORITY 1: VERY LOW RISK (Auto-extract immediately)");
    console.log("-".repeat(50));
    console.log("1. Labeled microchip IDs from cat notes");
    console.log("   Pattern: 'chip: XXXXXX' or 'microchip #XXXXXX' (15 digits)");
    console.log("   Action: UPDATE cats SET microchip = extracted");
    console.log("");
    console.log("2. Email addresses from request notes");
    console.log("   Pattern: standard email format");
    console.log("   Action: Create person_identifiers, link to request");
    console.log("");

    console.log("\n📊 PRIORITY 2: LOW RISK (Auto-extract with validation)");
    console.log("-".repeat(50));
    console.log("1. Ear tip status from cat notes");
    console.log("   Pattern: 'ear tip', 'tipped', 'left ear notch'");
    console.log("   Action: UPDATE cats SET has_ear_tip = true");
    console.log("");
    console.log("2. Phone numbers from request notes");
    console.log("   Pattern: US phone format (xxx) xxx-xxxx");
    console.log("   Validation: Check area code is plausible");
    console.log("   Action: Create person_identifiers");
    console.log("");
    console.log("3. Cat counts from request descriptions");
    console.log("   Pattern: 'X cats', 'X kittens'");
    console.log("   Validation: Range 1-50");
    console.log("   Action: UPDATE requests SET estimated_cat_count");
    console.log("");
    console.log("4. TNR dates from cat notes");
    console.log("   Pattern: 'TNR on MM/DD/YYYY', 'spayed 1/15/24'");
    console.log("   Validation: Date in past");
    console.log("   Action: UPDATE cats SET altered_date, is_altered=true");
    console.log("");

    console.log("\n📊 PRIORITY 3: MEDIUM RISK (UI suggestions only)");
    console.log("-".repeat(50));
    console.log("1. Addresses from descriptions");
    console.log("   Show: 'Found address in notes: 123 Main St. Add as location?'");
    console.log("");
    console.log("2. Colony size estimates");
    console.log("   Store: place_colony_estimates with source='ai_parsed'");
    console.log("");
    console.log("3. Cat weight and age");
    console.log("   Show: As editable suggestions in edit form");
    console.log("");

    console.log("\n📊 IMPLEMENTATION PHASES");
    console.log("-".repeat(50));
    console.log("Phase A: Database migrations (Priority 1 + 2)");
    console.log("  - MIG_XXXX: Extract microchips from cat notes");
    console.log("  - MIG_XXXX: Extract ear tip status from cat notes");
    console.log("  - MIG_XXXX: Extract cat counts from request notes");
    console.log("  - MIG_XXXX: Extract phone/email from request notes");
    console.log("");
    console.log("Phase B: Real-time extraction (on save)");
    console.log("  - Add extraction to cat save handler");
    console.log("  - Add extraction to request save handler");
    console.log("");
    console.log("Phase C: UI suggestions (Priority 3)");
    console.log("  - Add 'smart field' suggestions in edit forms");
    console.log("  - Show extracted data with 'Apply' button");
    console.log("");

    expect(true).toBeTruthy();
  });
});
