import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockCreateCreatorRole,
  mockDeleteCreatorRole,
  mockGetAccessToken,
  mockListCreatorRoles,
  mockReorderCreatorRoles,
  mockUpdateCreatorRole,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockCreateCreatorRole: vi.fn(),
  mockDeleteCreatorRole: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListCreatorRoles: vi.fn(),
  mockReorderCreatorRoles: vi.fn(),
  mockUpdateCreatorRole: vi.fn(),
}));

vi.mock("next/cache", () => ({
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
    one: "该角色仍被 1 条署名使用。请先重新指定署名，然后再删除。",
    three: "该角色仍被 3 条署名使用。请先重新指定署名，然后再删除。",
  },
  "zh-Hant": {
    one: "該角色仍被 1 條署名使用。請先重新指定署名，然後再刪除。",
    three: "該角色仍被 3 條署名使用。請先重新指定署名，然後再刪除。",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("deleteCreatorRole", () => {
  it.each(getLocales())(
    "names the credit count in %s, for one credit and for many",
    async (locale) => {
      mockDeleteCreatorRole.mockRejectedValueOnce(creatorRoleInUseError("1"));
      const { deleteCreatorRole } = await import("./creator-roles");
      await expect(
        deleteCreatorRole(
          { publicId: "ROLE0001", tenantId: "TENANT001" },
          locale
        )
      ).resolves.toEqual({
        message: deleteInUseByLocale[locale].one,
        ok: false,
      });

      mockDeleteCreatorRole.mockRejectedValueOnce(creatorRoleInUseError("3"));
      await expect(
        deleteCreatorRole(
          { publicId: "ROLE0001", tenantId: "TENANT001" },
          locale
        )
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
      deleteCreatorRole({ publicId: "ROLE0001", tenantId: "TENANT001" }, "en")
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
      deleteCreatorRole({ publicId: "ROLE0001", tenantId: "TENANT001" }, "en")
    ).resolves.toEqual({ ok: true });
  });
});
