// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeAccessGate } from "./episode-access-gate";

// `<Message>` resolves the locale through `next/root-params`, which only the
// Next.js compiler can provide. The key it was handed is what this file is
// about, so rendering the key itself keeps the assertions readable.
vi.mock("#components/locale-provider", () => ({
  useLocale: () => "ja",
  useTenantDefaultLocale: () => "ja",
}));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: string }) => message,
}));

vi.mock("#components/locale-field", () => ({
  LocaleField: () => null,
}));

afterEach(cleanup);

const props = {
  episodePublicId: "EPISODE_001",
  purchaseSurface: "all" as const,
  seriesPublicId: "SERIES_001",
  signedIn: true,
  tenantId: "TENANT_001",
};

describe("EpisodeAccessGate", () => {
  it("Do not display purchase CTA if payment settings are disabled", () => {
    render(<EpisodeAccessGate {...props} acceptsPayments={false} />);

    expect(
      screen.queryByRole("button", {
        name: "host.episode.gate.purchase",
      })
    ).toBeNull();
    expect(
      screen.getByText("host.episode.gate.signed_in_unpayable_description")
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "host.episode.to_series_detail" })
    ).toBeDefined();
  });

  it("Show purchase CTA if payment settings are enabled", () => {
    render(<EpisodeAccessGate {...props} acceptsPayments />);

    expect(
      screen.getByRole("button", { name: "host.episode.gate.purchase" })
    ).toBeDefined();
  });

  describe("an episode sold in the app alone", () => {
    const appOnly = {
      ...props,
      acceptsPayments: true,
      appStoreUrl: "https://apps.apple.com/app/id123",
      googlePlayUrl: "https://play.google.com/store/apps/details?id=test",
      purchaseSurface: "app" as const,
    };

    it("Offer each store the tenant lists instead of the checkout", () => {
      render(<EpisodeAccessGate {...appOnly} />);

      expect(
        screen.queryByRole("button", { name: "host.episode.gate.purchase" })
      ).toBeNull();
      expect(
        screen.getByText("host.episode.gate.signed_in_app_only_description")
      ).toBeDefined();
      expect(
        screen
          .getByRole("link", { name: "host.episode.gate.app_store" })
          .getAttribute("href")
      ).toBe("https://apps.apple.com/app/id123");
      expect(
        screen
          .getByRole("link", { name: "host.episode.gate.google_play" })
          .getAttribute("href")
      ).toBe("https://play.google.com/store/apps/details?id=test");
    });

    it("Show a QR code for each store only on a screen wide enough to scan it from", () => {
      const { container } = render(<EpisodeAccessGate {...appOnly} />);

      const codes = [...container.querySelectorAll("svg")];
      expect(codes).toHaveLength(2);
      for (const code of codes) {
        expect(code.classList.contains("hidden")).toBe(true);
        expect(code.classList.contains("md:block")).toBe(true);
      }
    });

    it("Leave out a store the app is not listed in", () => {
      render(<EpisodeAccessGate {...appOnly} googlePlayUrl={undefined} />);

      expect(
        screen.getByRole("link", { name: "host.episode.gate.app_store" })
      ).toBeDefined();
      expect(
        screen.queryByRole("link", { name: "host.episode.gate.google_play" })
      ).toBeNull();
    });

    it("Still say where the episode is sold when no store is listed", () => {
      render(
        <EpisodeAccessGate
          {...appOnly}
          appStoreUrl={undefined}
          googlePlayUrl={undefined}
        />
      );

      expect(
        screen.queryByRole("button", { name: "host.episode.gate.purchase" })
      ).toBeNull();
      expect(
        screen.getByText("host.episode.gate.signed_in_app_only_description")
      ).toBeDefined();
      expect(
        screen.queryByRole("link", { name: "host.episode.gate.app_store" })
      ).toBeNull();
      expect(
        screen.queryByRole("link", { name: "host.episode.gate.google_play" })
      ).toBeNull();
    });

    it("Keep the sign-in link for a guest who may have bought it in the app", () => {
      render(<EpisodeAccessGate {...appOnly} signedIn={false} />);

      expect(
        screen.getByText("host.episode.gate.guest_app_only_description")
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: "host.episode.gate.login" })
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: "host.episode.gate.app_store" })
      ).toBeDefined();
    });

    it("Say the site cannot take purchases when the tenant cannot take payments", () => {
      render(<EpisodeAccessGate {...appOnly} acceptsPayments={false} />);

      expect(
        screen.getByText("host.episode.gate.signed_in_unpayable_description")
      ).toBeDefined();
      expect(
        screen.queryByRole("link", { name: "host.episode.gate.app_store" })
      ).toBeNull();
    });
  });

  it("Offer the checkout for an episode sold on the web alone", () => {
    render(
      <EpisodeAccessGate {...props} acceptsPayments purchaseSurface="web" />
    );

    expect(
      screen.getByRole("button", { name: "host.episode.gate.purchase" })
    ).toBeDefined();
  });
});
