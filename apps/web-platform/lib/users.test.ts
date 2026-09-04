import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listPlatformEndUsers,
  searchPlatformTenantFilterOptions,
} from "./users";

const {
  mockGetTenant,
  mockListEndUsers,
  mockListTenants,
  mockResolveSessionId,
} = vi.hoisted(() => ({
  mockGetTenant: vi.fn(),
  mockListEndUsers: vi.fn(),
  mockListTenants: vi.fn(),
  mockResolveSessionId: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    tenants: {
      getTenant: mockGetTenant,
      listTenants: mockListTenants,
    },
    users: {
      listEndUsers: mockListEndUsers,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveSessionId,
}));

const sessionHeaders = {
  headers: { Authorization: "Bearer sess_abc" },
};

describe("listPlatformEndUsers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveSessionId.mockResolvedValue("sess_abc");
  });

  it("returns the ListEndUsers response unchanged without scanning tenants", async () => {
    mockListEndUsers.mockResolvedValueOnce({
      users: [
        {
          createdAt: "2026-03-01T00:00:00Z",
          email: "enduser@example.com",
          name: "End User",
          publicId: "ENDUSER001",
          status: "active",
          tenantIds: ["tenant_a"],
          tenantName: "Tenant A",
        },
      ],
    });

    await expect(
      listPlatformEndUsers({ limit: 20, locale: "en" })
    ).resolves.toEqual({
      nextToken: "",
      ok: true,
      previousToken: "",
      users: [
        {
          createdAt: "2026-03-01T00:00:00Z",
          email: "enduser@example.com",
          name: "End User",
          primaryTenantName: "Tenant A",
          primaryTenantPublicId: "tenant_a",
          publicId: "ENDUSER001",
          status: "active",
          tenantIds: ["tenant_a"],
        },
      ],
    });

    expect(mockListEndUsers).toHaveBeenCalledWith(
      {
        createdAfter: "",
        createdBefore: "",
        limit: 20,
        publicIds: [],
        status: "",
        tenantPublicId: "",
        token: "",
      },
      sessionHeaders
    );
    expect(mockListTenants).not.toHaveBeenCalled();
  });

  it("passes the tenant filter as tenantPublicId to ListEndUsers", async () => {
    mockListEndUsers.mockResolvedValueOnce({
      users: [
        {
          createdAt: "2026-03-02T00:00:00Z",
          email: "alice@example.com",
          name: "Alice",
          publicId: "USER000001",
          status: "active",
          tenantIds: ["tenant_a"],
          tenantName: "Tenant A",
        },
      ],
    });

    await expect(
      listPlatformEndUsers({
        limit: 20,
        locale: "en",
        tenantId: "tenant_a",
      })
    ).resolves.toEqual({
      nextToken: "",
      ok: true,
      previousToken: "",
      users: [
        {
          createdAt: "2026-03-02T00:00:00Z",
          email: "alice@example.com",
          name: "Alice",
          primaryTenantName: "Tenant A",
          primaryTenantPublicId: "tenant_a",
          publicId: "USER000001",
          status: "active",
          tenantIds: ["tenant_a"],
        },
      ],
    });

    expect(mockListEndUsers).toHaveBeenCalledWith(
      {
        createdAfter: "",
        createdBefore: "",
        limit: 20,
        publicIds: [],
        status: "",
        tenantPublicId: "tenant_a",
        token: "",
      },
      sessionHeaders
    );
    expect(mockListTenants).not.toHaveBeenCalled();
  });

  it("keeps page boundaries from the limit and token sent to the server", async () => {
    mockListEndUsers.mockResolvedValueOnce({
      users: [
        {
          createdAt: "2026-03-03T00:00:00Z",
          email: "bob@example.com",
          name: "Bob",
          publicId: "USER000002",
          status: "active",
          tenantIds: ["tenant_b"],
          tenantName: "Tenant B",
        },
      ],
    });

    await expect(
      listPlatformEndUsers({ limit: 10, locale: "en", token: "page-2" })
    ).resolves.toMatchObject({
      ok: true,
      users: [{ publicId: "USER000002" }],
    });

    expect(mockListEndUsers).toHaveBeenCalledWith(
      {
        createdAfter: "",
        createdBefore: "",
        limit: 10,
        publicIds: [],
        status: "",
        tenantPublicId: "",
        token: "page-2",
      },
      sessionHeaders
    );
  });
});

