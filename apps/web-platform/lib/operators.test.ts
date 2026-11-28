import { Code, ConnectError } from "@publira/api-client/errors";
import type { PlatformApiClient } from "@publira/api-client/platform/client";
import type { PlatformOperator } from "@publira/api-client/platform/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deactivatePlatformOperator,
  getPlatformOperator,
  listPlatformOperators,
  platformOperatorsCacheTag,
  suspendPlatformOperator,
  unsuspendPlatformOperator,
} from "./operators";

type GetOperatorMethod = PlatformApiClient["operators"]["getOperator"];

type GetOperatorResponse = Awaited<ReturnType<GetOperatorMethod>>;

type ListOperatorsMethod = PlatformApiClient["operators"]["listOperators"];

type ListOperatorsResponse = Awaited<ReturnType<ListOperatorsMethod>>;

const createOperator = (
  overrides: Partial<Omit<PlatformOperator, "$typeName">> = {}
): PlatformOperator => ({
  $typeName: "publira.platform.v1.PlatformOperator",
  createdAt: "2026-08-01T00:00:00Z",
  email: "operator@example.com",
  id: "0199a3c0-0000-7000-8000-000000000001",
  name: "Taylor Reed",
  publicId: "OPERATOR001",
  role: "platform_operator",
  status: "active",
  ...overrides,
});

const createListOperatorsResponse = ({
  nextToken = "",
  operators = [],
  previousToken = "",
}: {
  nextToken?: string;
  operators?: PlatformOperator[];
  previousToken?: string;
}): ListOperatorsResponse => ({
  $typeName: "publira.platform.v1.ListOperatorsResponse",
  nextToken,
  operators,
  previousToken,
});

const createGetOperatorResponse = (
  operator?: PlatformOperator
): GetOperatorResponse => ({
  $typeName: "publira.platform.v1.GetOperatorResponse",
  operator,
});

const {
  mockCacheLife,
  mockCacheTag,
  mockDeactivateOperator,
  mockGetOperator,
  mockGetLocale,
  mockListOperators,
  mockResolveAccessToken,
  mockSuspendOperator,
  mockUnsuspendOperator,
  mockVerifyPlatformSession,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockDeactivateOperator: vi.fn(),
  mockGetOperator: vi.fn<GetOperatorMethod>(),
  mockGetLocale: vi.fn(),
  mockListOperators: vi.fn<ListOperatorsMethod>(),
  mockResolveAccessToken: vi.fn(),
  mockSuspendOperator: vi.fn(),
  mockUnsuspendOperator: vi.fn(),
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
  getLocale: mockGetLocale,
}));

vi.mock("./api-client", () => ({
  SHARED_READ_CACHE_LIFE: "minutes",
  apiClient: {
    operators: {
      deactivateOperator: mockDeactivateOperator,
      getOperator: mockGetOperator,
      listOperators: mockListOperators,
      suspendOperator: mockSuspendOperator,
      unsuspendOperator: mockUnsuspendOperator,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
}));

const serviceHeaders = { headers: { Authorization: "Bearer service-token" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLocale.mockResolvedValue("en");
  mockResolveAccessToken.mockResolvedValue("sess_abc");
  mockVerifyPlatformSession.mockResolvedValue({
    name: "Admin",
    publicId: "usr_1",
    role: "platform_super_admin",
  });
});

describe("listPlatformOperators", () => {
  it("passes pagination arguments to the API and returns tokens and operators", async () => {
    mockListOperators.mockResolvedValueOnce(
      createListOperatorsResponse({
        nextToken: "next-page",
        operators: [createOperator()],
        previousToken: "previous-page",
      })
    );

    await expect(
      listPlatformOperators({ limit: 50, token: "current-page" })
    ).resolves.toEqual({
      nextToken: "next-page",
      ok: true,
      operators: [
        {
          createdAt: "2026-08-01T00:00:00Z",
          email: "operator@example.com",
          id: "0199a3c0-0000-7000-8000-000000000001",
          name: "Taylor Reed",
          publicId: "OPERATOR001",
          role: "platform_operator",
          status: "active",
        },
      ],
      previousToken: "previous-page",
    });
    expect(mockListOperators).toHaveBeenCalledWith(
      { limit: 50, token: "current-page" },
      serviceHeaders
    );
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(listPlatformOperators()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockListOperators).not.toHaveBeenCalled();
  });

  it("returns a shared message for classified RPC errors", async () => {
    mockListOperators.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(listPlatformOperators()).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      nextToken: "",
      ok: false,
      operators: [],
      previousToken: "",
    });
  });

  it("returns an unclassified failure as a value instead of throwing inside the cache scope", async () => {
    mockListOperators.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(listPlatformOperators()).resolves.toMatchObject({
      ok: false,
      operators: [],
    });
  });
});

