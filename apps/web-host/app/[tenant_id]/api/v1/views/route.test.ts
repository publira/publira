import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecordContentView } = vi.hoisted(() => ({
  mockRecordContentView: vi.fn(),
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

const beacon = (body: unknown, headers = SAME_ORIGIN_HEADERS) =>
  new Request("https://shop.example.test/api/v1/views", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
    method: "POST",
  });

const params = (tenantId = TENANT_ID) => ({
  params: Promise.resolve({ tenant_id: tenantId }),
});

describe("POST /api/v1/views", () => {
  beforeEach(() => {
    mockRecordContentView.mockReturnValue(Promise.resolve());
  });

  it("accepts a same-origin beacon and takes the tenant from the path", async () => {
    const response = await POST(
      beacon({ kind: "episode", publicId: "EP_001" }),
      params()
    );

    expect(response.status).toBe(204);
    expect(mockRecordContentView).toHaveBeenCalledWith({
      kind: "episode",
      publicId: "EP_001",
      tenantId: TENANT_ID,
    });
  });

  it("records nothing for a beacon from another origin", async () => {
    const response = await POST(
      beacon(
        { kind: "series", publicId: "SR_001" },
        { host: "shop.example.test", origin: "https://evil.example" }
      ),
      params()
    );

    expect(response.status).toBe(403);
    expect(mockRecordContentView).not.toHaveBeenCalled();
  });

  it("answers 400 and records nothing for an unparsable body", async () => {
    const response = await POST(beacon("not json"), params());

    expect(response.status).toBe(400);
    expect(mockRecordContentView).not.toHaveBeenCalled();
  });

  it("records nothing for a kind this app does not serve", async () => {
    const response = await POST(
      beacon({ kind: "author", publicId: "AU_001" }),
      params()
    );

    expect(response.status).toBe(400);
    expect(mockRecordContentView).not.toHaveBeenCalled();
  });

  it("records nothing for a tenant id the proxy would never rewrite", async () => {
    const response = await POST(
      beacon({ kind: "series", publicId: "SR_001" }),
      params("not-a-tenant")
    );

    expect(response.status).toBe(400);
    expect(mockRecordContentView).not.toHaveBeenCalled();
  });
});