describe("searchPlatformTenantFilterOptions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveSessionId.mockResolvedValue("sess_abc");
  });

  it("does not call RPC for an empty search query", async () => {
    await expect(
      searchPlatformTenantFilterOptions("   ", "en")
    ).resolves.toEqual({
      hasMore: false,
      ok: true,
      tenants: [],
    });

    expect(mockListTenants).not.toHaveBeenCalled();
    expect(mockGetTenant).not.toHaveBeenCalled();
  });

  it("calls ListTenants once and returns name-matched candidates", async () => {
    mockListTenants.mockResolvedValueOnce({
      nextToken: "page-2",
      tenants: [
        { name: "Tenant A", publicId: "tenant_a" },
        { name: "Tenant B", publicId: "tenant_b" },
      ],
    });

    await expect(
      searchPlatformTenantFilterOptions("Tenant", "en")
    ).resolves.toEqual({
      hasMore: true,
      ok: true,
      tenants: [
        { name: "Tenant A", publicId: "tenant_a" },
        { name: "Tenant B", publicId: "tenant_b" },
      ],
    });

    expect(mockListTenants).toHaveBeenCalledTimes(1);
    expect(mockListTenants).toHaveBeenCalledWith(
      {
        limit: 20,
        name: "Tenant",
        publicId: "",
        status: "",
        token: "",
      },
      sessionHeaders
    );
    expect(mockGetTenant).not.toHaveBeenCalled();
  });

  it("also tries GetTenant for a 12-character query and puts exact matches first", async () => {
    mockListTenants.mockResolvedValueOnce({
      nextToken: "",
      tenants: [
        { name: "Nearby", publicId: "abcdefghijkL" },
        { name: "Exact", publicId: "abcdefghijkl" },
      ],
    });
    mockGetTenant.mockResolvedValueOnce({
      tenant: { name: "Exact", publicId: "abcdefghijkl" },
    });

    await expect(
      searchPlatformTenantFilterOptions("abcdefghijkl", "en")
    ).resolves.toEqual({
      hasMore: false,
      ok: true,
      tenants: [
        { name: "Exact", publicId: "abcdefghijkl" },
        { name: "Nearby", publicId: "abcdefghijkL" },
      ],
    });

    expect(mockListTenants).toHaveBeenCalledTimes(1);
    expect(mockGetTenant).toHaveBeenCalledWith(
      { publicId: "abcdefghijkl" },
      sessionHeaders
    );
  });

  it("returns name-search candidates when GetTenant is permission denied", async () => {
    mockListTenants.mockResolvedValueOnce({
      nextToken: "",
      tenants: [{ name: "Nearby", publicId: "tenant_near" }],
    });
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("permission denied", Code.PermissionDenied)
    );

    await expect(
      searchPlatformTenantFilterOptions("abcdefghijkl", "en")
    ).resolves.toEqual({
      hasMore: false,
      ok: true,
      tenants: [{ name: "Nearby", publicId: "tenant_near" }],
    });
  });

  it("returns name-search candidates when GetTenant is not found", async () => {
    mockListTenants.mockResolvedValueOnce({
      nextToken: "",
      tenants: [{ name: "Nearby", publicId: "tenant_near" }],
    });
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("tenant not found", Code.NotFound)
    );

    await expect(
      searchPlatformTenantFilterOptions("abcdefghijkl", "en")
    ).resolves.toEqual({
      hasMore: false,
      ok: true,
      tenants: [{ name: "Nearby", publicId: "tenant_near" }],
    });
  });

  it("returns an error without calling RPC when there is no session", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(
      searchPlatformTenantFilterOptions("Tenant", "en")
    ).resolves.toEqual({
      hasMore: false,
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
      tenants: [],
    });

    expect(mockListTenants).not.toHaveBeenCalled();
    expect(mockGetTenant).not.toHaveBeenCalled();
  });

  it("words the session error in the requested locale, so locale=ja is Japanese", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(
      searchPlatformTenantFilterOptions("Tenant", "ja")
    ).resolves.toEqual({
      hasMore: false,
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
      tenants: [],
    });
  });

  it("does not return candidates when ListTenants is rejected", async () => {
    mockListTenants.mockRejectedValueOnce(
      new ConnectError("permission denied", Code.PermissionDenied)
    );

    await expect(
      searchPlatformTenantFilterOptions("Tenant", "en")
    ).resolves.toEqual({
      hasMore: false,
      message: "You do not have permission to perform this action.",
      ok: false,
      requiresSignIn: false,
      tenants: [],
    });
  });

  it("treats a GetTenant connection failure as a candidate-loading failure", async () => {
    mockListTenants.mockResolvedValueOnce({
      nextToken: "",
      tenants: [{ name: "Nearby", publicId: "tenant_near" }],
    });
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable)
    );

    await expect(
      searchPlatformTenantFilterOptions("abcdefghijkl", "en")
    ).resolves.toEqual({
      hasMore: false,
      message: "Could not connect to the server. Please try again later.",
      ok: false,
      requiresSignIn: false,
      tenants: [],
    });
  });

  it("rethrows unclassified GetTenant errors", async () => {
    mockListTenants.mockResolvedValueOnce({
      nextToken: "",
      tenants: [{ name: "Nearby", publicId: "tenant_near" }],
    });
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      searchPlatformTenantFilterOptions("abcdefghijkl", "en")
    ).rejects.toMatchObject({ code: Code.Internal });
  });
});
