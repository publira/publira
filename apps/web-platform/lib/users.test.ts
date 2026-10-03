import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { platformTenantsCacheTag } from "./tenants";
import {
  getPlatformEndUser,
  listPlatformEndUsers,
  platformEndUsersCacheTag,
  searchPlatformTenantFilterOptions,
} from "./users";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetEndUser,
  mockGetPlatformLocale,
  mockGetTenant,
  mockListEndUsers,
  mockListTenants,
  mockVerifyPlatformSession,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetEndUser: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockGetTenant: vi.fn(),
  mockListEndUsers: vi.fn(),
  mockListTenants: vi.fn(),
  mockVerifyPlatformSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./auth-session", () => ({
  verifyPlatformSession: mockVerifyPlatformSession,
}));

vi.mock("./locale", () => ({
  getPlatformLocale: mockGetPlatformLocale,
}));

vi.mock("./api-client", () => ({
  SHARED_READ_CACHE_LIFE: "minutes",
  apiClient: {
    tenants: {
      getTenant: mockGetTenant,
      listTenants: mockListTenants,
    },
    users: {
      getEndUser: mockGetEndUser,
      listEndUsers: mockListEndUsers,
    },
  },
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
}));

const serviceHeaders = {
  headers: { Authorization: "Bearer service-token" },
};

/** What every test starts from: a confirmed operator reading in English. */
const resetMocks = () => {
  vi.resetAllMocks();
  mockGetPlatformLocale.mockResolvedValue("en");
  mockVerifyPlatformSession.mockResolvedValue({
    name: "Admin",
    publicId: "usr_1",
    role: "platform_super_admin",
  });
};

describe("listPlatformEndUsers", () => {
  beforeEach(resetMocks);

  it("returns the ListEndUsers response unchanged without scanning tenants", async () => {
    mockListEndUsers.mockResolvedValueOnce({
      users: [
        {
          createdAt: "2026-03-01T00:00:00Z",
          email: "enduser@example.com",
          id: "0199a3c0-0000-7000-8000-00000000000a",
          name: "End User",
          publicId: "ENDUSER001",
          status: "active",
          tenantIds: ["tenant_a"],
          tenantName: "Tenant A",
        },
      ],
    });

    await expect(listPlatformEndUsers({ limit: 20 })).resolves.toEqual({
      nextToken: "",
      ok: true,
      previousToken: "",
      users: [
        {
          createdAt: "2026-03-01T00:00:00Z",
          email: "enduser@example.com",
          id: "0199a3c0-0000-7000-8000-00000000000a",
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
        status: "",
        tenantPublicId: "",
        token: "",
        userIds: [],
      },
      serviceHeaders
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
        status: "",
        tenantPublicId: "tenant_a",
        token: "",
        userIds: [],
      },
      serviceHeaders
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
      listPlatformEndUsers({ limit: 10, token: "page-2" })
    ).resolves.toMatchObject({
      ok: true,
      users: [{ publicId: "USER000002" }],
    });

    expect(mockListEndUsers).toHaveBeenCalledWith(
      {
        createdAfter: "",
        createdBefore: "",
        limit: 10,
        status: "",
        tenantPublicId: "",
        token: "page-2",
        userIds: [],
      },
      serviceHeaders
    );
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(listPlatformEndUsers()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockListEndUsers).not.toHaveBeenCalled();
  });
});

describe("getPlatformEndUser", () => {
  beforeEach(resetMocks);

  it("reads the end user with the service credential", async () => {
    mockGetEndUser.mockResolvedValueOnce({
      user: {
        createdAt: "2026-03-02T00:00:00Z",
        email: "alice@example.com",
        name: "Alice",
        publicId: "USER000001",
        status: "active",
        tenantIds: ["tenant_a"],
        tenantName: "Tenant A",
      },
    });

    await expect(getPlatformEndUser(" USER000001 ")).resolves.toMatchObject({
      ok: true,
      user: { publicId: "USER000001" },
    });
    expect(mockGetEndUser).toHaveBeenCalledWith(
      { publicId: "USER000001" },
      serviceHeaders
    );
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(getPlatformEndUser("USER000001")).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockGetEndUser).not.toHaveBeenCalled();
  });

  it("returns a failure as a value instead of throwing inside the cache scope", async () => {
    mockGetEndUser.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getPlatformEndUser("USER000001")).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("searchPlatformTenantFilterOptions", () => {
  beforeEach(resetMocks);

  it("does not call RPC for an empty search query", async () => {
    await expect(searchPlatformTenantFilterOptions("   ")).resolves.toEqual({
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

    await expect(searchPlatformTenantFilterOptions("Tenant")).resolves.toEqual({
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
        status: "",
        token: "",
      },
      serviceHeaders
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
      searchPlatformTenantFilterOptions("abcdefghijkl")
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
      serviceHeaders
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
      searchPlatformTenantFilterOptions("abcdefghijkl")
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
      searchPlatformTenantFilterOptions("abcdefghijkl")
    ).resolves.toEqual({
      hasMore: false,
      ok: true,
      tenants: [{ name: "Nearby", publicId: "tenant_near" }],
    });
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(searchPlatformTenantFilterOptions("Tenant")).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockListTenants).not.toHaveBeenCalled();
    expect(mockGetTenant).not.toHaveBeenCalled();
  });

  it("does not return candidates when ListTenants is rejected", async () => {
    mockListTenants.mockRejectedValueOnce(
      new ConnectError("permission denied", Code.PermissionDenied)
    );

    await expect(searchPlatformTenantFilterOptions("Tenant")).resolves.toEqual({
      hasMore: false,
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
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
      searchPlatformTenantFilterOptions("abcdefghijkl")
    ).resolves.toEqual({
      hasMore: false,
      message: "Could not connect to the server. Please try again later.",
      ok: false,
      tenants: [],
    });
  });

  it("returns an unclassified GetTenant failure as a value instead of throwing inside the cache scope", async () => {
    mockListTenants.mockResolvedValueOnce({
      nextToken: "",
      tenants: [{ name: "Nearby", publicId: "tenant_near" }],
    });
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      searchPlatformTenantFilterOptions("abcdefghijkl")
    ).resolves.toMatchObject({ ok: false, tenants: [] });
  });
});

describe("end-user cache tags", () => {
  beforeEach(resetMocks);

  it("files the end-user list and an end user's detail under the end-users tag", async () => {
    mockListEndUsers.mockResolvedValueOnce({ users: [] });
    mockGetEndUser.mockResolvedValueOnce({ user: undefined });

    await listPlatformEndUsers();
    await getPlatformEndUser("USER00000001");

    expect(platformEndUsersCacheTag).toBe("platform:users");
    expect(mockCacheTag).toHaveBeenCalledTimes(2);
    expect(mockCacheTag).toHaveBeenNthCalledWith(1, platformEndUsersCacheTag);
    expect(mockCacheTag).toHaveBeenNthCalledWith(2, platformEndUsersCacheTag);
    // Refreshed after a minute: end users sign up and leave through the
    // storefront, which clears no tag here.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });

  it("files the tenant filter candidates under the tenants tag, since they are tenant names", async () => {
    mockListTenants.mockResolvedValueOnce({ nextToken: "", tenants: [] });

    await searchPlatformTenantFilterOptions("Maple");

    expect(mockCacheTag).toHaveBeenCalledWith(platformTenantsCacheTag);
  });
});
