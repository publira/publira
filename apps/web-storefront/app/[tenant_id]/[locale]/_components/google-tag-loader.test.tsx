// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { answerAnalyticsConsent } from "#lib/analytics-consent";

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

const COOKIE = "publira_web_storefront_analytics_consent";

afterEach(() => {
  cleanup();
  // oxlint-disable-next-line unicorn/no-document-cookie -- the test plays the browser the banner writes to
  document.cookie = `${COOKIE}=; Max-Age=0; Path=/`;
  delete (window as Window & { dataLayer?: unknown }).dataLayer;
});

const loaded = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>("[data-script], [data-gtm]")].map(
    (element) => element.dataset.script ?? `gtm:${element.dataset.gtm}`
  );

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

  it("starts the tags with every signal denied when the tenant's own tool asks", () => {
    mockUsePathname.mockReturnValue("/");

    const { container } = render(
      <GoogleTagLoader
        {...scripts}
        consent={{ cookieName: COOKIE, mode: "external" }}
      />
    );

    expect(loaded(container)).toEqual([
      "publira-gtag-consent",
      "gtm:GTM-ABC1234",
      "publira-gtag-init",
      "publira-gtag",
    ]);
  });

  it("holds the tags back until the reader agrees on the site's banner", () => {
    mockUsePathname.mockReturnValue("/");

    const { container } = render(
      <GoogleTagLoader
        {...scripts}
        consent={{ cookieName: COOKIE, mode: "opt_in" }}
      />
    );

    expect(loaded(container)).toEqual(["publira-gtag-consent"]);

    act(() => {
      answerAnalyticsConsent(COOKIE, "denied");
    });
    expect(loaded(container)).toEqual(["publira-gtag-consent"]);

    act(() => {
      answerAnalyticsConsent(COOKIE, "granted");
    });
    expect(loaded(container)).toEqual([
      "publira-gtag-consent",
      "gtm:GTM-ABC1234",
      "publira-gtag-init",
      "publira-gtag",
    ]);
  });

  it("loads the tags at once for a reader who agreed before", () => {
    mockUsePathname.mockReturnValue("/");
    answerAnalyticsConsent(COOKIE, "granted");

    const { container } = render(
      <GoogleTagLoader
        {...scripts}
        consent={{ cookieName: COOKIE, mode: "opt_in" }}
      />
    );

    expect(loaded(container)).toContain("publira-gtag");
  });

  it("starts nothing, not even the defaults, on a page that loads no tag", () => {
    mockUsePathname.mockReturnValue("/login");

    const { container } = render(
      <GoogleTagLoader
        {...scripts}
        consent={{ cookieName: COOKIE, mode: "external" }}
      />
    );

    expect(container.childElementCount).toBe(0);
  });
});
