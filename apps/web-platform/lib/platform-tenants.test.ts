import { describe, expect, it, vi } from "vitest";

import { createPlatformTenant, listPlatformTenants } from "./platform-tenants";

const { mockCreateTenant, mockListTenants } = vi.hoisted(() => ({
  mockCreateTenant: vi.fn(),
  mockListTenants: vi.fn(),
}));

vi.mock("@publira/api-client/platform/client", () => ({
  createPlatformApiClient: () => ({
    auth: {},
    operators: {},
    setup: {},
    tenants: {
      createTenant: mockCreateTenant,
      listTenants: mockListTenants,
    },
  }),
}));

describe("listPlatformTenants", () => {
  it("正常系: テナント一覧を返す", async () => {
    mockListTenants.mockResolvedValueOnce({
      tenants: [
        {
          createdAt: "2026-03-01 10:00",
          domain: "example.com",
          name: "テスト出版",
          publicId: "tenant_test",
          status: "active",
          subdomain: "test-pub",
        },
      ],
    });

    await expect(
      listPlatformTenants({ sessionId: "sess_abc" })
    ).resolves.toEqual({
      ok: true,
      tenants: [
        {
          createdAt: "2026-03-01 10:00",
          domain: "example.com",
          name: "テスト出版",
          publicId: "tenant_test",
          status: "active",
          subdomain: "test-pub",
        },
      ],
    });

    expect(mockListTenants).toHaveBeenCalledWith(
      { name: "", status: "" },
      { headers: { "X-Publira-Session-Id": "sess_abc" } }
    );
  });

  it("name / status フィルターを API に渡す", async () => {
    mockListTenants.mockResolvedValueOnce({ tenants: [] });

    await expect(
      listPlatformTenants({
        name: "テスト",
        sessionId: "sess_abc",
        status: "active",
      })
    ).resolves.toEqual({ ok: true, tenants: [] });

    expect(mockListTenants).toHaveBeenCalledWith(
      { name: "テスト", status: "active" },
      { headers: { "X-Publira-Session-Id": "sess_abc" } }
    );
  });

  it("sessionId が空の場合は API を呼ばずエラーを返す", async () => {
    await expect(listPlatformTenants({ sessionId: "  " })).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });

    expect(mockListTenants).not.toHaveBeenCalled();
  });

  it("API がエラーを返した場合はエラーメッセージを返す", async () => {
    mockListTenants.mockRejectedValueOnce(new Error("network error"));

    await expect(
      listPlatformTenants({ sessionId: "sess_abc" })
    ).resolves.toEqual({ message: "network error", ok: false });
  });
});

describe("createPlatformTenant", () => {
  it("正常系: payload と X-Publira-Session-Id ヘッダーを付与して API を呼ぶ", async () => {
    mockCreateTenant.mockResolvedValueOnce({
      tenant: { publicId: "TENANT000001" },
    });

    await expect(
      createPlatformTenant({
        domain: "example.com",
        initialAdminEmails: ["owner@example.com", ""],
        name: "新規テナント",
        sessionId: "sess_abc",
        subdomain: "tenant-1",
      })
    ).resolves.toEqual({ ok: true, publicId: "TENANT000001" });

    expect(mockCreateTenant).toHaveBeenCalledWith(
      {
        domain: "example.com",
        initialAdminEmails: ["owner@example.com"],
        name: "新規テナント",
        subdomain: "tenant-1",
      },
      {
        headers: {
          "X-Publira-Session-Id": "sess_abc",
        },
      }
    );
  });

  it("sessionId が空の場合は API を呼ばず失敗を返す", async () => {
    await expect(
      createPlatformTenant({
        name: "n",
        sessionId: "  ",
        subdomain: "s",
      })
    ).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });

    expect(mockCreateTenant).not.toHaveBeenCalled();
  });

  it("サブドメイン重複エラーを専用メッセージに変換する", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new Error("already_exists: subdomain already exists")
    );

    await expect(
      createPlatformTenant({
        name: "n",
        sessionId: "sess",
        subdomain: "s",
      })
    ).resolves.toEqual({
      message: "サブドメインが既に使用されています。",
      ok: false,
    });
  });

  it("入力エラーを入力内容エラーに変換する", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new Error("invalid_argument: invalid initial_admin_emails")
    );

    await expect(
      createPlatformTenant({
        name: "n",
        sessionId: "sess",
        subdomain: "s",
      })
    ).resolves.toEqual({
      message: "入力内容に誤りがあります。",
      ok: false,
    });
  });
});
