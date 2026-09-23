import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantLegalPagesApi,
  mockUpdateTenantLegalPagesApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantLegalPagesApi: vi.fn(),
  mockUpdateTenantLegalPagesApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    tenantSettings: {
      getTenantLegalPages: mockGetTenantLegalPagesApi,
      updateTenantLegalPages: mockUpdateTenantLegalPagesApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const pageError = (field: string) =>
  new ConnectError("page is not published", Code.InvalidArgument, undefined, [
    {
      desc: BadRequestSchema,
      value: { fieldViolations: [{ field }] },
    },
  ]);

describe("tenant-legal-pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads both nominations under the tenant's tag and the page list's tag", async () => {
    mockGetTenantLegalPagesApi.mockResolvedValueOnce({
      pages: {
        privacyPage: {
          pageId: "page-2",
          published: false,
          slug: "privacy",
          title: "Privacy policy",
        },
        termsPage: {
          pageId: "page-1",
          published: true,
          slug: "terms",
          title: "Terms of service",
        },
      },
    });

    const { getTenantLegalPages } = await import("./tenant-legal-pages");
    const result = await getTenantLegalPages("TENANT001", "en");

    expect(result).toEqual({
      ok: true,
      pages: {
        privacyPage: {
          pageId: "page-2",
          published: false,
          slug: "privacy",
          title: "Privacy policy",
        },
        termsPage: {
          pageId: "page-1",
          published: true,
          slug: "terms",
          title: "Terms of service",
        },
      },
    });
    expect(mockGetTenantLegalPagesApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    // Unpublishing or renaming a page clears the page list's tag, and this
    // read reports both.
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:legal-pages");
    expect(mockCacheTag).toHaveBeenCalledWith("pages-TENANT001");
  });

  it("reads a role with no page as absent", async () => {
    mockGetTenantLegalPagesApi.mockResolvedValueOnce({ pages: {} });

    const { getTenantLegalPages } = await import("./tenant-legal-pages");
    const result = await getTenantLegalPages("TENANT001", "en");

    expect(result).toEqual({
      ok: true,
      pages: { privacyPage: undefined, termsPage: undefined },
    });
  });

  it("asks for a sign-in when there is no session", async () => {
    mockGetAccessToken.mockResolvedValueOnce("");

    const { getTenantLegalPages } = await import("./tenant-legal-pages");
    const result = await getTenantLegalPages("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockGetTenantLegalPagesApi).not.toHaveBeenCalled();
  });

  it("writes both ids and reads back what was stored", async () => {
    mockUpdateTenantLegalPagesApi.mockResolvedValueOnce({
      pages: {
        termsPage: {
          pageId: "page-1",
          published: true,
          slug: "terms",
          title: "Terms of service",
        },
      },
    });

    const { updateTenantLegalPages } = await import("./tenant-legal-pages");
    const result = await updateTenantLegalPages(
      { privacyPageId: "", tenantId: "TENANT001", termsPageId: "page-1" },
      "en"
    );

    expect(mockUpdateTenantLegalPagesApi).toHaveBeenCalledWith(
      {
        privacyPageId: "",
        tenant: { tenantId: "TENANT001" },
        termsPageId: "page-1",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      ok: true,
      pages: {
        privacyPage: undefined,
        termsPage: {
          pageId: "page-1",
          published: true,
          slug: "terms",
          title: "Terms of service",
        },
      },
    });
  });

  it.each([
    [
      "terms_page_id",
      "The page chosen as the terms of service is not published. Reload the page and choose again.",
    ],
    [
      "privacy_page_id",
      "The page chosen as the privacy policy is not published. Reload the page and choose again.",
    ],
  ])(
    "names the role whose page the API refused in %s",
    async (field, message) => {
      mockUpdateTenantLegalPagesApi.mockRejectedValueOnce(pageError(field));

      const { updateTenantLegalPages } = await import("./tenant-legal-pages");
      const result = await updateTenantLegalPages(
        {
          privacyPageId: "page-2",
          tenantId: "TENANT001",
          termsPageId: "page-1",
        },
        "en"
      );

      expect(result).toEqual({ message, ok: false });
    }
  );
});
