import { Code, ConnectError } from "@publira/api-client/errors";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EPISODE_PAGES_UPLOAD_MAX_BYTES } from "#lib/episode-pages-upload";

const {
  mockAssertSameOrigin,
  mockGetAdminCurrentUser,
  mockResolveTenantRouting,
  mockRevalidateTag,
  mockUploadEpisodePages,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAdminCurrentUser: vi.fn(),
  mockResolveTenantRouting: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockUploadEpisodePages: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: mockRevalidateTag }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/tenant", () => ({
  SUSPENDED_TENANT: "suspended",
  resolveTenantRouting: mockResolveTenantRouting,
}));

vi.mock("#lib/locale", () => ({ getLocale: () => Promise.resolve("en") }));

vi.mock("#lib/admin-auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAdminCurrentUser: mockGetAdminCurrentUser,
}));

vi.mock("#lib/episode", () => ({
  episodeCacheTag: (tenantId: string, episodeId: string) =>
    `episode-${tenantId}-${episodeId}`,
  episodesCacheTag: (tenantId: string) => `episodes-${tenantId}`,
  uploadEpisodePages: mockUploadEpisodePages,
}));

const { POST } = await import("./route");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const EPISODE_ID = "018f0e6a-4000-7000-8000-000000000001";
const SERIES_ID = "018f0e6a-3000-7000-8000-000000000001";
const URL = "https://admin.example.test/api/v1/episode-pages";
const REFERER = "https://admin.example.test/series/SERIES001/episodes/EP001";

const pagesForm = (fields: Record<string, File | string>) => {
  const formData = new FormData();
  formData.set("episode_id", EPISODE_ID);
  formData.set("series_id", SERIES_ID);
  for (const [name, value] of Object.entries(fields)) {
    formData.append(name, value);
  }
  return formData;
};

/** The form as a browser sends it, with the length it declares. */
const upload = async (
  formData: FormData,
  headers: Record<string, string> = {}
) => {
  const encoded = new Request(URL, { body: formData, method: "POST" });
  const body = await encoded.arrayBuffer();
  const request = new NextRequest(URL, {
    body,
    headers: {
      "content-length": String(body.byteLength),
      "content-type": encoded.headers.get("content-type") ?? "",
      referer: REFERER,
      ...headers,
    },
    method: "POST",
  });
  return { request, response: await POST(request) };
};

