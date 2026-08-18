import { describe, expect, it } from "vitest";

import { imageServerLoader } from "./image-loader";

describe("imageServerLoader", () => {
  it("asks image-server for the requested width", () => {
    const url = new URL(
      imageServerLoader({
        src: "/images/creators/6f4bba7c-5d8a-4bb3-8e0f-3e94985f14e8",
        width: 96,
      }),
      "https://example.test"
    );

    expect(url.pathname).toBe(
      "/images/creators/6f4bba7c-5d8a-4bb3-8e0f-3e94985f14e8"
    );
    expect(url.searchParams.get("w")).toBe("96");
    expect(url.searchParams.get("fit")).toBe("scale-down");
  });

  it("leaves quality to Manael's per-format defaults when none is asked for", () => {
    const url = new URL(
      imageServerLoader({ src: "/images/episodes/page-1", width: 640 }),
      "https://example.test"
    );

    expect(url.searchParams.has("q")).toBe(false);
  });

  it("passes a requested quality through as q", () => {
    const url = new URL(
      imageServerLoader({
        quality: 60,
        src: "/images/episodes/page-1",
        width: 640,
      }),
      "https://example.test"
    );

    expect(url.searchParams.get("q")).toBe("60");
  });

  it("keeps query parameters the source URL already carried", () => {
    const url = new URL(
      imageServerLoader({ src: "/images/series/cover?v=3", width: 828 }),
      "https://example.test"
    );

    expect(url.searchParams.get("v")).toBe("3");
    expect(url.searchParams.get("w")).toBe("828");
  });

  it.each([
    "blob:https://example.test/2f1b1e6a-1c5f-4a34-9f2f-2b3a0a4a0d1e",
    "data:image/png;base64,iVBORw0KGgo=",
    "https://cdn.example.test/images/cover.png",
    "/logo.svg",
  ])("returns %s untouched", (src) => {
    expect(imageServerLoader({ src, width: 640 })).toBe(src);
  });
});
