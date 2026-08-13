import { beforeEach, describe, expect, it, vi } from "vitest";

import { listPlatformEndUsers, listPlatformTenantFilterOptions } from "./users";

const { mockListEndUsers, mockListTenants, mockResolveSessionId } = vi.hoisted(
  () => ({
    mockListEndUsers: vi.fn(),
    mockListTenants: vi.fn(),
    mockResolveSessionId: vi.fn(),
  })
);

vi.mock("./api-client", () => ({
  apiClient: {
    tenants: {
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

  it("ListEndUsers の応答をそのまま返し、テナント走査はしない", async () => {
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
      listPlatformEndUsers({ limit: 20, offset: 0 })
    ).resolves.toEqual({
      ok: true,
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
        offset: 0,
        publicIds: [],
        status: "",
        tenantPublicId: "",
      },
      sessionHeaders
    );
    expect(mockListTenants).not.toHaveBeenCalled();
  });

  it("テナント絞り込みを ListEndUsers の tenantPublicId に渡す", async () => {
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
        offset: 0,
        tenantId: "tenant_a",
      })
    ).resolves.toEqual({
      ok: true,
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
        offset: 0,
        publicIds: [],
        status: "",
        tenantPublicId: "tenant_a",
      },
      sessionHeaders
    );
    expect(mockListTenants).not.toHaveBeenCalled();
  });

  it("ページ境界はサーバーへ渡した limit / offset のままにする", async () => {
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
      listPlatformEndUsers({ limit: 10, offset: 20 })
    ).resolves.toMatchObject({
      ok: true,
      users: [{ publicId: "USER000002" }],
    });

    expect(mockListEndUsers).toHaveBeenCalledWith(
      {
        createdAfter: "",
        createdBefore: "",
        limit: 10,
        offset: 20,
        publicIds: [],
        status: "",
        tenantPublicId: "",
      },
      sessionHeaders
    );
  });
});

describe("listPlatformTenantFilterOptions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveSessionId.mockResolvedValue("sess_abc");
  });

  it("cursor でテナントを辿って絞り込み選択肢を返す", async () => {
    mockListTenants
      .mockResolvedValueOnce({
        nextToken: "page-2",
        tenants: [{ name: "Tenant A", publicId: "tenant_a" }],
      })
      .mockResolvedValueOnce({
        nextToken: "",
        tenants: [{ name: "Tenant B", publicId: "tenant_b" }],
      });

    await expect(listPlatformTenantFilterOptions()).resolves.toEqual([
      { name: "Tenant A", publicId: "tenant_a" },
      { name: "Tenant B", publicId: "tenant_b" },
    ]);

    expect(mockListTenants).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        name: "",
        publicId: "",
        status: "",
        token: "",
      },
      sessionHeaders
    );
    expect(mockListTenants).toHaveBeenNthCalledWith(
      2,
      {
        limit: 100,
        name: "",
        publicId: "",
        status: "",
        token: "page-2",
      },
      sessionHeaders
    );
  });

  it("テナント走査が上限で途切れたときは空の選択肢を返す", async () => {
    let page = 0;
    mockListTenants.mockImplementation(() => {
      page += 1;
      return {
        nextToken: `page-${page}`,
        tenants: [{ name: "Tenant A", publicId: "tenant_a" }],
      };
    });

    await expect(listPlatformTenantFilterOptions()).resolves.toEqual([]);
    expect(mockListTenants).toHaveBeenCalledTimes(100);
  });
});
