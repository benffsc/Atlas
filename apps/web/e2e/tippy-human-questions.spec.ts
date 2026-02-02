/**
 * Tippy Human-Style Question Tests
 *
 * Tests Tippy with vague, natural-language questions that real staff ask.
 * Uses actual database entities fetched from list APIs, then asks about them
 * using casual phrasing. Catches regressions where Tippy falls through to
 * "I'm not sure how to help with that" despite having the data.
 *
 * Also tests the feedback submission API end-to-end.
 *
 * ALL TESTS ARE READ-ONLY against real data. Feedback tests use the real API
 * but create minimal records that are safe (just feedback/improvement rows).
 */

import { test, expect } from "@playwright/test";

// ============================================================================
// HELPERS
// ============================================================================

interface TippyResponse {
  message: string;
  conversationId?: string;
}

async function askTippy(
  request: {
    post: (
      url: string,
      options: { data: unknown }
    ) => Promise<{ ok: () => boolean; json: () => Promise<TippyResponse> }>;
  },
  question: string,
  conversationId?: string
): Promise<TippyResponse & { ok: boolean }> {
  const response = await request.post("/api/tippy/chat", {
    data: {
      message: question,
      ...(conversationId ? { conversationId } : {}),
    },
  });

  const ok = response.ok();
  const data = await response.json();

  return {
    ok,
    message: data.message || "",
    conversationId: data.conversationId,
  };
}

/** Verify a response contains real data, not a fallback */
function expectRealResponse(message: string) {
  expect(message.toLowerCase()).not.toContain("not sure how to help");
  expect(message.toLowerCase()).not.toContain("i don't have access");
  expect(message.toLowerCase()).not.toContain("i cannot");
  expect(message).not.toBe("");
  expect(message.length).toBeGreaterThan(30);
}

interface PlaceEntity {
  place_id: string;
  formatted_address?: string;
  label?: string;
  normalized_address?: string;
}

interface PersonEntity {
  person_id: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
}

/** Fetch a real place from the API */
async function getRealPlace(request: {
  get: (
    url: string,
    options?: { timeout?: number }
  ) => Promise<{ ok: () => boolean; json: () => Promise<{ places?: PlaceEntity[] }> }>;
}): Promise<PlaceEntity | null> {
  try {
    const res = await request.get("/api/places?limit=5", { timeout: 15000 });
    if (!res.ok()) return null;
    const data = await res.json();
    // Prefer a place with a formatted address
    const withAddress = data.places?.find(
      (p: PlaceEntity) => p.formatted_address && p.formatted_address.length > 5
    );
    return withAddress || data.places?.[0] || null;
  } catch {
    return null;
  }
}

/** Fetch a real person from the API */
async function getRealPerson(request: {
  get: (
    url: string,
    options?: { timeout?: number }
  ) => Promise<{ ok: () => boolean; json: () => Promise<{ people?: PersonEntity[] }> }>;
}): Promise<PersonEntity | null> {
  try {
    const res = await request.get("/api/people?limit=5", { timeout: 15000 });
    if (!res.ok()) return null;
    const data = await res.json();
    const withName = data.people?.find(
      (p: PersonEntity) => p.display_name && p.display_name.length > 2
    );
    return withName || data.people?.[0] || null;
  } catch {
    return null;
  }
}

// ============================================================================
// ADDRESS / PLACE LOOKUP TESTS
// These test the exact class of bug reported: vague address queries
// ============================================================================

