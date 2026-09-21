// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodePurchaseAvailabilityForm } from "./episode-purchase-availability-form";

const translate = bindMessages(sharedCatalog("en"));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => translate(message, values),
  useClientMessages: () => translate,
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => translate(message, values),
}));

const action = () => Promise.resolve(null);

const renderForm = (
  props: Pick<
    Parameters<typeof EpisodePurchaseAvailabilityForm>[0],
    "initialPurchaseAvailability" | "seriesPurchaseAvailability"
  >
) =>
  render(
    <EpisodePurchaseAvailabilityForm
      action={action}
      episodePublicId="EP001"
      seriesPublicId="SERIES001"
      tenantId="TENANT001"
      {...props}
    />
  );

/** What the form would post under one field name, in document order. */
const posted = (name: string) =>
  [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[type="hidden"][name="${name}"]`
    ),
  ].map((input) => input.value);

afterEach(() => {
  cleanup();
});

describe("EpisodePurchaseAvailabilityForm", () => {
  // An operator should not have to open the series, and then the settings, to
  // learn what following the series means for this episode.
  it("names what the episode follows where it overrides nothing", () => {
    renderForm({
      initialPurchaseAvailability: "",
      seriesPurchaseAvailability: "app",
    });

    expect(posted("purchase_availability")).toEqual([""]);
    expect(screen.getByRole("combobox", { name: "Sold on" }).textContent).toBe(
      "Follow the series (App only)"
    );
  });

  it("opens on where the episode states it is sold", () => {
    renderForm({
      initialPurchaseAvailability: "web",
      seriesPurchaseAvailability: "all",
    });

    expect(posted("purchase_availability")).toEqual(["web"]);
    expect(screen.getByRole("combobox", { name: "Sold on" }).textContent).toBe(
      "Web only"
    );
  });

  // A read that failed must not put a guessed value in its place.
  it("says only that it follows the series when that could not be read", () => {
    renderForm({ initialPurchaseAvailability: "" });

    expect(screen.getByRole("combobox", { name: "Sold on" }).textContent).toBe(
      "Follow the series"
    );
  });
});
