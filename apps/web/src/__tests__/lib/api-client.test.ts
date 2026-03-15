import { describe, it, expect, vi, beforeEach } from "vitest";
import { unwrapApiResponse, ApiError } from "@/lib/api-client";

// =============================================================================
// ApiError (client-side)
// =============================================================================

describe("ApiError (client)", () => {
  it("stores message, code, and details", () => {
    const err = new ApiError("Not found", 404, { id: "123" });
    expect(err.message).toBe("Not found");
    expect(err.code).toBe(404);
    expect(err.details).toEqual({ id: "123" });
    expect(err.name).toBe("ApiError");
  });

  it("is an instance of Error", () => {
    expect(new ApiError("test", 500)).toBeInstanceOf(Error);
  });

  it("defaults details to undefined", () => {
    expect(new ApiError("test", 400).details).toBeUndefined();
  });
});

// =============================================================================
// unwrapApiResponse
// =============================================================================

describe("unwrapApiResponse", () => {
  it("unwraps apiSuccess format: { success: true, data: T }", () => {
    const wrapped = { success: true, data: { cats: [{ id: 1 }] } };
    const result = unwrapApiResponse<{ cats: { id: number }[] }>(wrapped);
    expect(result).toEqual({ cats: [{ id: 1 }] });
  });

  it("passes through legacy format (no wrapper)", () => {
    const legacy = { cats: [{ id: 1 }] };
    const result = unwrapApiResponse<{ cats: { id: number }[] }>(legacy);
    expect(result).toEqual({ cats: [{ id: 1 }] });
  });

  it("passes through when success is false", () => {
    const errorResponse = { success: false, error: { message: "fail" } };
    const result = unwrapApiResponse(errorResponse);
    expect(result).toEqual(errorResponse);
  });

  it("passes through when success is true but no data key", () => {
    const noData = { success: true, count: 5 };
    const result = unwrapApiResponse(noData);
    expect(result).toEqual(noData);
  });

  it("handles null input", () => {
    expect(unwrapApiResponse(null)).toBeNull();
  });

  it("handles primitive input", () => {
    expect(unwrapApiResponse("hello")).toBe("hello");
  });

  it("handles array input", () => {
    const arr = [1, 2, 3];
    expect(unwrapApiResponse(arr)).toEqual(arr);
  });

  it("unwraps nested data correctly", () => {
    const wrapped = {
      success: true,
      data: {
        people: [{ person_id: "abc", display_name: "Alice" }],
      },
      meta: { total: 100, limit: 50, offset: 0 },
    };
    const result = unwrapApiResponse<{ people: { person_id: string; display_name: string }[] }>(wrapped);
    expect(result.people).toHaveLength(1);
    expect(result.people[0].person_id).toBe("abc");
  });

  it("unwraps empty data object", () => {
    const wrapped = { success: true, data: {} };
    expect(unwrapApiResponse(wrapped)).toEqual({});
  });

  it("unwraps data that is an array", () => {
    const wrapped = { success: true, data: [1, 2, 3] };
    expect(unwrapApiResponse(wrapped)).toEqual([1, 2, 3]);
  });
});

// =============================================================================
// fetchApi (requires fetch mock)
// =============================================================================

describe("fetchApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("unwraps apiSuccess response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { cats: [] } }),
    }));

    const { fetchApi } = await import("@/lib/api-client");
    const result = await fetchApi<{ cats: unknown[] }>("/api/cats");
    expect(result).toEqual({ cats: [] });
  });

  it("passes through legacy response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ cats: [{ id: 1 }] }),
    }));

    const { fetchApi } = await import("@/lib/api-client");
    const result = await fetchApi<{ cats: { id: number }[] }>("/api/cats");
    expect(result).toEqual({ cats: [{ id: 1 }] });
  });

  it("throws ApiError on non-ok response with error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: { message: "Not found", code: 404 } }),
    }));

    const { fetchApi, ApiError: AE } = await import("@/lib/api-client");
    await expect(fetchApi("/api/cats/bad")).rejects.toThrow(AE);
    await expect(fetchApi("/api/cats/bad")).rejects.toThrow("Not found");
  });

  it("throws ApiError on non-ok response without structured error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("Not JSON")),
    }));

    const { fetchApi } = await import("@/lib/api-client");
    await expect(fetchApi("/api/cats")).rejects.toThrow("Request failed with status 500");
  });
});

// =============================================================================
// fetchApiWithMeta
// =============================================================================

describe("fetchApiWithMeta", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns data and meta from apiSuccess response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: { cats: [{ id: 1 }] },
        meta: { total: 100, limit: 50, offset: 0 },
      }),
    }));

    const { fetchApiWithMeta } = await import("@/lib/api-client");
    const result = await fetchApiWithMeta<{ cats: { id: number }[] }>("/api/cats");
    expect(result.data).toEqual({ cats: [{ id: 1 }] });
    expect(result.meta).toEqual({ total: 100, limit: 50, offset: 0 });
  });

  it("returns data without meta for legacy response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ cats: [] }),
    }));

    const { fetchApiWithMeta } = await import("@/lib/api-client");
    const result = await fetchApiWithMeta<{ cats: unknown[] }>("/api/cats");
    expect(result.data).toEqual({ cats: [] });
    expect(result.meta).toBeUndefined();
  });
});

// =============================================================================
// postApi
// =============================================================================

describe("postApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends JSON body with POST method by default", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: "new-123" } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { postApi } = await import("@/lib/api-client");
    const result = await postApi<{ id: string }>("/api/cats", { name: "Whiskers" });

    expect(result).toEqual({ id: "new-123" });
    expect(mockFetch).toHaveBeenCalledWith("/api/cats", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "Whiskers" }),
    }));
  });

  it("uses custom method when specified", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { postApi } = await import("@/lib/api-client");
    await postApi("/api/cats/123", { name: "Updated" }, { method: "PATCH" });

    expect(mockFetch).toHaveBeenCalledWith("/api/cats/123", expect.objectContaining({
      method: "PATCH",
    }));
  });
});
