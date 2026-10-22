// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleTagLoader } from "./google-tag-loader";

const { mockUsePathname } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(() => "/"),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

// `next/script` loads after hydration, so the scripts are stood in for by
// elements that say which one would have loaded.
vi.mock("next/script", () => ({
  default: ({ id, src }: { id: string; src?: string }) => (
    <i data-script={id} data-src={src} />
  ),
}));

vi.mock("@next/third-parties/google", () => ({
  GoogleTagManager: ({
    gtmId,
    gtmScriptUrl,
  }: {
    gtmId: string;
    gtmScriptUrl?: string;
  }) => <i data-gtm={gtmId} data-src={gtmScriptUrl} />,
}));

afterEach(() => {
  cleanup();
});

const scripts = {
  ga4: {
    measurementId: "G-ABC123DEF4",
    src: "https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4",
  },
  gtm: { containerId: "GTM-ABC1234" },
};

describe("GoogleTagLoader", () => {
  it("loads both tags on a catalogue page", () => {
    mockUsePathname.mockReturnValue("/ja/series/01HSERIES");
    const { container } = render(<GoogleTagLoader {...scripts} />);

    expect(container.querySelector("[data-gtm='GTM-ABC1234']")).not.toBeNull();
    expect(
      container.querySelector<HTMLElement>("[data-script='publira-gtag']")
        ?.dataset.src
    ).toBe(scripts.ga4.src);
  });

  it.each(["/login", "/en/settings/security", "/reset-password/requested"])(
    "loads nothing on %s",
    (pathname) => {
      mockUsePathname.mockReturnValue(pathname);
      const { container } = render(<GoogleTagLoader {...scripts} />);

      expect(container.childElementCount).toBe(0);
    }
  );

  it("reads the rewritten pathname of a prerendered shell the same way", () => {
    mockUsePathname.mockReturnValue(
      "/0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b/en/login"
    );
    const { container } = render(<GoogleTagLoader {...scripts} />);

    expect(container.childElementCount).toBe(0);
  });
});
