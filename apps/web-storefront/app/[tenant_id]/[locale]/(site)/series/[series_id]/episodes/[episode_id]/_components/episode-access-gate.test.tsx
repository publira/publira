// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeAccessGate } from "./episode-access-gate";

// `<Message>` resolves the locale through `next/root-params`, which only the
// Next.js compiler can provide. The key it was handed is what this file is
// about, so rendering the key itself keeps the assertions readable; the values
// ride beside it, out of the accessible name, for the tests that read them.
vi.mock("#components/locale-context", () => ({
  useLocale: () => "ja",
  useTenantDefaultLocale: () => "ja",
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: string;
    values?: Record<string, unknown>;
  }) => <span data-values={JSON.stringify(values ?? {})}>{message}</span>,
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
    name: "storefront.episode.gate.wait_free_use",
  });

const buyButton = () =>
  screen.getByRole("button", { name: "storefront.episode.gate.purchase_for" });

const rentButton = () =>
  screen.getByRole("button", { name: "storefront.episode.gate.rent_for" });

/** The sale a checkout button's form sends. */
const kindOf = (button: HTMLElement) =>
  button.closest("form")?.querySelector<HTMLInputElement>('input[name="kind"]')
    ?.value;

/** The values the mocked `<Message>` was handed inside `button`. */
const valuesOf = (button: HTMLElement) =>
  JSON.parse(
    button.querySelector<HTMLElement>("[data-values]")?.dataset.values ?? "{}"
  );