describe("getPlatformOperator", () => {
  it("answers no operator without calling RPC for invalid input", async () => {
    await expect(getPlatformOperator("   ")).resolves.toEqual({
      ok: true,
      operator: null,
    });
    expect(mockGetOperator).not.toHaveBeenCalled();
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(getPlatformOperator("OPERATOR001")).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockGetOperator).not.toHaveBeenCalled();
  });

  it("trims whitespace before passing input to GetOperator", async () => {
    mockGetOperator.mockResolvedValueOnce(
      createGetOperatorResponse(createOperator())
    );

    await expect(getPlatformOperator("  OPERATOR001  ")).resolves.toMatchObject(
      { ok: true, operator: { publicId: "OPERATOR001" } }
    );
    expect(mockGetOperator).toHaveBeenCalledExactlyOnceWith(
      { publicId: "OPERATOR001" },
      serviceHeaders
    );
  });

  it("calls GetOperator only once without scanning the list", async () => {
    mockGetOperator.mockResolvedValueOnce(
      createGetOperatorResponse(
        createOperator({
          email: "second@example.com",
          name: "Jordan Blake",
          publicId: "OPERATOR101",
        })
      )
    );

    await expect(getPlatformOperator("OPERATOR101")).resolves.toEqual({
      ok: true,
      operator: {
        createdAt: "2026-08-01T00:00:00Z",
        email: "second@example.com",
        id: "0199a3c0-0000-7000-8000-000000000001",
        name: "Jordan Blake",
        publicId: "OPERATOR101",
        role: "platform_operator",
        status: "active",
      },
    });
    expect(mockGetOperator).toHaveBeenCalledExactlyOnceWith(
      { publicId: "OPERATOR101" },
      serviceHeaders
    );
    expect(mockListOperators).not.toHaveBeenCalled();
  });

  it("answers no operator when the operator does not exist", async () => {
    mockGetOperator.mockRejectedValueOnce(
      new ConnectError("operator not found", Code.NotFound)
    );

    await expect(getPlatformOperator("UNKNOWN")).resolves.toEqual({
      ok: true,
      operator: null,
    });
  });

  it("reports a failed read instead of a missing operator", async () => {
    mockGetOperator.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(getPlatformOperator("OPERATOR001")).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenLastCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("returns an unclassified failure as a value instead of throwing inside the cache scope", async () => {
    mockGetOperator.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getPlatformOperator("OPERATOR001")).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("operator status changes", () => {
  const operatorId = "0199a3c0-0000-7000-8000-000000000002";

  it.each([
    ["suspendPlatformOperator", suspendPlatformOperator, mockSuspendOperator],
    [
      "unsuspendPlatformOperator",
      unsuspendPlatformOperator,
      mockUnsuspendOperator,
    ],
    [
      "deactivatePlatformOperator",
      deactivatePlatformOperator,
      mockDeactivateOperator,
    ],
  ] as const)(
    "%s sends the change with the operator's session",
    async (_name, change, mockRpc) => {
      mockRpc.mockResolvedValueOnce({});

      await expect(change(operatorId, "en")).resolves.toEqual({ ok: true });
      expect(mockRpc).toHaveBeenCalledWith(
        { operatorId },
        { headers: { Authorization: "Bearer sess_abc" } }
      );
    }
  );

  it.each([
    [
      "suspendPlatformOperator",
      suspendPlatformOperator,
      mockSuspendOperator,
      "Only an active account can be suspended. Reload the page to see its current status.",
    ],
    [
      "unsuspendPlatformOperator",
      unsuspendPlatformOperator,
      mockUnsuspendOperator,
      "Only a suspended account can be reactivated. Reload the page to see its current status.",
    ],
    [
      "deactivatePlatformOperator",
      deactivatePlatformOperator,
      mockDeactivateOperator,
      "This account is already inactive. Reload the page to see its current status.",
    ],
  ] as const)(
    "%s says the account is not in the status the change starts from",
    async (_name, change, mockRpc, message) => {
      mockRpc.mockRejectedValueOnce(
        new ConnectError("wrong status", Code.FailedPrecondition)
      );

      await expect(change(operatorId, "en")).resolves.toEqual({
        message,
        ok: false,
      });
    }
  );

  it("says a refused permission in the shared wording", async () => {
    mockSuspendOperator.mockRejectedValueOnce(
      new ConnectError("forbidden", Code.PermissionDenied)
    );

    await expect(suspendPlatformOperator(operatorId, "en")).resolves.toEqual({
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
    });
  });

  it("sends nothing without a session", async () => {
    mockResolveAccessToken.mockResolvedValueOnce(null);

    await expect(deactivatePlatformOperator(operatorId, "en")).resolves.toEqual(
      {
        message: "Your session is no longer valid. Please sign in again.",
        ok: false,
      }
    );
    expect(mockDeactivateOperator).not.toHaveBeenCalled();
  });
});

describe("operator cache tags", () => {
  it("files the operator list and an operator's detail under the operators tag", async () => {
    mockListOperators.mockResolvedValueOnce(createListOperatorsResponse({}));
    mockGetOperator.mockResolvedValueOnce(createGetOperatorResponse());

    await listPlatformOperators();
    await getPlatformOperator("OPERATOR001");

    expect(platformOperatorsCacheTag).toBe("platform:operators");
    expect(mockCacheTag).toHaveBeenCalledTimes(2);
    expect(mockCacheTag).toHaveBeenNthCalledWith(1, platformOperatorsCacheTag);
    expect(mockCacheTag).toHaveBeenNthCalledWith(2, platformOperatorsCacheTag);
    // Refreshed after a minute: an email change is confirmed from a link,
    // which clears no tag.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });
});
