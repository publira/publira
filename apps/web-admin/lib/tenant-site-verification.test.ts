import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantSiteVerificationApi,
  mockUpdateTenantSiteVerificationApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantSiteVerificationApi: vi.fn(),
  mockUpdateTenantSiteVerificationApi: vi.fn(),
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
    tenantSettings: {
      getTenantSiteVerification: mockGetTenantSiteVerificationApi,
      updateTenantSiteVerification: mockUpdateTenantSiteVerificationApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const INVALID_CODE =
  "Paste the whole <meta> tag, or only its content value: up to 128 letters, digits, hyphens, and underscores.";

describe("tenant-site-verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads the codes under the tenant's tag", async () => {
    mockGetTenantSiteVerificationApi.mockResolvedValueOnce({
      siteVerification: {
        bingSiteVerification: "0123ABCD",
        googleSiteVerification: "aBc-123",
      },
    });

    const { getTenantSiteVerification } =
      await import("./tenant-site-verification");

    const result = await getTenantSiteVerification(" TENANT001 ", "en");

    expect(result).toEqual({
      ok: true,
      siteVerification: { bing: "0123ABCD", google: "aBc-123" },
    });
    expect(mockGetTenantSiteVerificationApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:site-verification"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("answers a tenant that has saved nothing as having no codes", async () => {
    mockGetTenantSiteVerificationApi.mockResolvedValueOnce({});

    const { getTenantSiteVerification } =
      await import("./tenant-site-verification");

    await expect(getTenantSiteVerification("TENANT001", "en")).resolves.toEqual(
      {
        ok: true,
        siteVerification: { bing: "", google: "" },
      }
    );
  });

  it("reports a missing session and drops the cache entry", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantSiteVerification } =
      await import("./tenant-site-verification");

    await expect(getTenantSiteVerification("TENANT001", "en")).resolves.toEqual(
      {
        message: "Your session is no longer valid. Please sign in again.",
        ok: false,
        requiresSignIn: true,
      }
    );
    expect(mockGetTenantSiteVerificationApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failed read without naming a code and drops the cache entry", async () => {
    mockGetTenantSiteVerificationApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantSiteVerification } =
      await import("./tenant-site-verification");

    const result = await getTenantSiteVerification("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("siteVerification");
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports the previous release's server, which has no such RPC, as a failed read rather than throwing", async () => {
    mockGetTenantSiteVerificationApi.mockRejectedValueOnce(
      new ConnectError("not implemented", Code.Unimplemented)
    );

    const { getTenantSiteVerification } =
      await import("./tenant-site-verification");

    await expect(getTenantSiteVerification("TENANT001", "en")).resolves.toEqual(
      {
        message:
          "Could not load the verification codes. Please try again later.",
        ok: false,
      }
    );
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetTenantSiteVerificationApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantSiteVerification } =
      await import("./tenant-site-verification");

    await expect(getTenantSiteVerification("TENANT001", "en")).rejects.toThrow(
      Error
    );
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("writes both codes and answers them as the server stored them", async () => {
    mockUpdateTenantSiteVerificationApi.mockResolvedValueOnce({
      siteVerification: { googleSiteVerification: "aBc-123" },
    });

    const { updateTenantSiteVerification } =
      await import("./tenant-site-verification");

    const result = await updateTenantSiteVerification(
      { bing: "", google: "aBc-123", tenantId: " TENANT001 " },
      "en"
    );

    expect(result).toEqual({
      ok: true,
      siteVerification: { bing: "", google: "aBc-123" },
    });
    expect(mockUpdateTenantSiteVerificationApi).toHaveBeenCalledWith(
      {
        siteVerification: {
          bingSiteVerification: "",
          googleSiteVerification: "aBc-123",
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it.each([
    ["google", "site_verification.google_site_verification"],
    ["bing", "site_verification.bing_site_verification"],
  ])(
    "words the server's refusal of the %s code for its field",
    async (field, violation) => {
      mockUpdateTenantSiteVerificationApi.mockRejectedValueOnce(
        new ConnectError("rejected", Code.InvalidArgument, undefined, [
          {
            desc: BadRequestSchema,
            value: { fieldViolations: [{ field: violation }] },
          },
        ])
      );

      const { updateTenantSiteVerification } =
        await import("./tenant-site-verification");

      const result = await updateTenantSiteVerification(
        { bing: "0123ABCD", google: "aBc-123", tenantId: "T" },
        "en"
      );

      expect(result).toEqual({
        fieldErrors: { [field]: INVALID_CODE },
        message: INVALID_CODE,
        ok: false,
      });
    }
  );

  it("leaves an ended session to the caller's sign-in redirect", async () => {
    mockUpdateTenantSiteVerificationApi.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const { updateTenantSiteVerification } =
      await import("./tenant-site-verification");

    await expect(
      updateTenantSiteVerification(
        { bing: "", google: "", tenantId: "T" },
        "en"
      )
    ).rejects.toBeInstanceOf(ConnectError);
  });
});
