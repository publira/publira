// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const renderForm = (
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState> = () => Promise.resolve(null)
) =>
  render(
    <EpisodePricingForm
      action={action}
      episodeId="EP001-ID"
      episodePublicId="EP001"
      initialPrice={100}
      initialReadingPeriodHours={72}
      seriesPublicId="SERIES001"
      tenantId="TENANT001"
    />
  );

const priceInput = () =>
  screen.getByRole<HTMLInputElement>("spinbutton", { name: /^Price/u });

const readingPeriodInput = () =>
  screen.getByRole<HTMLInputElement>("spinbutton", {
    name: /^Reading period/u,
  });

afterEach(() => {
  cleanup();
});

describe("EpisodePricingForm", () => {
  it("opens on the price and reading period the episode is sold on", () => {
    renderForm();

    expect(priceInput().value).toBe("100");
    expect(readingPeriodInput().value).toBe("72");
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
    const action = vi.fn((_prevState: FormActionState, _formData: FormData) =>
      Promise.resolve(null)
    );
    renderForm(action);

    fireEvent.change(priceInput(), { target: { value: "0" } });
    fireEvent.change(readingPeriodInput(), { target: { value: "168" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Update price and reading period" })
    );

    await waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("price")).toBe("0");
    expect(formData?.get("reading_period_hours")).toBe("168");
    expect(formData?.get("episode_id")).toBe("EP001-ID");
    expect(formData?.get("episode_public_id")).toBe("EP001");
    expect(formData?.get("series_public_id")).toBe("SERIES001");
    expect(formData?.get("tenant_id")).toBe("TENANT001");
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
