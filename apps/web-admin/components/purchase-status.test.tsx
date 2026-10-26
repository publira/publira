// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PurchasePaidThrough } from "./purchase-status";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const providerNames = new Map([["stripe", "Stripe"]]);

describe("PurchasePaidThrough", () => {
  afterEach(cleanup);

  it("names the provider a reader paid through", () => {
    render(
      <PurchasePaidThrough
        providerNames={providerNames}
        purchase={{ provider: "stripe", store: "" }}
      />
    );
    expect(screen.getByText("Stripe")).toBeDefined();
  });

  it("says a purchase was paid with coins rather than naming a provider", async () => {
    render(
      <PurchasePaidThrough
        providerNames={providerNames}
        purchase={{ provider: "coins", store: "" }}
      />
    );
    expect(await screen.findByText("Paid with coins")).toBeDefined();
  });
});
