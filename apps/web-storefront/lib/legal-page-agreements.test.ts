import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAgreeToLegalPages,
  mockGetMyLegalPageAgreements,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockAgreeToLegalPages: vi.fn(),
  mockGetMyLegalPageAgreements: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      agreeToLegalPages: mockAgreeToLegalPages,
      getMyLegalPageAgreements: mockGetMyLegalPageAgreements,
    },
  },
  buildSessionHeaders: (accessToken: string) => ({
    headers: { authorization: `Bearer ${accessToken}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const terms = {
  slug: "/terms",
  title: "Terms of service",
  versionId: "v-terms",
};
const privacy = {
  slug: "/legal/privacy",
  title: "Privacy policy",
  versionId: "v-privacy",
};

const importModule = () => import("./legal-page-agreements");

describe("getOwedLegalPages", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue("access-token");
  });

  it("lists each page the reader owes once, linked at its public path", async () => {
    mockGetMyLegalPageAgreements.mockResolvedValueOnce({
      privacyPage: privacy,
      termsPage: terms,
    });
    const { getOwedLegalPages } = await importModule();

    await expect(getOwedLegalPages(tenantId, "en")).resolves.toEqual([
      { href: "/terms", title: "Terms of service", versionId: "v-terms" },
      {
        href: "/legal/privacy",
        title: "Privacy policy",
        versionId: "v-privacy",
      },
    ]);
    expect(mockGetMyLegalPageAgreements).toHaveBeenCalledWith(
      { locale: "en", tenant: { tenantId } },
      { headers: { authorization: "Bearer access-token" } }
    );
  });

  it("lists a page named for both roles once", async () => {
    mockGetMyLegalPageAgreements.mockResolvedValueOnce({
      privacyPage: terms,
      termsPage: terms,
    });
    const { getOwedLegalPages } = await importModule();

    await expect(getOwedLegalPages(tenantId, "en")).resolves.toHaveLength(1);
  });

  it("asks nothing of a browser holding no session", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");
    const { getOwedLegalPages } = await importModule();

    await expect(getOwedLegalPages(tenantId, "en")).resolves.toEqual([]);
    expect(mockGetMyLegalPageAgreements).not.toHaveBeenCalled();
  });
});

describe("agreeToLegalPages", () => {
  it("is agreed once the reader owes nothing", async () => {
    mockAgreeToLegalPages.mockResolvedValueOnce({});
    const { agreeToLegalPages } = await importModule();

    await expect(
      agreeToLegalPages(tenantId, "en", ["v-terms"], "access-token")
    ).resolves.toBe("agreed");
    expect(mockAgreeToLegalPages).toHaveBeenCalledWith(
      { agreedPageVersionIds: ["v-terms"], locale: "en", tenant: { tenantId } },
      { headers: { authorization: "Bearer access-token" } }
    );
  });

  it("has changed when a version was published since the screen was drawn", async () => {
    mockAgreeToLegalPages.mockResolvedValueOnce({
      termsPage: { ...terms, versionId: "v-terms-2" },
    });
    const { agreeToLegalPages } = await importModule();

    await expect(
      agreeToLegalPages(tenantId, "en", ["v-terms"], "access-token")
    ).resolves.toBe("changed");
  });

  it("has changed when the tenant no longer names the page agreed to", async () => {
    mockAgreeToLegalPages.mockRejectedValueOnce(
      new ConnectError("not a legal page", Code.InvalidArgument)
    );
    const { agreeToLegalPages } = await importModule();

    await expect(
      agreeToLegalPages(tenantId, "en", ["v-old"], "access-token")
    ).resolves.toBe("changed");
  });

  it("propagates every other refusal", async () => {
    mockAgreeToLegalPages.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );
    const { agreeToLegalPages } = await importModule();

    await expect(
      agreeToLegalPages(tenantId, "en", ["v-terms"], "access-token")
    ).rejects.toMatchObject({ code: Code.Unauthenticated });
  });
});
