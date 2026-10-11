// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { loadStorefrontClientMessages } from "#lib/messages";

import { ClientMessage } from "./client-message";
import { StorefrontMessagesContextProvider } from "./storefront-messages-context";

describe("ClientMessage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders from the catalog the provider carries", async () => {
    const messages = loadStorefrontClientMessages("en");

    await act(async () => {
      render(
        <Suspense fallback={null}>
          <StorefrontMessagesContextProvider messages={messages}>
            <ClientMessage message="storefront.common.retry" />
          </StorefrontMessagesContextProvider>
        </Suspense>
      );
      await messages;
    });

    expect(screen.getByText("Try again")).toBeDefined();
  });

  it("throws outside the provider", () => {
    expect(() =>
      render(<ClientMessage message="storefront.common.retry" />)
    ).toThrow("StorefrontMessagesProvider is required.");
  });
});

describe("loadStorefrontClientMessages", () => {
  it("carries the storefront namespace alone, with its locale", async () => {
    const messages = await loadStorefrontClientMessages("en");

    expect(Object.keys(messages.catalog)).toEqual(["storefront"]);
    expect(messages.locale).toBe("en");
  });
});
