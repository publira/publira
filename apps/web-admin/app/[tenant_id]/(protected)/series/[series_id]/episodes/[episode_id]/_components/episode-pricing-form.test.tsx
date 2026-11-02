// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type * as ActionForm from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { EpisodePricingForm } from "./episode-pricing-form";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const NOT_RENTED = { initialRentalPeriodHours: 0, initialRentalPrice: 0 };

interface RenderOptions {
  initialPreviewPageCount?: number;
  initialPrice?: number;
  pageCount?: number;
}

const renderForm = (
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State> = () => Promise.resolve(null),
  currency = "JPY",
  rental: {
    initialRentalPrice: number;
    initialRentalPeriodHours: number;
  } = NOT_RENTED,
  {
    initialPreviewPageCount = 0,
    initialPrice = 100,
    pageCount = 8,
  }: RenderOptions = {}
) =>
  render(
    <AdminLocaleTestProvider locale="en">
      <EpisodePricingForm
        action={action}
        currency={currency}
        episodeId="EP001-ID"
        episodePublicId="EP001"
        initialPreviewPageCount={initialPreviewPageCount}
        initialPrice={initialPrice}
        initialReadingPeriodHours={72}
        initialRentalPeriodHours={rental.initialRentalPeriodHours}
        initialRentalPrice={rental.initialRentalPrice}
        pageCount={pageCount}
        seriesPublicId="SERIES001"
        tenantId="TENANT001"
      />
    </AdminLocaleTestProvider>
  );

const priceInput = () =>
  screen.getByRole<HTMLInputElement>("spinbutton", { name: /^Price/u });

const readingPeriodInput = () =>
  screen.getByRole<HTMLInputElement>("spinbutton", {
    name: /^Reading period/u,
  });

const rentalPriceInput = () =>
  screen.getByRole<HTMLInputElement>("spinbutton", { name: /^Rental price/u });

const previewPagesInput = () =>
  screen.getByRole<HTMLInputElement>("spinbutton", { name: /^Preview pages/u });

const rentalPeriodInput = () =>
  screen.getByRole<HTMLInputElement>("spinbutton", {
    name: /^Rental period/u,
  });

afterEach(() => {
  cleanup();
});

