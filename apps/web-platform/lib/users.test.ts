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

describe("searchPlatformTenantFilterOptions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveSessionId.mockResolvedValue("sess_abc");
  });

  it("空の検索語では RPC を呼ばない", async () => {
    await expect(searchPlatformTenantFilterOptions("   ")).resolves.toEqual({
      hasMore: false,
      ok: true,
      tenants: [],
    });

    expect(mockListTenants).not.toHaveBeenCalled();
    expect(mockGetTenant).not.toHaveBeenCalled();
  });

  it("ListTenants を 1 回だけ呼び、name で候補を返す", async () => {
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
        publicId: "",
        status: "",
        token: "",
      },
      sessionHeaders
    );
    expect(mockGetTenant).not.toHaveBeenCalled();
  });

  it("12 文字の検索語は GetTenant も試し、完全一致を先頭に置く", async () => {
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
      sessionHeaders
    );
  });

  it("GetTenant が権限不足でも存在しないものとして name 検索の候補は返す", async () => {
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

  it("GetTenant が not found でも name 検索の候補は返す", async () => {
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

  it("セッションがなければ RPC を呼ばずエラーを返す", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(searchPlatformTenantFilterOptions("Tenant")).resolves.toEqual({
      hasMore: false,
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      tenants: [],
    });

    expect(mockListTenants).not.toHaveBeenCalled();
    expect(mockGetTenant).not.toHaveBeenCalled();
  });

  it("ListTenants が拒否されたら候補を返さない", async () => {
    mockListTenants.mockRejectedValueOnce(
      new ConnectError("permission denied", Code.PermissionDenied)
    );

    await expect(searchPlatformTenantFilterOptions("Tenant")).resolves.toEqual({
      hasMore: false,
      message: "この操作を行う権限がありません。",
      ok: false,
      tenants: [],
    });
  });

  it("GetTenant の接続失敗は候補取得失敗にする", async () => {
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
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
      tenants: [],
    });
  });

  it("GetTenant の未分類エラーは再送出する", async () => {
    mockListTenants.mockResolvedValueOnce({
      nextToken: "",
      tenants: [{ name: "Nearby", publicId: "tenant_near" }],
    });
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      searchPlatformTenantFilterOptions("abcdefghijkl")
    ).rejects.toMatchObject({ code: Code.Internal });
  });
});
