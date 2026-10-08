// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeAccessGate } from "./episode-access-gate";

// `<Message>` resolves the locale through `next/root-params`, which only the
// Next.js compiler can provide. The key it was handed is what this file is
// about, so rendering the key itself keeps the assertions readable.
vi.mock("#components/locale-context", () => ({
  useLocale: () => "ja",
  useTenantDefaultLocale: () => "ja",
}));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: string }) => message,
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({ message }: { message: string }) => message,
}));

vi.mock("#components/locale-field", () => ({
  LocaleField: () => null,
}));

afterEach(cleanup);

const ticketButton = () =>
  screen.queryByRole("button", {
    name: "host.episode.gate.wait_free_use",
  });

const props = {
  appPayments: { appStore: false, googlePlay: false },
  episodeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  episodePublicId: "EPISODE_001",
  locale: "en" as const,
  purchaseSurface: "all" as const,
  seriesPublicId: "SERIES_001",
  signedIn: true,
  tenantId: "TENANT_001",
  timeZone: "UTC",
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
      appPayments: { appStore: true, googlePlay: true },
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

    it("Point to the app that sells through the stores without a web payment provider", () => {
      render(<EpisodeAccessGate {...appOnly} acceptsPayments={false} />);

      expect(
        screen.getByText("host.episode.gate.signed_in_app_only_description")
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: "host.episode.gate.app_store" })
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: "host.episode.gate.google_play" })
      ).toBeDefined();
    });

    it("Leave out a store whose app cannot sell it", () => {
      render(
        <EpisodeAccessGate
          {...appOnly}
          acceptsPayments={false}
          appPayments={{ appStore: true, googlePlay: false }}
        />
      );

      expect(
        screen.getByText("host.episode.gate.signed_in_app_only_description")
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: "host.episode.gate.app_store" })
      ).toBeDefined();
      expect(
        screen.queryByRole("link", { name: "host.episode.gate.google_play" })
      ).toBeNull();
    });

    it("Say the site cannot take purchases when neither the site nor the app can sell it", () => {
      render(
        <EpisodeAccessGate
          {...appOnly}
          acceptsPayments={false}
          appPayments={{ appStore: false, googlePlay: false }}
        />
      );

      expect(
        screen.getByText("host.episode.gate.signed_in_unpayable_description")
      ).toBeDefined();
      expect(
        screen.queryByRole("link", { name: "host.episode.gate.app_store" })
      ).toBeNull();
    });

    it("Offer no checkout while the app cannot sell it, even where the site takes payments", () => {
      render(
        <EpisodeAccessGate
          {...appOnly}
          appPayments={{ appStore: false, googlePlay: false }}
        />
      );

      expect(
        screen.queryByRole("button", { name: "host.episode.gate.purchase" })
      ).toBeNull();
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

  describe("the next free episode", () => {
    const nextFreeEpisode = {
      isFree: true,
      orderIndex: 4,
      price: 0,
      publicId: "EPISODE_004",
      purchaseSurface: "all" as const,
      title: "Episode 4",
    };

    it("Link to it beside the purchase, which stays the one filled action", () => {
      render(
        <EpisodeAccessGate
          {...props}
          acceptsPayments
          nextFreeEpisode={nextFreeEpisode}
        />
      );

      const link = screen.getByRole("link", {
        name: "host.episode.gate.next_free_episode",
      });
      expect(link.getAttribute("href")).toBe(
        "/series/SERIES_001/episodes/EPISODE_004"
      );
      expect(link.classList.contains("bg-secondary")).toBe(false);
      expect(
        screen
          .getByRole("button", { name: "host.episode.gate.purchase" })
          .classList.contains("bg-secondary")
      ).toBe(true);
    });

    it("Offer it to a guest as well", () => {
      render(
        <EpisodeAccessGate
          {...props}
          acceptsPayments
          nextFreeEpisode={nextFreeEpisode}
          signedIn={false}
        />
      );

      expect(
        screen.getByRole("link", {
          name: "host.episode.gate.next_free_episode",
        })
      ).toBeDefined();
    });

    it("Leave the link out when no later episode is free", () => {
      render(<EpisodeAccessGate {...props} acceptsPayments />);

      expect(
        screen.queryByRole("link", {
          name: "host.episode.gate.next_free_episode",
        })
      ).toBeNull();
    });
  });

  describe("wait-for-free", () => {
    it("Offer a ready ticket as the Shu, ahead of the purchase", () => {
      render(
        <EpisodeAccessGate
          {...props}
          acceptsPayments
          waitFree={{ accessHours: 72, kind: "ready" }}
        />
      );

      expect(
        screen.getByText("host.episode.gate.wait_free_ready")
      ).toBeDefined();
      expect(ticketButton()?.classList.contains("bg-secondary")).toBe(true);
      expect(
        screen
          .getByRole("button", { name: "host.episode.gate.purchase" })
          .classList.contains("bg-secondary")
      ).toBe(false);
      const form = ticketButton()?.closest("form");
      expect(
        form?.querySelector<HTMLInputElement>('input[name="episodeId"]')?.value
      ).toBe(props.episodeId);
    });

    it("Count down to a ticket that is still recharging", () => {
      render(
        <EpisodeAccessGate
          {...props}
          acceptsPayments
          waitFree={{
            accessHours: 72,
            kind: "recharging",
            nextAvailableAt: Temporal.Now.instant()
              .add({ hours: 5 })
              .toString(),
          }}
        />
      );

      expect(
        screen.getByText("host.episode.gate.wait_free_recharging_in")
      ).toBeDefined();
      expect(ticketButton()).toBeNull();
      expect(
        screen
          .getByRole("button", { name: "host.episode.gate.purchase" })
          .classList.contains("bg-secondary")
      ).toBe(true);
    });

    it("Offer a recharged ticket without taking the Shu from the purchase", () => {
      render(
        <EpisodeAccessGate
          {...props}
          acceptsPayments
          waitFree={{
            accessHours: 72,
            kind: "recharging",
            nextAvailableAt: Temporal.Now.instant()
              .subtract({ minutes: 1 })
              .toString(),
          }}
        />
      );

      expect(ticketButton()?.classList.contains("bg-secondary")).toBe(false);
      expect(
        screen
          .getByRole("button", { name: "host.episode.gate.purchase" })
          .classList.contains("bg-secondary")
      ).toBe(true);
    });

    it("Say a ticket cannot open one of the newest episodes", () => {
      render(
        <EpisodeAccessGate
          {...props}
          acceptsPayments
          waitFree={{ kind: "excluded" }}
        />
      );

      expect(
        screen.getByText("host.episode.gate.wait_free_excluded")
      ).toBeDefined();
      expect(ticketButton()).toBeNull();
    });

    it("Tell a guest that signing in brings a ticket", () => {
      render(
        <EpisodeAccessGate
          {...props}
          acceptsPayments
          signedIn={false}
          waitFree={{ kind: "guest" }}
        />
      );

      expect(
        screen.getByText("host.episode.gate.wait_free_guest")
      ).toBeDefined();
      expect(ticketButton()).toBeNull();
      expect(
        screen
          .getByRole("link", { name: "host.episode.gate.login" })
          .classList.contains("bg-secondary")
      ).toBe(true);
    });

    it("Report a ticket state that could not be read", () => {
      render(
        <EpisodeAccessGate
          {...props}
          acceptsPayments
          waitFree={{ kind: "unavailable", message: "Could not connect." }}
        />
      );

      expect(screen.getByRole("status").textContent).toBe("Could not connect.");
      expect(ticketButton()).toBeNull();
    });
  });
});