describe("POST /api/v1/episode-pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTenantRouting.mockResolvedValue({
      defaultLocale: "en",
      tenantId: TENANT_ID,
    });
    mockGetAdminCurrentUser.mockResolvedValue({
      ok: true,
      user: { name: "Editor", publicId: "USER0001", role: "tenant_editor" },
    });
    mockUploadEpisodePages.mockResolvedValue({ ok: true, uploadedCount: 2 });
  });

  it("adds the page images to the host's tenant and expires the episode's tags", async () => {
    const { response } = await upload(
      pagesForm({
        pages: new File(["a"], "1.png", { type: "image/png" }),
        upload_mode: "pages",
      })
    );

    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockUploadEpisodePages).toHaveBeenCalledWith(
      {
        episodeId: EPISODE_ID,
        pages: [expect.objectContaining({ name: "1.png" })],
        tenantId: TENANT_ID,
      },
      "en"
    );
    expect(mockRevalidateTag).toHaveBeenCalledWith(`episodes-${TENANT_ID}`, {
      expire: 0,
    });
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      `episode-${TENANT_ID}-${EPISODE_ID}`,
      { expire: 0 }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      message: "Page images added.",
      ok: true,
    });
  });

  it("sends a ZIP with the series it is unpacked against", async () => {
    const { response } = await upload(
      pagesForm({
        archive: new File(["zip"], "pages.zip", { type: "application/zip" }),
        upload_mode: "zip",
      })
    );

    expect(response.status).toBe(200);
    expect(mockUploadEpisodePages).toHaveBeenCalledWith(
      {
        archive: expect.objectContaining({ name: "pages.zip" }),
        episodeId: EPISODE_ID,
        seriesId: SERIES_ID,
        tenantId: TENANT_ID,
      },
      "en"
    );
  });

  it("refuses a body declared over the limit without reading it", async () => {
    const { request, response } = await upload(
      pagesForm({ upload_mode: "pages" }),
      { "content-length": String(EPISODE_PAGES_UPLOAD_MAX_BYTES + 1) }
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      message:
        "The files are larger than one upload takes. Keep each upload to 256MB or less, or add the pages over several uploads.",
      ok: false,
    });
    expect(request.bodyUsed).toBe(false);
    expect(mockUploadEpisodePages).not.toHaveBeenCalled();
  });

  it("refuses a body that declares no length", async () => {
    const { request, response } = await upload(
      pagesForm({ upload_mode: "pages" }),
      { "content-length": "" }
    );

    expect(response.status).toBe(411);
    expect(request.bodyUsed).toBe(false);
  });

  it("names the login page coming back to the screen when there is no session, before reading the body", async () => {
    mockGetAdminCurrentUser.mockResolvedValueOnce({
      ok: false,
      requiresSignIn: true,
    });

    const { request, response } = await upload(
      pagesForm({ upload_mode: "pages" })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      location:
        "/login?next=%2Fseries%2FSERIES001%2Fepisodes%2FEP001&reason=session_revoked",
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
    });
    expect(request.bodyUsed).toBe(false);
    expect(mockUploadEpisodePages).not.toHaveBeenCalled();
  });

  it("refuses an operator who cannot edit the catalogue, before reading the body", async () => {
    mockGetAdminCurrentUser.mockResolvedValueOnce({
      ok: true,
      user: { name: "Auditor", publicId: "USER0002", role: "tenant_auditor" },
    });

    const { request, response } = await upload(
      pagesForm({ upload_mode: "pages" })
    );

    expect(response.status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    expect(mockUploadEpisodePages).not.toHaveBeenCalled();
  });

  it("answers not found for a host no tenant claims", async () => {
    mockResolveTenantRouting.mockResolvedValueOnce({
      defaultLocale: null,
      tenantId: null,
    });

    const { response } = await upload(pagesForm({ upload_mode: "pages" }));

    expect(response.status).toBe(404);
    expect(mockGetAdminCurrentUser).not.toHaveBeenCalled();
  });

  it("says the console is unavailable for a suspended tenant, before reading the body", async () => {
    mockResolveTenantRouting.mockResolvedValueOnce("suspended");

    const { request, response } = await upload(
      pagesForm({ upload_mode: "pages" })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      message:
        "This site has been suspended, so its admin console cannot be used. Contact the operator of this service for details.",
      ok: false,
    });
    expect(request.bodyUsed).toBe(false);
    expect(mockGetAdminCurrentUser).not.toHaveBeenCalled();
  });

  it("refuses a file that is not a ZIP in ZIP mode", async () => {
    const { response } = await upload(
      pagesForm({
        archive: new File(["text"], "pages.txt", { type: "text/plain" }),
        upload_mode: "zip",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Select a ZIP (.zip) file.",
      ok: false,
    });
    expect(mockUploadEpisodePages).not.toHaveBeenCalled();
  });

  it("refuses an archive sent without its series", async () => {
    const formData = pagesForm({
      archive: new File(["zip"], "pages.zip", { type: "application/zip" }),
      upload_mode: "zip",
    });
    formData.delete("series_id");

    const { response } = await upload(formData);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Series ID is missing.",
      ok: false,
    });
  });

  it("refuses page mode with no image chosen", async () => {
    const { response } = await upload(pagesForm({ upload_mode: "pages" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Select page images to add.",
      ok: false,
    });
  });

  it("shows the failure the API reported and leaves the tags alone", async () => {
    mockUploadEpisodePages.mockResolvedValueOnce({
      message: "The ePub could not be parsed.",
      ok: false,
    });

    const { response } = await upload(
      pagesForm({
        pages: new File(["a"], "1.png", { type: "image/png" }),
        upload_mode: "pages",
      })
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      message: "The ePub could not be parsed.",
      ok: false,
    });
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("names the login page when the API rejects the session during the upload", async () => {
    mockUploadEpisodePages.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    const { response } = await upload(
      pagesForm({
        pages: new File(["a"], "1.png", { type: "image/png" }),
        upload_mode: "pages",
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      location: expect.stringMatching(/^\/login\?/u),
      ok: false,
    });
  });
});
