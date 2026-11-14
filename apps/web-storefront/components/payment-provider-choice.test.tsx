// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PaymentProviderOption } from "#lib/payment-providers";

import * as PaymentProviderChoice from "./payment-provider-choice";

vi.mock("#components/client-message", () => ({
  useClientMessages: () => (message: string) => message,
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const STRIPE: PaymentProviderOption = {
  displayName: "Stripe",
  id: "stripe",
  subscriptions: true,
};

const PAYJP: PaymentProviderOption = {
  displayName: "PAY.JP",
  id: "payjp",
  subscriptions: false,
};

const renderChoice = (
  providers: readonly PaymentProviderOption[],
  tenantId = "tenant-1"
) =>
  render(
    <PaymentProviderChoice.Root providers={providers} tenantId={tenantId}>
      <PaymentProviderChoice.Picker />
      <form aria-label="Buy">
        <PaymentProviderChoice.Input />
      </form>
      <form aria-label="Rent">
        <PaymentProviderChoice.Input />
      </form>
    </PaymentProviderChoice.Root>
  );

/** The provider each checkout form posts, in the order they render. */
const postedProviders = () =>
  [...document.querySelectorAll("form")].map(
    (form) =>
      form.querySelector<HTMLInputElement>('input[name="provider"]')?.value
  );

describe("PaymentProviderChoice", () => {
  it("offers each provider by name, with what the known ones take", () => {
    renderChoice([STRIPE, PAYJP]);

    expect(screen.getByText("storefront.payment_provider.label")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Stripe" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "PAY.JP" })).toBeTruthy();
    expect(
      screen.getByText("storefront.payment_provider.methods.stripe")
    ).toBeTruthy();
    expect(
      screen.getByText("storefront.payment_provider.methods.payjp")
    ).toBeTruthy();
  });

  it("names a provider this site does not know by its name alone", () => {
    renderChoice([
      STRIPE,
      { displayName: "Carrier billing", id: "carrier", subscriptions: false },
    ]);

    expect(
      screen
        .getByRole("radio", { name: "Carrier billing" })
        .getAttribute("aria-describedby")
    ).toBeNull();
  });

  it("starts every checkout on the tenant's first provider", () => {
    renderChoice([STRIPE, PAYJP]);

    expect(postedProviders()).toEqual(["stripe", "stripe"]);
  });

  it("sends every checkout on the page through the provider the reader picks", async () => {
    renderChoice([STRIPE, PAYJP]);

    fireEvent.click(screen.getByRole("radio", { name: "PAY.JP" }));

    await waitFor(() => {
      expect(postedProviders()).toEqual(["payjp", "payjp"]);
    });
  });

  it("starts the next purchase on the provider this browser picked last", async () => {
    const first = renderChoice([STRIPE, PAYJP]);
    fireEvent.click(screen.getByRole("radio", { name: "PAY.JP" }));
    first.unmount();

    renderChoice([STRIPE, PAYJP]);

    await waitFor(() => {
      expect(postedProviders()).toEqual(["payjp", "payjp"]);
    });
  });

  it("remembers the pick per tenant", async () => {
    const first = renderChoice([STRIPE, PAYJP], "tenant-1");
    fireEvent.click(screen.getByRole("radio", { name: "PAY.JP" }));
    first.unmount();

    renderChoice([STRIPE, PAYJP], "tenant-2");

    await waitFor(() => {
      expect(postedProviders()).toEqual(["stripe", "stripe"]);
    });
  });

  it("falls back to the first provider once the remembered one is gone", async () => {
    const first = renderChoice([STRIPE, PAYJP]);
    fireEvent.click(screen.getByRole("radio", { name: "PAY.JP" }));
    first.unmount();

    renderChoice([
      STRIPE,
      { displayName: "PayPay", id: "paypay", subscriptions: false },
    ]);

    await waitFor(() => {
      expect(postedProviders()).toEqual(["stripe", "stripe"]);
    });
  });

  it.each([
    ["one provider", [STRIPE]],
    ["no provider", []],
  ])(
    "asks nothing and posts no provider with %s",
    (_, providers: readonly PaymentProviderOption[]) => {
      renderChoice(providers);

      expect(screen.queryByRole("radio")).toBeNull();
      expect(
        screen.queryByText("storefront.payment_provider.label")
      ).toBeNull();
      expect(postedProviders()).toEqual([undefined, undefined]);
    }
  );
});
