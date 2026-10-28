import { DEFAULT_TENANT_THEME_COLORS } from "@publira/utils/theme-css-variables";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

const reads = vi.hoisted(() => ({
  getTenantPublicOrigin: vi.fn(),
  getTenantSiteInfo: vi.fn(),
  getTenantSiteLabel: vi.fn(),
  getTenantTheme: vi.fn(),
  resolveOpenGraphCardText: vi.fn(),
}));

vi.mock("./open-graph-card-subject", () => ({
  resolveOpenGraphCardText: reads.resolveOpenGraphCardText,
}));
vi.mock("./tenant", () => ({
  getTenantPublicOrigin: reads.getTenantPublicOrigin,
  getTenantSiteInfo: reads.getTenantSiteInfo,
  getTenantSiteLabel: reads.getTenantSiteLabel,
  getTenantTheme: reads.getTenantTheme,
}));

const { openGraphCardResponse } = await import("./open-graph-card");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SEGMENTS = { locale: "en", tenant_id: TENANT_ID };
const SERIES = { kind: "series", seriesId: "SeedSERSAAA1" } as const;

/** The one-pixel PNG an image server could answer a logo with. */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { height: view.getUint32(20), width: view.getUint32(16) };
};

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("no network in a unit test"));
  reads.getTenantPublicOrigin.mockResolvedValue("https://seed.example");
  reads.getTenantSiteInfo.mockResolvedValue({ name: "Seed Tenant" });
  reads.getTenantSiteLabel.mockResolvedValue("Seed Tenant");
  reads.getTenantTheme.mockResolvedValue({
    light: DEFAULT_TENANT_THEME_COLORS,
  });
  reads.resolveOpenGraphCardText.mockResolvedValue({
    ok: true,
    value: { title: "Seed Series 001" },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openGraphCardResponse", () => {
  it("answers a 1200 by 630 PNG", async () => {
    const response = await openGraphCardResponse(SEGMENTS, SERIES);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toContain("max-age=30");
    expect(pngSize(new Uint8Array(await response.arrayBuffer()))).toEqual({
      height: 630,
      width: 1200,
    });
    expect(reads.resolveOpenGraphCardText).toHaveBeenCalledWith(
      TENANT_ID,
      "en",
      SERIES
    );
  });

  it.each([
    ["ja", "進撃の物語 第1話「はじまり」"],
    ["en", "Seed Series 001: The Beginning"],
    ["ko", "한국어 제목의 시리즈"],
    ["zh-Hans", "简体中文标题的系列"],
    ["zh-Hant", "繁體中文標題的系列"],
    ["zh-Hant", "한국어 레이블 简体标签 繁體標籤"],
  ])("draws a %s card from the shipped faces alone", async (locale, title) => {
    reads.resolveOpenGraphCardText.mockResolvedValue({
      ok: true,
      value: { eyebrow: "Seed Tenant", title },
    });

    const response = await openGraphCardResponse(
      { locale, tenant_id: TENANT_ID },
      SERIES
    );

    expect(response.status).toBe(200);
    // `ImageResponse` fetches a face from Google Fonts for any glyph the
    // faces it was handed lack; the card's text needs none.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches the logo from the tenant's origin at the size it is drawn", async () => {
    reads.getTenantSiteInfo.mockResolvedValue({
      logoImageVariants: [
        {
          contentType: "image/png",
          fileSizeBytes: 100,
          height: 100,
          label: "logo",
          url: "/images/tenants/22222222-2222-4222-8222-222222222222/logo",
          variantType: "logo",
          width: 400,
        },
      ],
      name: "Seed Tenant",
    });
    fetchSpy.mockResolvedValue(
      new Response(ONE_PIXEL_PNG, { headers: { "Content-Type": "image/png" } })
    );

    const response = await openGraphCardResponse(SEGMENTS, SERIES);

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://seed.example/images/tenants/22222222-2222-4222-8222-222222222222/logo?w=288&fit=scale-down",
      expect.objectContaining({ headers: { Accept: "image/png" } })
    );
  });

  it("still draws the card when the logo cannot be fetched", async () => {
    reads.getTenantSiteInfo.mockResolvedValue({
      logoImageVariants: [
        {
          contentType: "image/png",
          fileSizeBytes: 100,
          height: 100,
          label: "logo",
          url: "/images/tenants/22222222-2222-4222-8222-222222222222/logo",
          variantType: "logo",
          width: 400,
        },
      ],
      name: "Seed Tenant",
    });

    const response = await openGraphCardResponse(SEGMENTS, SERIES);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it.each([
    [
      "the static-param placeholder",
      { ...SEGMENTS, tenant_id: "__placeholder__" },
    ],
    [
      "a segment that is not a tenant id",
      { ...SEGMENTS, tenant_id: "favicon.ico" },
    ],
    ["a locale the site does not serve", { ...SEGMENTS, locale: "fr" }],
  ])("answers 404 for %s", async (_name, segments) => {
    const response = await openGraphCardResponse(segments, SERIES);

    expect(response.status).toBe(404);
    expect(reads.resolveOpenGraphCardText).not.toHaveBeenCalled();
  });

  it("answers 404 for identifiers the route's schema refused", async () => {
    const response = await openGraphCardResponse(SEGMENTS, null);

    expect(response.status).toBe(404);
  });

  it("answers 404 where the page would", async () => {
    reads.resolveOpenGraphCardText.mockResolvedValue({ ok: true, value: null });

    const response = await openGraphCardResponse(SEGMENTS, SERIES);

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 503 where a read behind the card could not be made", async () => {
    reads.resolveOpenGraphCardText.mockResolvedValue({
      message: "Could not show the series",
      ok: false,
    });

    const response = await openGraphCardResponse(SEGMENTS, SERIES);

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
