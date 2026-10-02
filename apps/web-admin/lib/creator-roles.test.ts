import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAdminPageSession, mockVerifyAdminSession } = vi.hoisted(
  () => ({
    mockVerifyAdminPageSession: vi.fn(() =>
      Promise.resolve({ locale: "en" as const, tenantId: "TENANT001" })
    ),
    mockVerifyAdminSession: vi.fn(),
  })
);

vi.mock("./admin-page-session", () => ({
  verifyAdminPageSession: mockVerifyAdminPageSession,
}));

vi.mock("./auth-session", () => ({
  verifyAdminSession: mockVerifyAdminSession,
}));

const {
  mockCacheLife,
  mockCacheTag,
  mockCreateCreatorRole,
  mockDeleteCreatorRole,
  mockGetAccessToken,
  mockListCreatorRoles,
  mockReorderCreatorRoles,
  mockUpdateCreatorRole,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCreateCreatorRole: vi.fn(),
  mockDeleteCreatorRole: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListCreatorRoles: vi.fn(),
  mockReorderCreatorRoles: vi.fn(),
  mockUpdateCreatorRole: vi.fn(),
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
    creatorRole: {
      createCreatorRole: mockCreateCreatorRole,
      deleteCreatorRole: mockDeleteCreatorRole,
      listCreatorRoles: mockListCreatorRoles,
      reorderCreatorRoles: mockReorderCreatorRoles,
      updateCreatorRole: mockUpdateCreatorRole,
    },
  },
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const creatorRoleInUseError = (creditCount: string) =>
  new ConnectError(
    "creator role is used by 3 credits and cannot be deleted",
    Code.FailedPrecondition,
    undefined,
    [
      {
        desc: ErrorInfoSchema,
        value: {
          domain: "publira",
          metadata: { credit_count: creditCount },
          reason: "CREATOR_ROLE_IN_USE",
        },
      },
    ]
  );

const deleteInUseByLocale: Record<Locale, { one: string; three: string }> = {
  en: {
    one: "This role is still in use (credit count: 1). Re-credit those credits before deleting it.",
    three:
      "This role is still in use (credit count: 3). Re-credit those credits before deleting it.",
  },
  ja: {
    one: "この役割は1件のクレジットに使われています。クレジットを付け替えてから削除してください。",
    three:
      "この役割は3件のクレジットに使われています。クレジットを付け替えてから削除してください。",
  },
  ko: {
    one: "이 역할은 1개의 크레딧에서 사용 중입니다. 크레딧을 다시 지정한 뒤 삭제하세요.",
    three:
      "이 역할은 3개의 크레딧에서 사용 중입니다. 크레딧을 다시 지정한 뒤 삭제하세요.",
  },
  "zh-Hans": {
    one: "该角色仍被1条署名使用。请先重新指定署名，然后再删除。",
    three: "该角色仍被3条署名使用。请先重新指定署名，然后再删除。",
  },
  "zh-Hant": {
    one: "該角色仍被1條署名使用。請先重新指定署名，然後再刪除。",
    three: "該角色仍被3條署名使用。請先重新指定署名，然後再刪除。",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listCreatorRoles", () => {
  it("returns every role of the tenant across pages", async () => {
    mockListCreatorRoles
      .mockResolvedValueOnce({
        creatorRoles: [{ id: "ROLE0001", name: "Story", publicId: "R1" }],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        creatorRoles: [{ id: "ROLE0002", name: "Art", publicId: "R2" }],
        nextToken: "",
      });

    const { listCreatorRoles } = await import("./creator-roles");
    const result = await listCreatorRoles();

    expect(result).toEqual({
      creatorRoles: [
        { id: "ROLE0001", name: "Story", publicId: "R1" },
        { id: "ROLE0002", name: "Art", publicId: "R2" },
      ],
      ok: true,
    });
    expect(mockListCreatorRoles).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: { tenantId: "TENANT001" } }),
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockCacheTag).toHaveBeenCalledWith("creator-roles-TENANT001");
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("fails with an empty list and drops the cache entry when the walk does not complete", async () => {
    // The same cursor coming back stops the walk before the list ends.
    mockListCreatorRoles.mockResolvedValue({
      creatorRoles: [{ id: "ROLE0001", name: "Story", publicId: "R1" }],
      nextToken: "same-page",
    });

    const { listCreatorRoles } = await import("./creator-roles");
    const result = await listCreatorRoles();

    expect(result).toMatchObject({ creatorRoles: [], ok: false });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("fails and drops the cache entry when the fetch fails", async () => {
    mockListCreatorRoles.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listCreatorRoles } = await import("./creator-roles");
    const result = await listCreatorRoles();

    expect(result).toMatchObject({ creatorRoles: [], ok: false });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("deleteCreatorRole", () => {
  it.each(getLocales())(
    "names the credit count in %s, for one credit and for many",
    async (locale) => {
      mockDeleteCreatorRole.mockRejectedValueOnce(creatorRoleInUseError("1"));
      const { deleteCreatorRole } = await import("./creator-roles");
      await expect(
        deleteCreatorRole({ id: "ROLE0001", tenantId: "TENANT001" }, locale)
      ).resolves.toEqual({
        message: deleteInUseByLocale[locale].one,
        ok: false,
      });

      mockDeleteCreatorRole.mockRejectedValueOnce(creatorRoleInUseError("3"));
      await expect(
        deleteCreatorRole({ id: "ROLE0001", tenantId: "TENANT001" }, locale)
      ).resolves.toEqual({
        message: deleteInUseByLocale[locale].three,
        ok: false,
      });
    }
  );

  it("does not read the server's English message when the count is missing", async () => {
    mockDeleteCreatorRole.mockRejectedValue(
      new ConnectError(
        "creator role is used by 3 credits and cannot be deleted",
        Code.FailedPrecondition
      )
    );

    const { deleteCreatorRole } = await import("./creator-roles");
    await expect(
      deleteCreatorRole({ id: "ROLE0001", tenantId: "TENANT001" }, "en")
    ).resolves.toEqual({
      message:
        "A series or an episode is still credited in this role. Re-credit them before deleting it.",
      ok: false,
    });
  });

  it("resolves once the role is gone", async () => {
    mockDeleteCreatorRole.mockResolvedValue({});

    const { deleteCreatorRole } = await import("./creator-roles");
    await expect(
      deleteCreatorRole({ id: "ROLE0001", tenantId: "TENANT001" }, "en")
    ).resolves.toEqual({ ok: true });
  });
});

describe("the operator check before a shared read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it.each([
    [
      "listCreatorRoles",
      async () => {
        const { listCreatorRoles } = await import("./creator-roles");
        return await listCreatorRoles();
      },
      mockListCreatorRoles,
    ],
  ] as const)(
    "%s confirms the operator of the screen's tenant before reading anything",
    async (_, read, rpc) => {
      const redirect = new Error("NEXT_REDIRECT");
      mockVerifyAdminPageSession.mockRejectedValueOnce(redirect);

      await expect(read()).rejects.toBe(redirect);
      expect(rpc).not.toHaveBeenCalled();
    }
  );
});
