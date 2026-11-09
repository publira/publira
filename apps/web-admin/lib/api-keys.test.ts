import { ApiKeyScope } from "@publira/api-client/admin/api-key";
import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockCreateApi,
  mockGetAccessToken,
  mockListApi,
  mockRevokeApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCreateApi: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListApi: vi.fn(),
  mockRevokeApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    apiKeys: {
      createApiKey: mockCreateApi,
      listApiKeys: mockListApi,
      revokeApiKey: mockRevokeApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const SESSION_HEADERS = { headers: { Authorization: "Bearer session-token" } };

const storedKey = {
  createdAt: "2026-11-01T00:00:00Z",
  id: "018f2000-0003-7000-8000-000000000001",
  lastUsedAt: "",
  name: "CRM",
  prefix: "pbk_abcdefghijkl",
  revokedAt: "",
  scopes: [
    ApiKeyScope.CATALOG_READ,
    ApiKeyScope.PURCHASES_READ,
    ApiKeyScope.CATALOG_WRITE,
  ],
};

const invalidField = (field: string) =>
  new ConnectError("invalid", Code.InvalidArgument, undefined, [
    { desc: BadRequestSchema, value: { fieldViolations: [{ field }] } },
  ]);

describe("api-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("lists the keys under the tenant's tag, refetched by the minute", async () => {
    mockListApi.mockResolvedValueOnce({ apiKeys: [storedKey] });
    const { listApiKeys } = await import("./api-keys");

    const result = await listApiKeys("TENANT001", "en");

    expect(result).toEqual({
      apiKeys: [
        {
          createdAt: "2026-11-01T00:00:00Z",
          id: storedKey.id,
          lastUsedAt: "",
          name: "CRM",
          prefix: "pbk_abcdefghijkl",
          revokedAt: "",
          scopes: ["catalog", "purchases", "catalog_write"],
        },
      ],
      ok: true,
    });
    expect(mockListApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      SESSION_HEADERS
    );
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:api-keys");
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });

  it("leaves off a scope this console has no word for", async () => {
    mockListApi.mockResolvedValueOnce({
      apiKeys: [{ ...storedKey, scopes: [ApiKeyScope.CATALOG_READ, 99] }],
    });
    const { listApiKeys } = await import("./api-keys");

    const result = await listApiKeys("TENANT001", "en");

    expect(result.apiKeys[0]?.scopes).toEqual(["catalog"]);
  });

  it("reports a failed read without throwing", async () => {
    mockListApi.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );
    const { listApiKeys } = await import("./api-keys");

    const result = await listApiKeys("TENANT001", "en");

    expect(result).toMatchObject({ apiKeys: [], ok: false });
  });

  it("sends the scopes the form chose and answers the key once", async () => {
    mockCreateApi.mockResolvedValueOnce({
      apiKey: storedKey,
      key: "pbk_abcdefghijkl_secret",
    });
    const { createApiKey } = await import("./api-keys");

    const result = await createApiKey(
      {
        name: "CRM",
        scopes: ["purchases", "catalog_write"],
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toMatchObject({
      key: "pbk_abcdefghijkl_secret",
      ok: true,
    });
    expect(mockCreateApi).toHaveBeenCalledWith(
      {
        name: "CRM",
        scopes: [ApiKeyScope.PURCHASES_READ, ApiKeyScope.CATALOG_WRITE],
        tenant: { tenantId: "TENANT001" },
      },
      SESSION_HEADERS
    );
  });

  it.each([
    ["name", "The name must be 1 to 100 characters."],
    ["scopes", "Choose at least one scope."],
  ])(
    "words a refused %s by the field the API names",
    async (field, message) => {
      mockCreateApi.mockRejectedValueOnce(invalidField(field));
      const { createApiKey } = await import("./api-keys");

      const result = await createApiKey(
        { name: "CRM", scopes: ["catalog"], tenantId: "TENANT001" },
        "en"
      );

      expect(result).toEqual({ message, ok: false });
    }
  );

  it("revokes the key it is given", async () => {
    mockRevokeApi.mockResolvedValueOnce({
      apiKey: { ...storedKey, revokedAt: "2026-11-02T00:00:00Z" },
    });
    const { revokeApiKey } = await import("./api-keys");

    const result = await revokeApiKey("TENANT001", storedKey.id, "en");

    expect(result).toMatchObject({
      apiKey: { revokedAt: "2026-11-02T00:00:00Z" },
      ok: true,
    });
    expect(mockRevokeApi).toHaveBeenCalledWith(
      { apiKeyId: storedKey.id, tenant: { tenantId: "TENANT001" } },
      SESSION_HEADERS
    );
  });

  it("says a key that is not there any more is gone", async () => {
    mockRevokeApi.mockRejectedValueOnce(
      new ConnectError("not found", Code.NotFound)
    );
    const { revokeApiKey } = await import("./api-keys");

    const result = await revokeApiKey("TENANT001", storedKey.id, "en");

    expect(result).toEqual({
      message:
        "This API key no longer exists. Reload the page to see the current list.",
      ok: false,
    });
  });
});