test.describe("Tippy: Human-Style Address Questions", () => {
  test.setTimeout(120000); // 2 min — Tippy needs time for tool calls

  let place: PlaceEntity | null = null;

  test("What do we know about [address]?", async ({ request }) => {
    place = await getRealPlace(request);
    test.skip(!place?.formatted_address, "No places with addresses in database");

    const address = place!.formatted_address!;
    const { ok, message } = await askTippy(
      request,
      `what do we know about ${address}?`
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
  });

  test("Cats at [address]?", async ({ request }) => {
    if (!place) place = await getRealPlace(request);
    test.skip(!place?.formatted_address, "No places with addresses in database");

    const address = place!.formatted_address!;
    const { ok, message } = await askTippy(
      request,
      `cats at ${address}?`
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
  });

  test("What's the situation at [address]?", async ({ request }) => {
    if (!place) place = await getRealPlace(request);
    test.skip(!place?.formatted_address, "No places with addresses in database");

    const address = place!.formatted_address!;
    const { ok, message } = await askTippy(
      request,
      `what's the situation at ${address}?`
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
  });

  test("Any activity at [address]?", async ({ request }) => {
    if (!place) place = await getRealPlace(request);
    test.skip(!place?.formatted_address, "No places with addresses in database");

    const address = place!.formatted_address!;
    const { ok, message } = await askTippy(
      request,
      `any activity at ${address}?`
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
  });

  test("How many cats at [address]?", async ({ request }) => {
    if (!place) place = await getRealPlace(request);
    test.skip(!place?.formatted_address, "No places with addresses in database");

    const address = place!.formatted_address!;
    const { ok, message } = await askTippy(
      request,
      `how many cats are at ${address}?`
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
  });

  test("Colony status at [address]", async ({ request }) => {
    if (!place) place = await getRealPlace(request);
    test.skip(!place?.formatted_address, "No places with addresses in database");

    const address = place!.formatted_address!;
    const { ok, message } = await askTippy(
      request,
      `colony status at ${address}`
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
  });
});

// ============================================================================
// PERSON LOOKUP TESTS
// ============================================================================

test.describe("Tippy: Human-Style Person Questions", () => {
  test.setTimeout(120000);

  let person: PersonEntity | null = null;

  test("Tell me about [person name]", async ({ request }) => {
    person = await getRealPerson(request);
    test.skip(!person?.display_name, "No people with names in database");

    const name = person!.display_name!;
    const { ok, message } = await askTippy(
      request,
      `tell me about ${name}`
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
  });

  test("What do we know about [person name]?", async ({ request }) => {
    if (!person) person = await getRealPerson(request);
    test.skip(!person?.display_name, "No people with names in database");

    const name = person!.display_name!;
    const { ok, message } = await askTippy(
      request,
      `what do we know about ${name}?`
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
  });
});

// ============================================================================
// GENERAL STATS & OVERVIEW QUESTIONS
// ============================================================================

test.describe("Tippy: Human-Style Stats Questions", () => {
  test.setTimeout(120000);

  test("How are we doing overall?", async ({ request }) => {
    const { ok, message } = await askTippy(
      request,
      "how are we doing overall?"
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
    // Should contain some numbers or statistics
    expect(message).toMatch(/\d/);
  });

  test("How many active trappers do we have?", async ({ request }) => {
    const { ok, message } = await askTippy(
      request,
      "how many active trappers do we have?"
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
    expect(message).toMatch(/\d/);
  });

  test("How many staff members do we have?", async ({ request }) => {
    const { ok, message } = await askTippy(
      request,
      "how many staff members do we have?"
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
    expect(message).toMatch(/\d/);
  });

  test("How many cats in Santa Rosa?", async ({ request }) => {
    const { ok, message } = await askTippy(
      request,
      "how many cats in Santa Rosa?"
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
  });

  test("Any urgent requests right now?", async ({ request }) => {
    const { ok, message } = await askTippy(
      request,
      "any urgent requests right now?"
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
  });
});

// ============================================================================
// GRACEFUL FAILURE TESTS
// ============================================================================

test.describe("Tippy: Graceful Handling", () => {
  test.setTimeout(120000);

  test("Handles non-existent address gracefully", async ({ request }) => {
    const { ok, message } = await askTippy(
      request,
      "what about 99999 Fake Boulevard, Atlantis, CA 00000?"
    );

    expect(ok).toBeTruthy();
    // Should NOT crash or return empty — should explain not found
    expect(message.length).toBeGreaterThan(20);
    expect(message.toLowerCase()).not.toMatch(/error|exception|crash/i);
  });

  test("Navigation question returns helpful text", async ({ request }) => {
    const { ok, message } = await askTippy(
      request,
      "how do I create a new request?"
    );

    expect(ok).toBeTruthy();
    expectRealResponse(message);
    // Should mention /requests/new or "new request"
    expect(
      message.toLowerCase().includes("request") ||
      message.toLowerCase().includes("/requests")
    ).toBeTruthy();
  });

  test("Multi-turn conversation maintains context", async ({ request }) => {
    // First question
    const first = await askTippy(request, "how many cats in Santa Rosa?");
    expect(first.ok).toBeTruthy();
    expectRealResponse(first.message);

    // Follow-up using conversationId
    if (first.conversationId) {
      const followUp = await askTippy(
        request,
        "and how about Petaluma?",
        first.conversationId
      );
      expect(followUp.ok).toBeTruthy();
      expect(followUp.message.length).toBeGreaterThan(20);
    }
  });
});

// ============================================================================
// FEEDBACK API TESTS
// ============================================================================

test.describe("Tippy: Feedback Submission", () => {
  test.setTimeout(30000);

  test("Valid feedback submission succeeds", async ({ request }) => {
    const response = await request.post("/api/tippy/feedback", {
      data: {
        tippy_message: "Test response from Tippy",
        user_correction: "This is a test feedback submission from e2e tests",
        feedback_type: "other",
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBeTruthy();
    expect(data.feedback_id).toBeTruthy();
  });

  test("Missing required fields returns 400", async ({ request }) => {
    const response = await request.post("/api/tippy/feedback", {
      data: {
        tippy_message: "Some message",
        // Missing user_correction and feedback_type
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Missing required fields");
  });

  test("Feedback with non-UUID entity_id succeeds gracefully", async ({ request }) => {
    const response = await request.post("/api/tippy/feedback", {
      data: {
        tippy_message: "Test response",
        user_correction: "Address correction needed",
        feedback_type: "incorrect_location",
        entity_type: "place",
        entity_id: "123 Main Street, Santa Rosa", // Not a UUID — should be handled
      },
    });

    // Should NOT return 500 — the non-UUID entity_id should be handled gracefully
    expect(response.status()).not.toBe(500);
    if (response.ok()) {
      const data = await response.json();
      expect(data.success).toBeTruthy();
    }
  });

  test("missing_data feedback type works", async ({ request }) => {
    const response = await request.post("/api/tippy/feedback", {
      data: {
        tippy_message: "I couldn't find that data",
        user_correction: "The data exists in the system",
        feedback_type: "missing_data",
      },
    });

    // Should NOT return 500 — category mapping should be correct
    expect(response.status()).not.toBe(500);
    if (response.ok()) {
      const data = await response.json();
      expect(data.success).toBeTruthy();
    }
  });

  test("missing_capability feedback type works", async ({ request }) => {
    const response = await request.post("/api/tippy/feedback", {
      data: {
        tippy_message: "I can't do that",
        user_correction: "Tippy should be able to do this",
        feedback_type: "missing_capability",
      },
    });

    // Should NOT return 500
    expect(response.status()).not.toBe(500);
    if (response.ok()) {
      const data = await response.json();
      expect(data.success).toBeTruthy();
    }
  });
});