const props = {
  appPayments: { appStore: false, googlePlay: false },
  currency: "USD",
  episodeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  episodePublicId: "EPISODE_001",
  locale: "en" as const,
  price: 499,
  purchaseSurface: "all" as const,
  rentalPeriodHours: 0,
  rentalPrice: 0,
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
        name: "storefront.episode.gate.purchase",
      })
    ).toBeNull();
    expect(
      screen.getByText(
        "storefront.episode.gate.signed_in_unpayable_description"
      )
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "storefront.episode.to_series_detail" })
    ).toBeDefined();
  });

  it("Show purchase CTA if payment settings are enabled", () => {
    render(<EpisodeAccessGate {...props} acceptsPayments />);

    expect(
      screen.getByRole("button", { name: "storefront.episode.gate.purchase" })
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
        screen.queryByRole("button", {
          name: "storefront.episode.gate.purchase",
        })
      ).toBeNull();
      expect(
        screen.getByText(
          "storefront.episode.gate.signed_in_app_only_description"
        )
      ).toBeDefined();
      expect(
        screen
          .getByRole("link", { name: "storefront.episode.gate.app_store" })
          .getAttribute("href")
      ).toBe("https://apps.apple.com/app/id123");
      expect(
        screen
          .getByRole("link", { name: "storefront.episode.gate.google_play" })
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
        screen.getByRole("link", { name: "storefront.episode.gate.app_store" })
      ).toBeDefined();
      expect(
        screen.queryByRole("link", {
          name: "storefront.episode.gate.google_play",
        })
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
        screen.queryByRole("button", {
          name: "storefront.episode.gate.purchase",
        })
      ).toBeNull();
      expect(
        screen.getByText(
          "storefront.episode.gate.signed_in_app_only_description"
        )
      ).toBeDefined();
      expect(
        screen.queryByRole("link", {
          name: "storefront.episode.gate.app_store",
        })
      ).toBeNull();
      expect(
        screen.queryByRole("link", {
          name: "storefront.episode.gate.google_play",
        })
      ).toBeNull();
    });

    it("Keep the sign-in link for a guest who may have bought it in the app", () => {
      render(<EpisodeAccessGate {...appOnly} signedIn={false} />);

      expect(
        screen.getByText("storefront.episode.gate.guest_app_only_description")
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: "storefront.episode.gate.login" })
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: "storefront.episode.gate.app_store" })
      ).toBeDefined();
    });

    it("Point to the app that sells through the stores without a web payment provider", () => {
      render(<EpisodeAccessGate {...appOnly} acceptsPayments={false} />);

      expect(
        screen.getByText(
          "storefront.episode.gate.signed_in_app_only_description"
        )
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: "storefront.episode.gate.app_store" })
      ).toBeDefined();
      expect(
        screen.getByRole("link", {
          name: "storefront.episode.gate.google_play",
        })
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
        screen.getByText(
          "storefront.episode.gate.signed_in_app_only_description"
        )
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: "storefront.episode.gate.app_store" })
      ).toBeDefined();
      expect(
        screen.queryByRole("link", {
          name: "storefront.episode.gate.google_play",
        })
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
        screen.getByText(
          "storefront.episode.gate.signed_in_unpayable_description"
        )
      ).toBeDefined();
      expect(
        screen.queryByRole("link", {
          name: "storefront.episode.gate.app_store",
        })
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
        screen.queryByRole("button", {
          name: "storefront.episode.gate.purchase",
        })
      ).toBeNull();
      expect(
        screen.getByText(
          "storefront.episode.gate.signed_in_unpayable_description"
        )
      ).toBeDefined();
      expect(
        screen.queryByRole("link", {
          name: "storefront.episode.gate.app_store",
        })
      ).toBeNull();
    });
  });

  describe("an episode sold on both while only the app can sell it", () => {
    const appSells = {
      ...props,
      acceptsPayments: false,
      appPayments: { appStore: true, googlePlay: false },
      appStoreUrl: "https://apps.apple.com/app/id123",
      googlePlayUrl: "https://play.google.com/store/apps/details?id=test",
    };

    it("Point to the app that sells it instead of saying nobody can", () => {
      render(<EpisodeAccessGate {...appSells} />);

      expect(
        screen.getByText(
          "storefront.episode.gate.signed_in_app_only_description"
        )
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: "storefront.episode.gate.app_store" })
      ).toBeDefined();
      expect(
        screen.queryByRole("link", {
          name: "storefront.episode.gate.google_play",
        })
      ).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "storefront.episode.gate.purchase",
        })
      ).toBeNull();
    });

    it("Offer the checkout instead once the site takes payments", () => {
      render(<EpisodeAccessGate {...appSells} acceptsPayments />);

      expect(
        screen.getByRole("button", { name: "storefront.episode.gate.purchase" })
      ).toBeDefined();
      expect(
        screen.queryByRole("link", {
          name: "storefront.episode.gate.app_store",
        })
      ).toBeNull();
    });
  });

  describe("an episode that is also rented", () => {
    const rented = {
      ...props,
      acceptsPayments: true,
      rentalPeriodHours: 48,
      rentalPrice: 199,
    };

    it("Offer the rental and the permanent copy, each sending its own kind", () => {
      render(<EpisodeAccessGate {...rented} />);

      expect(kindOf(buyButton())).toBe("purchase");
      expect(kindOf(rentButton())).toBe("rental");
      expect(
        screen.queryByRole("button", {
          name: "storefront.episode.gate.purchase",
        })
      ).toBeNull();
    });

    it("Name each sale's price and the rental's period", () => {
      render(<EpisodeAccessGate {...rented} />);

      expect(valuesOf(buyButton())).toEqual({ price: "$4.99" });
      expect(valuesOf(rentButton())).toEqual({
        period: "48 hours",
        price: "$1.99",
      });
    });

    it("Keep the Shu on the permanent copy, and give it to a ready ticket", () => {
      const { rerender } = render(<EpisodeAccessGate {...rented} />);

      expect(buyButton().classList.contains("bg-secondary")).toBe(true);
      expect(rentButton().classList.contains("bg-secondary")).toBe(false);

      rerender(
        <EpisodeAccessGate
          {...rented}
          waitFree={{ accessHours: 72, kind: "ready" }}
        />
      );

      expect(ticketButton()?.classList.contains("bg-secondary")).toBe(true);
      expect(buyButton().classList.contains("bg-secondary")).toBe(false);
      expect(rentButton().classList.contains("bg-secondary")).toBe(false);
    });

    it("Sell the permanent copy alone while no currency can quote the prices", () => {
      render(<EpisodeAccessGate {...rented} currency={null} />);

      const button = screen.getByRole("button", {
        name: "storefront.episode.gate.purchase",
      });
      expect(kindOf(button)).toBe("purchase");
      expect(
        screen.queryByRole("button", {
          name: "storefront.episode.gate.rent_for",
        })
      ).toBeNull();
    });
  });

  it("Send the permanent copy as the one sale of an episode that is not rented", () => {
    render(<EpisodeAccessGate {...props} acceptsPayments />);

    expect(
      kindOf(
        screen.getByRole("button", { name: "storefront.episode.gate.purchase" })
      )
    ).toBe("purchase");
  });

  it("Offer the checkout for an episode sold on the web alone", () => {
    render(
      <EpisodeAccessGate {...props} acceptsPayments purchaseSurface="web" />
    );

    expect(
      screen.getByRole("button", { name: "storefront.episode.gate.purchase" })
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
        name: "storefront.episode.gate.next_free_episode",
      });
      expect(link.getAttribute("href")).toBe(
        "/series/SERIES_001/episodes/EPISODE_004"
      );
      expect(link.classList.contains("bg-secondary")).toBe(false);
      expect(
        screen
          .getByRole("button", { name: "storefront.episode.gate.purchase" })
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
          name: "storefront.episode.gate.next_free_episode",
        })
      ).toBeDefined();
    });

    it("Leave the link out when no later episode is free", () => {
      render(<EpisodeAccessGate {...props} acceptsPayments />);

      expect(
        screen.queryByRole("link", {
          name: "storefront.episode.gate.next_free_episode",
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
        screen.getByText("storefront.episode.gate.wait_free_ready")
      ).toBeDefined();
      expect(ticketButton()?.classList.contains("bg-secondary")).toBe(true);
      expect(
        screen
          .getByRole("button", { name: "storefront.episode.gate.purchase" })
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
        screen.getByText("storefront.episode.gate.wait_free_recharging_in")
      ).toBeDefined();
      expect(ticketButton()).toBeNull();
      expect(
        screen
          .getByRole("button", { name: "storefront.episode.gate.purchase" })
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
          .getByRole("button", { name: "storefront.episode.gate.purchase" })
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
        screen.getByText("storefront.episode.gate.wait_free_excluded")
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
        screen.getByText("storefront.episode.gate.wait_free_guest")
      ).toBeDefined();
      expect(ticketButton()).toBeNull();
      expect(
        screen
          .getByRole("link", { name: "storefront.episode.gate.login" })
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
