import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimitDecision } from "#lib/request-rate-limit";

const { mockChargeViewBeacon, mockRecordContentView } = vi.hoisted(() => ({
  mockChargeViewBeacon: vi.fn<(client: string) => Promise<RateLimitDecision>>(),
  mockRecordContentView: vi.fn(),
}));

vi.mock("#lib/view-beacon-rate-limit", () => ({
  createViewBeaconLimiter: () => mockChargeViewBeacon,
}));

vi.mock("#lib/view-events", () => ({
  contentViewKinds: ["episode", "series"] as const,
  recordContentView: mockRecordContentView,
}));

const { POST } = await import("./route");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const SAME_ORIGIN_HEADERS = {
  host: "shop.example.test",
  origin: "https://shop.example.test",
};

const rawBeacon = (
  body: string,
  headers: Record<string, string> = SAME_ORIGIN_HEADERS
) =>
  new Request("https://shop.example.test/api/v1/views", {
    body,
    headers,
    method: "POST",
  });

const beacon = (
  view: { id: string; kind: string },
  headers: Record<string, string> = SAME_ORIGIN_HEADERS
) => rawBeacon(JSON.stringify(view), headers);

const params = (tenantId = TENANT_ID) => ({
  params: Promise.resolve({ tenant_id: tenantId }),
});

describe("POST /api/v1/views", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockChargeViewBeacon.mockResolvedValue({ allowed: true });
    mockRecordContentView.mockReturnValue(Promise.resolve());
  });

  it("charges the beacon to the reader's address the forwarded headers name", async () => {
    await POST(
      beacon(
        { id: "e0000000-0000-4000-8000-000000000001", kind: "episode" },
        { ...SAME_ORIGIN_HEADERS, "x-forwarded-for": "198.51.100.7, 10.0.0.2" }
      ),
      params()
    );

    expect(mockChargeViewBeacon).toHaveBeenCalledWith("198.51.100.7");
  });

  it("answers 429 with the wait and records nothing for a client past its allowance", async () => {
    mockChargeViewBeacon.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 4,
    });

    const response = await POST(
      beacon({ id: "e0000000-0000-4000-8000-000000000001", kind: "episode" }),
      params()
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("4");
    expect(mockRecordContentView).not.toHaveBeenCalled();
  });

  it("answers 500 and records nothing when the trusted proxies cannot be read", async () => {
    vi.stubEnv("PUBLIRA_TRUSTED_PROXIES", "not-an-address");
    vi.spyOn(console, "error").mockImplementation(() => null);

    const response = await POST(
      beacon({ id: "e0000000-0000-4000-8000-000000000001", kind: "episode" }),
      params()
    );

    expect(response.status).toBe(500);
    expect(mockChargeViewBeacon).not.toHaveBeenCalled();
    expect(mockRecordContentView).not.toHaveBeenCalled();
  });

  it("accepts a same-origin beacon and takes the tenant from the path", async () => {
    const response = await POST(
      beacon({ id: "e0000000-0000-4000-8000-000000000001", kind: "episode" }),
      params()
    );

    expect(response.status).toBe(204);
    expect(mockRecordContentView).toHaveBeenCalledWith({
      id: "e0000000-0000-4000-8000-000000000001",
      kind: "episode",
      tenantId: TENANT_ID,
    });
  });

  it("records nothing for a beacon from another origin", async () => {
    const response = await POST(
      beacon(
        { id: "5e000000-0000-4000-8000-000000000001", kind: "series" },
        { host: "shop.example.test", origin: "https://evil.example" }
      ),
      params()
    );

    expect(response.status).toBe(403);
    expect(mockRecordContentView).not.toHaveBeenCalled();
  });

  it("answers 400 and records nothing for an unparsable body", async () => {
    const response = await POST(rawBeacon("not json"), params());

    expect(response.status).toBe(400);
    expect(mockRecordContentView).not.toHaveBeenCalled();
  });

  it("records nothing for a kind this app does not serve", async () => {
    const response = await POST(
      beacon({ id: "a0000000-0000-4000-8000-000000000001", kind: "creator" }),
      params()
    );

    expect(response.status).toBe(400);
    expect(mockRecordContentView).not.toHaveBeenCalled();
  });

  it("records nothing for a public ID in place of the ID", async () => {
    const response = await POST(
      beacon({ id: "SR_001", kind: "series" }),
      params()
    );

    expect(response.status).toBe(400);
    expect(mockRecordContentView).not.toHaveBeenCalled();
  });

  it("records nothing for a tenant id the proxy would never rewrite", async () => {
    const response = await POST(
      beacon({ id: "5e000000-0000-4000-8000-000000000001", kind: "series" }),
      params("not-a-tenant")
    );

    expect(response.status).toBe(400);
    expect(mockRecordContentView).not.toHaveBeenCalled();
  });
});