describe("EpisodePricingForm", () => {
  it("enters the price in the tenant's currency, with its decimal places", () => {
    renderForm(undefined, "USD");

    expect(priceInput().value).toBe("1.00");
    expect(priceInput().step).toBe("0.01");
    expect(screen.getByText(/^In USD\./u)).toBeDefined();
  });

  it("opens on the price and reading period the episode is sold on", () => {
    renderForm();

    expect(priceInput().value).toBe("100");
    expect(readingPeriodInput().value).toBe("72");
  });

  it("leaves the rental price blank on an episode that is not rented", () => {
    renderForm(undefined, "JPY", {
      initialRentalPeriodHours: 24,
      initialRentalPrice: 0,
    });

    expect(rentalPriceInput().value).toBe("");
    expect(rentalPriceInput().required).toBe(false);
    // The period the page offers, the series', is there for a price to use.
    expect(rentalPeriodInput().value).toBe("24");
    expect(rentalPeriodInput().required).toBe(false);
  });

  it("opens on the rental the episode is sold on, in the tenant's currency", () => {
    renderForm(undefined, "USD", {
      initialRentalPeriodHours: 48,
      initialRentalPrice: 50,
    });

    expect(rentalPriceInput().value).toBe("0.50");
    expect(rentalPriceInput().step).toBe("0.01");
    expect(rentalPeriodInput().value).toBe("48");
  });

  it("says that purchases already made keep their price and expiry", () => {
    renderForm();

    expect(
      screen.getByText(
        /a purchase already made keeps the price it was paid and the time it expires/u
      )
    ).toBeTruthy();
  });

  it("sends the new values with the episode they belong to", async () => {
    const action = vi.fn((_prevState: ActionForm.State, _formData: FormData) =>
      Promise.resolve(null)
    );

    renderForm(action);

    fireEvent.change(priceInput(), { target: { value: "0" } });
    fireEvent.change(readingPeriodInput(), { target: { value: "168" } });
    fireEvent.change(rentalPriceInput(), { target: { value: "50" } });
    fireEvent.change(rentalPeriodInput(), { target: { value: "24" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Update price and reading period" })
    );

    await waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("price")).toBe("0");
    expect(formData?.get("reading_period_hours")).toBe("168");
    expect(formData?.get("rental_price")).toBe("50");
    expect(formData?.get("rental_period_hours")).toBe("24");
    // A free episode opens its whole body, so it sends no preview.
    expect(formData?.get("preview_page_count")).toBe("0");
    expect(formData?.get("episode_id")).toBe("EP001-ID");
    expect(formData?.get("episode_public_id")).toBe("EP001");
    expect(formData?.get("series_public_id")).toBe("SERIES001");
    expect(formData?.get("tenant_id")).toBe("TENANT001");
  });

  it("opens on the preview pages a priced episode is sold with", () => {
    renderForm(undefined, "JPY", NOT_RENTED, { initialPreviewPageCount: 3 });

    expect(previewPagesInput().value).toBe("3");
    expect(previewPagesInput().min).toBe("0");
  });

  it("sends the preview pages a priced episode opens", async () => {
    const action = vi.fn((_prevState: ActionForm.State, _formData: FormData) =>
      Promise.resolve(null)
    );

    renderForm(action);

    fireEvent.change(previewPagesInput(), { target: { value: "3" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Update price and reading period" })
    );

    await waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    expect(action.mock.calls[0]?.[1].get("preview_page_count")).toBe("3");
  });

  it("asks for no preview on a free episode", () => {
    renderForm(undefined, "JPY", NOT_RENTED, {
      initialPreviewPageCount: 3,
      initialPrice: 0,
    });

    expect(
      screen.queryByRole("spinbutton", { name: /^Preview pages/u })
    ).toBeNull();
    expect(
      screen.getByText(
        "A free episode opens all its pages, so it needs no preview pages."
      )
    ).toBeTruthy();
  });

  it("hides the preview pages once the price is lowered to 0, and offers them again once it is raised", () => {
    renderForm(undefined, "JPY", NOT_RENTED, { initialPreviewPageCount: 3 });

    fireEvent.change(priceInput(), { target: { value: "0" } });

    expect(
      screen.queryByRole("spinbutton", { name: /^Preview pages/u })
    ).toBeNull();

    fireEvent.change(priceInput(), { target: { value: "120" } });

    expect(previewPagesInput().value).toBe("3");
  });

  it("notes that only the pages the episode has open when the count is past them", () => {
    renderForm(undefined, "JPY", NOT_RENTED, { pageCount: 2 });

    const note =
      "The episode has 2 pages now, so only those open until more are added.";

    expect(screen.queryByText(note)).toBeNull();

    fireEvent.change(previewPagesInput(), { target: { value: "5" } });

    expect(screen.getByText(note)).toBeTruthy();
  });

  it("refuses a negative count in words that name the field", () => {
    renderForm();

    fireEvent.change(previewPagesInput(), { target: { value: "-1" } });

    expect(previewPagesInput().validationMessage).toBe(
      "Preview pages must be a whole number, 0 or more."
    );

    fireEvent.change(previewPagesInput(), { target: { value: "2" } });

    expect(previewPagesInput().validity.customError).toBe(false);
  });

  it("shows the refusal the Action returned", async () => {
    renderForm(() =>
      Promise.resolve({
        message: "Price must be a non-negative integer.",
        ok: false,
      })
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Update price and reading period" })
    );

    expect(
      await screen.findByText("Price must be a non-negative integer.")
    ).toBeTruthy();
  });
});
