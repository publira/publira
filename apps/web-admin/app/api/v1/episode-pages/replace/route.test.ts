import { Code, ConnectError } from "@publira/api-client/errors";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EPISODE_PAGE_IMAGE_MAX_BYTES,
  EPISODE_PAGE_REPLACE_MAX_BYTES,
} from "#lib/episode-pages-upload";

const {
  mockAssertSameOrigin,
  mockGetAdminCurrentUser,
  mockReplaceEpisodeImage,
  mockResolveTenantRouting,
  mockRevalidateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAdminCurrentUser: vi.fn(),
  mockReplaceEpisodeImage: vi.fn(),
  mockResolveTenantRouting: vi.fn(),
  mockRevalidateTag: vi.fn(),
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
  replaceEpisodeImage: mockReplaceEpisodeImage,
}));

const { POST } = await import("./route");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const EPISODE_ID = "018f0e6a-4000-7000-8000-000000000001";
const IMAGE_ID = "018f0e6a-5000-7000-8000-000000000003";
const URL = "https://admin.example.test/api/v1/episode-pages/replace";
const REFERER = "https://admin.example.test/series/SERIES001/episodes/EP001";

const replaceForm = (image?: File) => {
  const formData = new FormData();
  formData.set("episode_id", EPISODE_ID);
  formData.set("image_id", IMAGE_ID);
  if (image) {
    formData.set("image", image);
  }
  return formData;
};

const page = () => new File(["png"], "page-3.png", { type: "image/png" });

/** The form as a browser sends it, with the length it declares. */
const replace = async (
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

describe("POST /api/v1/episode-pages/replace", () => {
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
    mockReplaceEpisodeImage.mockResolvedValue({ images: [], ok: true });
  });

  it("replaces the page in the host's tenant and expires the episode's tags", async () => {
    const { response } = await replace(replaceForm(page()));

    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockReplaceEpisodeImage).toHaveBeenCalledWith(
      {
        episodeId: EPISODE_ID,
        image: expect.objectContaining({ name: "page-3.png" }),
        imageId: IMAGE_ID,
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
      message: "Page replaced.",
      ok: true,
    });
  });

  it("refuses a body declared over one page without reading it", async () => {
    const { request, response } = await replace(replaceForm(page()), {
      "content-length": String(EPISODE_PAGE_REPLACE_MAX_BYTES + 1),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      message: "The image is larger than 20MB. Choose a smaller one.",
      ok: false,
    });
    expect(request.bodyUsed).toBe(false);
    expect(mockReplaceEpisodeImage).not.toHaveBeenCalled();
  });

  it("refuses an image over 20MB that the framing allowance let through", async () => {
    const image = new File(
      [new Uint8Array(EPISODE_PAGE_IMAGE_MAX_BYTES + 1)],
      "page-3.png",
      { type: "image/png" }
    );

    const { response } = await replace(replaceForm(image));

    expect(response.status).toBe(413);
    expect(mockReplaceEpisodeImage).not.toHaveBeenCalled();
  });

  it("refuses an operator who cannot edit the catalogue, before reading the body", async () => {
    mockGetAdminCurrentUser.mockResolvedValueOnce({
      ok: true,
      user: { name: "Auditor", publicId: "USER0002", role: "tenant_auditor" },
    });

    const { request, response } = await replace(replaceForm(page()));

    expect(response.status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    expect(mockReplaceEpisodeImage).not.toHaveBeenCalled();
  });

  it("refuses a form with no image chosen", async () => {
    const { response } = await replace(replaceForm());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Select an image to put in the page's place.",
      ok: false,
    });
    expect(mockReplaceEpisodeImage).not.toHaveBeenCalled();
  });

  it("refuses a page id that is not one", async () => {
    const formData = replaceForm(page());
    formData.set("image_id", "not-an-id");

    const { response } = await replace(formData);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Page ID is missing.",
      ok: false,
    });
  });

  it("shows the failure the API reported and leaves the tags alone", async () => {
    mockReplaceEpisodeImage.mockResolvedValueOnce({
      message: "The page could not be found. Reload the screen and try again.",
      ok: false,
    });

    const { response } = await replace(replaceForm(page()));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      message: "The page could not be found. Reload the screen and try again.",
      ok: false,
    });
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("names the login page when the API rejects the session during the replacement", async () => {
    mockReplaceEpisodeImage.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    const { response } = await replace(replaceForm(page()));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      location: expect.stringMatching(/^\/login\?/u),
      ok: false,
    });
  });
});
