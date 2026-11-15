// @vitest-environment jsdom

import * as ActionForm from "@publira/ui-components/action-form";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StorefrontMessagesContextProvider } from "#components/storefront-messages-context";
import { loadStorefrontClientMessages } from "#lib/messages";

import type { BrowserCheckout } from "../_lib/browser-checkout";
import type { JsonObject, PaidyClosedData } from "../_lib/checkout-scripts";
import * as BrowserCheckoutForm from "./browser-checkout-form";

const { mockCompleteBrowserCheckoutAction, mockLeavePage } = vi.hoisted(() => ({
  mockCompleteBrowserCheckoutAction:
    vi.fn<(formData: FormData) => Promise<ActionForm.Result>>(),
  mockLeavePage: vi.fn(),
}));

vi.mock("../_lib/actions", () => ({
  completeBrowserCheckoutAction: mockCompleteBrowserCheckoutAction,
}));

vi.mock("../_lib/leave-page", () => ({ leavePage: mockLeavePage }));

vi.mock("next/script", () => ({ default: () => null }));

const checkoutId = "0123456789abcdef0123456789abcdef";

const checkout: BrowserCheckout = {
  cancelUrl: "https://comics.example.com/series/S1/episodes/E1?checkout=cancel",
  credentials: { public_key: "pk_test_0001" },
  payload: { amount: 300, currency: "JPY" },
  successUrl:
    "https://comics.example.com/series/S1/episodes/E1?checkout=success",
};

/**
 * A stand-in for paidy.js that closes its checkout with `callbackData` as soon
 * as it is launched, as the reader finishing in Paidy's checkout would.
 */
const fakePaidy = (callbackData: PaidyClosedData) => {
  const launches = vi.fn<(payload: JsonObject) => void>();

  window.Paidy = {
    configure: (config) => ({
      launch: (payload) => {
        launches(payload);
        config.closed(callbackData);
      },
    }),
  };

  return launches;
};

const renderForm = async () => {
  const messages = loadStorefrontClientMessages("en");

  await act(async () => {
    render(
      <Suspense fallback={null}>
        <StorefrontMessagesContextProvider messages={messages}>
          <BrowserCheckoutForm.Root
            checkout={checkout}
            checkoutId={checkoutId}
            providerId="paidy"
          >
            <input name="locale" type="hidden" value="en" />
            {[
              "familyName",
              "givenName",
              "postalCode",
              "prefecture",
              "city",
              "addressLine",
              "building",
            ].map((name) => (
              <input aria-label={name} key={name} name={name} />
            ))}
            <ActionForm.Submit>
              <BrowserCheckoutForm.Launch>Continue</BrowserCheckoutForm.Launch>
              <BrowserCheckoutForm.Retry>
                Confirm again
              </BrowserCheckoutForm.Retry>
            </ActionForm.Submit>
          </BrowserCheckoutForm.Root>
        </StorefrontMessagesContextProvider>
      </Suspense>
    );
    await messages;
  });
};

const fillIn = (values: Record<string, string> = {}) => {
  for (const [name, value] of Object.entries({
    addressLine: "1-2-3 Jingumae",
    city: "Shibuya-ku",
    familyName: "Yamada",
    givenName: "Taro",
    postalCode: "1500001",
    prefecture: "Tokyo",
    ...values,
  })) {
    fireEvent.change(screen.getByLabelText(name), { target: { value } });
  }
};

const press = async (name: string) => {
  await act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

/** The payment the form handed the server with each call. */
const handedOver = () =>
  mockCompleteBrowserCheckoutAction.mock.calls.map(([formData]) => ({
    checkoutId: formData.get("checkoutId"),
    paymentId: formData.get("paymentId"),
    provider: formData.get("provider"),
  }));

describe("BrowserCheckoutForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    delete window.Paidy;
  });

  it("hands the server the payment the script authorized and sends the reader to the success URL", async () => {
    const launches = fakePaidy({ id: "pay_0001", status: "authorized" });
    mockCompleteBrowserCheckoutAction.mockResolvedValueOnce({
      message: "",
      ok: true,
    });
    await renderForm();

    fillIn();
    await press("Continue");

    await waitFor(() => {
      expect(mockLeavePage).toHaveBeenCalledWith(checkout.successUrl);
    });
    expect(handedOver()).toStrictEqual([
      { checkoutId, paymentId: "pay_0001", provider: "paidy" },
    ]);
    expect(launches).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 300,
        buyer: { name1: "Yamada Taro" },
        shipping_address: expect.objectContaining({ zip: "150-0001" }),
      })
    );
  });

  it.each([
    ["closes", { status: "closed" }],
    ["rejects", { id: "pay_0001", status: "rejected" }],
  ])(
    "sends a reader whose checkout the script %s to the cancel URL and hands over nothing",
    async (_name, callbackData) => {
      fakePaidy(callbackData);
      await renderForm();

      fillIn();
      await press("Continue");

      await waitFor(() => {
        expect(mockLeavePage).toHaveBeenCalledWith(checkout.cancelUrl);
      });
      expect(mockCompleteBrowserCheckoutAction).not.toHaveBeenCalled();
    }
  );

  it("hands the same payment over again, without a second checkout, once the server could not take it", async () => {
    const launches = fakePaidy({ id: "pay_0001", status: "authorized" });
    mockCompleteBrowserCheckoutAction
      .mockResolvedValueOnce({ message: "Not yet.", ok: false })
      .mockResolvedValueOnce({ message: "", ok: true });
    await renderForm();

    fillIn();
    await press("Continue");

    expect(await screen.findByText("Not yet.")).toBeDefined();
    expect(mockLeavePage).not.toHaveBeenCalled();

    await press("Confirm again");

    await waitFor(() => {
      expect(mockLeavePage).toHaveBeenCalledWith(checkout.successUrl);
    });
    expect(launches).toHaveBeenCalledTimes(1);
    expect(handedOver()).toStrictEqual([
      { checkoutId, paymentId: "pay_0001", provider: "paidy" },
      { checkoutId, paymentId: "pay_0001", provider: "paidy" },
    ]);
  });

  it("opens no checkout for a postal code that is not seven digits", async () => {
    const launches = fakePaidy({ id: "pay_0001", status: "authorized" });
    await renderForm();

    fillIn({ postalCode: "150" });
    await press("Continue");

    expect(
      await screen.findByText(
        "Enter a postal code of seven digits, such as 123-4567."
      )
    ).toBeDefined();
    expect(launches).not.toHaveBeenCalled();
  });

  it("says so when the provider's script has not loaded", async () => {
    await renderForm();

    fillIn();
    await press("Continue");

    expect(
      await screen.findByText(
        "The payment screen could not be opened. Reload the page and try again."
      )
    ).toBeDefined();
    expect(mockLeavePage).not.toHaveBeenCalled();
  });
});
