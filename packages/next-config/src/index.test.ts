import { describe, expect, it } from "vitest";

import { withMicrofrontends } from "./index";

describe("withMicrofrontends", () => {
  it("appName が空の場合は例外を投げる", () => {
    expect(() => withMicrofrontends({}, { appName: "  " })).toThrow(
      "withMicrofrontends: opts.appName is required"
    );
  });

  it("assetPrefix と images.path のデフォルト値を設定する", async () => {
    const config = withMicrofrontends({}, { appName: "web-public" });

    expect(config.assetPrefix).toBe("/web-public-assets");
    expect(config.images?.path).toBe("/web-public-assets/_next/image");

    const rewrites = await config.rewrites?.();
    expect(Array.isArray(rewrites)).toBe(true);
    if (Array.isArray(rewrites)) {
      expect(rewrites[0]).toEqual({
        destination: "/_next/:path+",
        source: "/web-public-assets/_next/:path+",
      });
    }
  });

  it("既存 rewrites が object 形式でも beforeFiles にマージする", async () => {
    const config = withMicrofrontends(
      {
        rewrites: () =>
          Promise.resolve({
            afterFiles: [{ destination: "/b", source: "/a" }],
            beforeFiles: [{ destination: "/d", source: "/c" }],
            fallback: [],
          }),
      },
      { appName: "catalog" }
    );

    const rewrites = await config.rewrites?.();
    expect(Array.isArray(rewrites)).toBe(false);
    if (!Array.isArray(rewrites) && rewrites) {
      expect(rewrites.beforeFiles).toBeTruthy();
      const beforeFiles = rewrites.beforeFiles ?? [];

      expect(beforeFiles[0]).toEqual({
        destination: "/_next/:path+",
        source: "/catalog-assets/_next/:path+",
      });
      expect(beforeFiles[1]).toEqual({
        destination: "/d",
        source: "/c",
      });
    }
  });
});
