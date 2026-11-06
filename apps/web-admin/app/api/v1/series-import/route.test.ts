import { strToU8, zipSync } from "fflate";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminAuthModule from "#lib/admin-auth";
import { EPISODE_PAGES_UPLOAD_MAX_BYTES } from "#lib/episode-pages-upload";

const {
  mockAssertSameOrigin,
  mockGetAdminCurrentUser,
  mockGetTenantCurrency,
  mockResolveTenantRouting,
  mockRevalidateTag,
  mockRunSeriesImport,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAdminCurrentUser: vi.fn(),
  mockGetTenantCurrency: vi.fn(),
  mockResolveTenantRouting: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockRunSeriesImport: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: mockRevalidateTag }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/tenant", () => ({
  SUSPENDED_TENANT: "suspended",
  resolveTenantRouting: mockResolveTenantRouting,
}));

vi.mock("#lib/locale", () => ({ getLocale: () => Promise.resolve("en") }));

vi.mock("#lib/admin-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof AdminAuthModule>()),
  getAdminCurrentUser: mockGetAdminCurrentUser,
}));

vi.mock("#lib/public-api", () => ({
  getTenantCurrency: mockGetTenantCurrency,
}));

vi.mock("#lib/dashboard", () => ({
  tenantDashboardCacheTag: (tenantId: string) => `dashboard-${tenantId}`,
}));

vi.mock("#lib/episode", () => ({
  episodesCacheTag: (tenantId: string) => `episodes-${tenantId}`,
}));

vi.mock("#lib/series", () => ({
  seriesCacheTag: (tenantId: string, publicId: string) =>
    `series-${tenantId}-${publicId}`,
  seriesListCacheTag: (tenantId: string) => `series-list-${tenantId}`,
}));

vi.mock("#lib/series-import", () => ({ runSeriesImport: mockRunSeriesImport }));

const { POST } = await import("./route");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const URL = "https://admin.example.test/api/v1/series-import";
const REFERER = "https://admin.example.test/series";

/** A manifest as a test writes it. */
interface Manifest {
  episodes: { pages: string[]; title: string }[];
  series: { id: string } | { title: string };
  version: number;
}

const zipFile = (manifest: Manifest) => {
  const zip = zipSync({
    "ep01/001.png": strToU8("page"),
    "publira-import.json": strToU8(JSON.stringify(manifest)),
  });

  return new File([new Uint8Array(zip)], "import.zip", {
    type: "application/zip",
  });
};

const validManifest = {
  episodes: [{ pages: ["ep01/001.png"], title: "Episode 1" }],
  series: { title: "A series" },
  version: 1,
};

/** The form as a browser sends it, with the length it declares. */
const post = async (
  fields: Record<string, File | string>,
  headers: Record<string, string> = {}
) => {
  const formData = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }

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

  return POST(request);
};

describe("POST /api/v1/series-import", () => {
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
    mockGetTenantCurrency.mockResolvedValue("JPY");
    mockRunSeriesImport.mockResolvedValue({
      ok: true,
      rows: [
        { pageCount: 1, position: 1, status: "imported", title: "Episode 1" },
      ],
      seriesPublicId: "SERIES001",
    });
  });

  it("runs a checked manifest for the host's tenant and expires its tags", async () => {
    const response = await post({ archive: zipFile(validManifest) });

    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockRunSeriesImport).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ kind: "new", title: "A series" }),
      }),
      expect.objectContaining({
        currency: "JPY",
        locale: "en",
        tenantId: TENANT_ID,
      })
    );

    for (const tag of [
      `series-list-${TENANT_ID}`,
      `series-${TENANT_ID}-SERIES001`,
      `episodes-${TENANT_ID}`,
      `dashboard-${TENANT_ID}`,
    ]) {
      expect(mockRevalidateTag).toHaveBeenCalledWith(tag, { expire: 0 });
    }

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      message: "Imported 1 episode.",
      ok: true,
      rows: [
        { pageCount: 1, position: 1, status: "imported", title: "Episode 1" },
      ],
      seriesPublicId: "SERIES001",
    });
  });

  it("answers the rows of an import that stopped, and still expires its tags", async () => {
    mockRunSeriesImport.mockResolvedValue({
      ok: true,
      rows: [
        { pageCount: 1, position: 1, status: "failed", title: "Episode 1" },
      ],
      seriesPublicId: "SERIES001",
    });

    const response = await post({ archive: zipFile(validManifest) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.rows).toHaveLength(1);
    expect(mockRevalidateTag).toHaveBeenCalled();
  });

  it("creates nothing for a manifest naming a page not in the ZIP, and names it", async () => {
    const response = await post({
      archive: zipFile({
        ...validManifest,
        episodes: [{ pages: ["gone.png"], title: "Episode 1" }],
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      message: "This ZIP cannot be imported.",
      ok: false,
      problems: ["Episode 1: gone.png is not in the ZIP."],
    });
    expect(mockRunSeriesImport).not.toHaveBeenCalled();
  });

  it("holds the manifest to the series the episode list names", async () => {
    const response = await post({
      archive: zipFile(validManifest),
      series_public_id: "SERIES001",
    });

    expect(response.status).toBe(422);
    expect(mockRunSeriesImport).not.toHaveBeenCalled();
  });

  it("refuses a declared length over the limit with the page upload's message, before reading", async () => {
    const response = await post(
      { archive: zipFile(validManifest) },
      { "content-length": String(EPISODE_PAGES_UPLOAD_MAX_BYTES + 1) }
    );

    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.message).toBe(
      "The files are larger than one upload takes. Keep each upload to 256MB or less, or add the pages over several uploads."
    );
    expect(mockRunSeriesImport).not.toHaveBeenCalled();
  });

  it("refuses an operator who may not edit the tenant", async () => {
    mockGetAdminCurrentUser.mockResolvedValue({
      ok: true,
      user: { name: "Viewer", publicId: "USER0002", role: "tenant_viewer" },
    });

    const response = await post({ archive: zipFile(validManifest) });

    expect(response.status).toBe(403);
    expect(mockRunSeriesImport).not.toHaveBeenCalled();
  });

  it("refuses a form without a ZIP", async () => {
    const response = await post({ other: "x" });

    expect(response.status).toBe(400);
  });

  it("refuses while the tenant's currency cannot be read", async () => {
    mockGetTenantCurrency.mockResolvedValue(null);

    const response = await post({ archive: zipFile(validManifest) });

    expect(response.status).toBe(503);
    expect(mockRunSeriesImport).not.toHaveBeenCalled();
  });

  it("answers the series the API would not find", async () => {
    mockRunSeriesImport.mockResolvedValue({ notFound: true, ok: false });

    const response = await post({
      archive: zipFile({ ...validManifest, series: { id: "NOPE" } }),
    });

    expect(response.status).toBe(422);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });
});
