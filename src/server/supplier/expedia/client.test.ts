import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import {
  SupplierAuthError,
  SupplierOutcomeUnknown,
  SupplierRateLimited,
  SupplierRequestRejected,
  SupplierTimeout,
  SupplierUnavailable,
  expediaRequest,
} from "./client";

const SECRET = "shared-secret-never-logged";
const context = { customerIp: "203.0.113.7", userAgent: "Mozilla/5.0 Test", sessionId: "sess-1" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("expediaRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(async () => {
    await resetTestDb();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("EXPEDIA_API_KEY", "api-key-1");
    vi.stubEnv("EXPEDIA_SHARED_SECRET", SECRET);
    vi.stubEnv("EXPEDIA_BASE_URL", "");
    vi.stubEnv("APP_ENV", "staging");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("sends the signed request with the required headers and a timeout", async () => {
    fetchMock.mockResolvedValue(json(200, [{ property_id: "1" }]));
    const result = await expediaRequest({
      method: "GET",
      path: "/properties/availability",
      query: { checkin: "2027-01-10", property_id: ["1", "2"], occupancy: "2-9,4" },
      context,
      timeoutMs: 15_000,
    });
    expect(result).toMatchObject({ status: 200, data: [{ property_id: "1" }] });
    expect(result.logId).toEqual(expect.any(String));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://test.ean.com/v3/properties/availability?checkin=2027-01-10&property_id=1&property_id=2&occupancy=2-9%2C4",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toMatch(/^EAN APIKey=api-key-1,Signature=[0-9a-f]{128},timestamp=\d{10}$/);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("accept-encoding")).toBe("gzip");
    expect(headers.get("user-agent")).toBe("Mozilla/5.0 Test");
    expect(headers.get("customer-ip")).toBe("203.0.113.7");
    expect(headers.get("customer-session-id")).toBe("sess-1");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("logs every call to SupplierCallLog with PII masked and never the secret", async () => {
    fetchMock.mockResolvedValue(
      json(201, { itinerary_id: "8999", email: "guest@example.com", phone: { country_code: "972", area_code: "50", number: "1234567" } }),
    );
    await expediaRequest({
      method: "POST",
      path: "/itineraries",
      body: {
        affiliate_reference_id: "APL-ABC123",
        email: "guest@example.com",
        rooms: [{ given_name: "Dana", family_name: "Levi" }],
        payments: [{ billing_contact: { given_name: "Taya", address: { line_1: "1 Main St", postal_code: "12345", country_code: "IL" } } }],
      },
      context: { ...context, test: "standard" },
      timeoutMs: 60_000,
      affiliateReferenceId: "APL-ABC123",
    });
    const rows = await db.supplierCallLog.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ supplier: "expedia", method: "POST", path: "/itineraries", status: 201, affiliateReferenceId: "APL-ABC123" });
    const stored = JSON.stringify([row.requestBody, row.responseBody, row.error]);
    for (const pii of ["guest@example.com", "Dana", "Levi", "1 Main St", "12345", "1234567"]) expect(stored).not.toContain(pii);
    expect(stored).toContain("APL-ABC123");
    expect(stored).toContain('"country_code":"IL"');
    expect(stored).not.toContain(SECRET);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("outside production, a call that is not a GET must carry the Test header (a booking without it is real)", async () => {
    await expect(
      expediaRequest({ method: "POST", path: "/itineraries", body: {}, context, timeoutMs: 60_000 }),
    ).rejects.toThrow(/Test header/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the Test header when given", async () => {
    fetchMock.mockResolvedValue(json(200, []));
    await expediaRequest({ method: "GET", path: "/properties/availability", context: { ...context, test: "standard" }, timeoutMs: 15_000 });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("test")).toBe("standard");
  });

  it.each([
    [401, SupplierAuthError],
    [403, SupplierAuthError],
    [429, SupplierRateLimited],
    [400, SupplierRequestRejected],
  ])("maps HTTP %i to a typed error without retrying", async (status, ErrorType) => {
    fetchMock.mockResolvedValue(json(status, { type: "some.error", message: "nope" }));
    await expect(
      expediaRequest({ method: "GET", path: "/properties/availability", context, timeoutMs: 15_000 }),
    ).rejects.toBeInstanceOf(ErrorType);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries an idempotent GET once on 503, then succeeds", async () => {
    fetchMock.mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, []));
    const result = await expediaRequest({ method: "GET", path: "/properties/availability", context, timeoutMs: 15_000 });
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await db.supplierCallLog.count()).toBe(2);
  });

  it("gives up after the second 5xx", async () => {
    fetchMock.mockImplementation(async () => json(500, {}));
    await expect(
      expediaRequest({ method: "GET", path: "/properties/availability", context, timeoutMs: 15_000 }),
    ).rejects.toBeInstanceOf(SupplierUnavailable);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a call that is not a GET, and a 5xx on it means the outcome is unknown", async () => {
    fetchMock.mockImplementation(async () => json(503, {}));
    await expect(
      expediaRequest({ method: "DELETE", path: "/itineraries/1/rooms/2", context: { ...context, test: "standard" }, timeoutMs: 60_000 }),
    ).rejects.toBeInstanceOf(SupplierOutcomeUnknown);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a GET timeout is SupplierTimeout and is logged with no status", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    await expect(
      expediaRequest({ method: "GET", path: "/properties/availability", context, timeoutMs: 15_000 }),
    ).rejects.toBeInstanceOf(SupplierTimeout);
    const row = await db.supplierCallLog.findFirstOrThrow();
    expect(row.status).toBeNull();
    expect(row.error).toBe("timeout");
  });

  it.each([
    ["timeout", Object.assign(new Error("aborted"), { name: "TimeoutError" })],
    ["network", new TypeError("fetch failed")],
  ])("a POST %s means the booking may exist: SupplierOutcomeUnknown, never retried", async (_label, failure) => {
    fetchMock.mockRejectedValue(failure);
    await expect(
      expediaRequest({ method: "POST", path: "/itineraries", body: {}, context: { ...context, test: "standard" }, timeoutMs: 60_000 }),
    ).rejects.toBeInstanceOf(SupplierOutcomeUnknown);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a body that fails to arrive after the headers is handled (logged, typed), not a raw error", async () => {
    const stalled = new Response(
      new ReadableStream({ start(controller) { controller.error(Object.assign(new Error("aborted"), { name: "TimeoutError" })); } }),
      { status: 201 },
    );
    fetchMock.mockResolvedValue(stalled);
    await expect(
      expediaRequest({ method: "POST", path: "/itineraries", body: {}, context: { ...context, test: "standard" }, timeoutMs: 60_000 }),
    ).rejects.toBeInstanceOf(SupplierOutcomeUnknown);
    expect(await db.supplierCallLog.count()).toBe(1);
  });

  it("calls to the test endpoint always need the Test header for non-GET, even with APP_ENV=production", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("EXPEDIA_BASE_URL", "https://test.ean.com/v3");
    await expect(
      expediaRequest({ method: "POST", path: "/itineraries", body: {}, context, timeoutMs: 60_000 }),
    ).rejects.toThrow(/Test header/);
  });

  it("a strange Link header on a successful booking never fails the booking call", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ itinerary_id: "1" }), { status: 201, headers: { Link: "<not a url" } }));
    const result = await expediaRequest({ method: "POST", path: "/itineraries", body: {}, context: { ...context, test: "standard" }, timeoutMs: 60_000 });
    expect(result).toMatchObject({ status: 201, next: null });
  });

  it("masks email and token in the logged path", async () => {
    fetchMock.mockResolvedValue(json(200, []));
    await expediaRequest({ method: "GET", path: "/itineraries", query: { email: "guest@example.com", affiliate_reference_id: "APL-1" }, context, timeoutMs: 15_000 });
    const row = await db.supplierCallLog.findFirstOrThrow();
    expect(row.path).not.toContain("guest");
    expect(row.path).toContain("APL-1");
  });

  it("error messages never contain the secret or the response body", async () => {
    fetchMock.mockResolvedValue(json(400, { message: "guest@example.com is invalid" }));
    try {
      await expediaRequest({ method: "GET", path: "/properties/availability", context, timeoutMs: 15_000 });
    } catch (error) {
      expect(String(error)).not.toContain(SECRET);
      expect(String(error)).not.toContain("guest@example.com");
    }
  });
});
