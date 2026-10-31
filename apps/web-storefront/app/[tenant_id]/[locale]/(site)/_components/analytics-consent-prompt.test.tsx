// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reopenAnalyticsConsentBanner } from "#lib/analytics-consent";
import { renderWithClientMessages } from "#lib/render-with-client-messages";

import { AnalyticsConsentPrompt } from "./analytics-consent-prompt";
import { AnalyticsConsentSettingsButton } from "./analytics-consent-settings-button";

const { mockUsePathname } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(() => "/"),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

vi.mock("#components/locale-context", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

const COOKIE = "publira_web_storefront_analytics_consent";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mockUsePathname.mockReturnValue("/");
  // oxlint-disable-next-line unicorn/no-document-cookie -- the test plays the browser the banner writes to
  document.cookie = `${COOKIE}=; Max-Age=0; Path=/`;
  delete (window as Window & { dataLayer?: unknown }).dataLayer;
});

const banner = () =>
  screen.queryByRole("region", { name: "How this site is measured" });

const renderChrome = () =>
  renderWithClientMessages(
    <>
      <AnalyticsConsentSettingsButton cookieName={COOKIE}>
        Cookie settings
      </AnalyticsConsentSettingsButton>
      <AnalyticsConsentPrompt
        cookieName={COOKIE}
        privacyPage={{ href: "/privacy", title: "Privacy Policy" }}
      />
    </>
  );

describe("AnalyticsConsentPrompt", () => {
  it("asks a reader who has not answered, with the privacy page beside the two answers", async () => {
    await renderChrome();

    expect(banner()).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")
    ).toBe("/privacy");
    expect(screen.getByRole("button", { name: "Accept" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Decline" })).not.toBeNull();
  });

  it("goes away once answered, and stores the answer", async () => {
    await renderChrome();

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(banner()).toBeNull();
    expect(document.cookie).toContain(`${COOKIE}=denied`);
  });

  it("comes back from Cookie settings, and the changed answer is sent to Google", async () => {
    // The defaults the loader runs, which the answers are sent against.
    (window as unknown as { dataLayer: unknown[] }).dataLayer = [
      { 0: "consent", 1: "default", 2: { analytics_storage: "denied" } },
    ];
    await renderChrome();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(banner()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cookie settings" }));
    expect(banner()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(banner()).toBeNull();

    const { dataLayer = [] } = window as unknown as {
      dataLayer?: Iterable<unknown>[];
    };

    expect(dataLayer.slice(1).map((entry) => [...entry].slice(0, 3))).toEqual([
      [
        "consent",
        "update",
        expect.objectContaining({ analytics_storage: "granted" }),
      ],
      [
        "consent",
        "update",
        expect.objectContaining({ analytics_storage: "denied" }),
      ],
    ]);
  });

  it("asks nothing of a browser with Global Privacy Control, and offers no settings", async () => {
    vi.stubGlobal("navigator", { ...navigator, globalPrivacyControl: true });
    await renderChrome();
    act(() => {
      reopenAnalyticsConsentBanner();
    });

    expect(banner()).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Cookie settings" })
    ).toBeNull();
    expect(document.cookie).not.toContain(COOKIE);
  });

  it("shows neither the banner nor the settings on a page that loads no tag", async () => {
    mockUsePathname.mockReturnValue("/en/settings/security");
    await renderChrome();

    expect(banner()).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Cookie settings" })
    ).toBeNull();
  });
});
