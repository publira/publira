// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PurchaseItem } from "#lib/purchase";

import { ReaderPurchases } from "./reader-purchases";

vi.mock("#lib/messages", () => ({
  getMessagesFor: () =>
    Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a {...props} href={href}>
      {children}
    </a>
  ),
}));

const NOW = Temporal.Instant.from("2026-06-01T00:00:00Z");

const purchase = (overrides: Partial<PurchaseItem> = {}): PurchaseItem => ({
  currency: "JPY",
  expiresAt: "",
  id: "018f0e6a-5000-7000-8000-000000000001",
  item: { kind: "episode", publicId: "EPISODE001", title: "Episode 1" },
  price: 500,
  provider: "stripe",
  purchasedAt: "2026-03-01T12:00:00Z",
  readerEmail: "reader@example.com",
  readerName: "Reader",
  readerPublicId: "READER001",
  refundRequestedAmount: 0,
  refundable: true,
  refundedAmount: 0,
  refundedAt: "",
  revocationReason: "",
  revokedAt: "",
  seriesPublicId: "SERIES001",
  seriesTitle: "Series 1",
  store: "",
  test: false,
  ...overrides,
});

const renderPurchases = async (
  props: Partial<Parameters<typeof ReaderPurchases>[0]> = {}
) =>
  render(
    await ReaderPurchases({
      locale: "en",
      now: NOW,
      pageSize: 20,
      providerNames: new Map([["stripe", "Stripe"]]),
      purchases: [],
      timeZone: "UTC",
      ...props,
    })
  );

afterEach(() => {
  cleanup();
});

describe("ReaderPurchases", () => {
  it("lists each purchase with its episode and where it stands", async () => {
    await renderPurchases({
      purchases: [
        purchase(),
        purchase({
          id: "018f0e6a-5000-7000-8000-000000000002",
          item: { kind: "episode", publicId: "EPISODE002", title: "Episode 2" },
          refundedAmount: 500,
          refundedAt: "2026-03-02T00:00:00Z",
          revocationReason: "refund",
        }),
      ],
    });

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(
      within(rows[1]).getByRole("link", { name: "Episode 1" })
    ).toHaveProperty(
      "href",
      expect.stringMatching(/\/series\/SERIES001\/episodes\/EPISODE001$/u)
    );
    expect(rows[1].textContent).toContain("Stripe");
    expect(rows[1].textContent).toContain("Active");
    expect(rows[2].textContent).toContain("Refunded");
    expect(
      within(rows[1]).getByRole("link", {
        name: "View the purchase of Episode 1",
      })
    ).toHaveProperty(
      "href",
      expect.stringMatching(
        /\/purchases\?purchase=018f0e6a-5000-7000-8000-000000000001$/u
      )
    );
  });

  it("says the reader has bought nothing when the list is empty", async () => {
    await renderPurchases();

    expect(
      screen.getByText("This reader has not bought anything.")
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows the failure instead of an empty list or a pager", async () => {
    await renderPurchases({ listErrorMessage: "The API is down." });

    expect(
      screen.getByText("Could not display this reader's purchases")
    ).toBeTruthy();
    expect(screen.getByText("The API is down.")).toBeTruthy();
    expect(
      screen.queryByText("This reader has not bought anything.")
    ).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
