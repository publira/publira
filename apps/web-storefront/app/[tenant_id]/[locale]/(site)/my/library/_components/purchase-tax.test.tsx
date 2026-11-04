// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PurchaseItem } from "#lib/purchases";

import { PurchaseTax } from "./purchase-tax";

afterEach(cleanup);

const t = bindMessages(sharedCatalog("en"), "en");

const purchase = (overrides: Partial<PurchaseItem> = {}): PurchaseItem => ({
  chargedByStore: false,
  currency: "JPY",
  expiresAt: "",
  id: "PURCHASE01",
  isActive: true,
  item: {
    kind: "episode",
    orderIndex: 3,
    publicId: "EPISODE001",
    title: "The Harbor",
  },
  kind: "purchase",
  listPrice: 1100,
  priceAtPurchase: 1100,
  promotionCode: "",
  purchasedAt: "2026-10-01T09:00:00Z",
  refundedAmount: 0,
  refundedAt: "",
  revokedAt: "",
  series: { publicId: "SERIES001", title: "Night Ferry" },
  ...overrides,
});

const issuer = {
  legalName: "Example Publishing",
  registrationNumber: "T1234567890123",
};

const renderTax = (
  item: PurchaseItem,
  invoice: { legalName?: string; registrationNumber?: string } = issuer
) =>
  render(
    <dl>
      <PurchaseTax issuer={invoice} locale="en" purchase={item} t={t} />
    </dl>
  );

/** The value the card states under `term`, or `null` where it states none. */
const definition = (term: string) =>
  screen.queryByText(term)?.nextElementSibling?.textContent ?? null;

describe("PurchaseTax", () => {
  it("states the tax a purchase includes, at its rate, and who charged it", () => {
    renderTax(purchase({ tax: { amount: 100, rateBps: 1000 } }));

    expect(definition("Tax included")).toBe("¥100 (10%)");
    expect(definition("Issued by")).toBe("Example Publishing");
    expect(definition("Registration number")).toBe("T1234567890123");
  });

  it("writes a rate that is not a whole percent with its decimals", () => {
    renderTax(purchase({ tax: { amount: 76, rateBps: 750 } }));

    expect(definition("Tax included")).toBe("¥76 (7.5%)");
  });

  it("leaves out a name or a number the tenant has not entered", () => {
    renderTax(purchase({ tax: { amount: 100, rateBps: 1000 } }), {
      registrationNumber: "T1234567890123",
    });

    expect(definition("Tax included")).toBe("¥100 (10%)");
    expect(screen.queryByText("Issued by")).toBeNull();
    expect(definition("Registration number")).toBe("T1234567890123");
  });

  it("names no tenant on a purchase the store charged, which issued its receipt", () => {
    renderTax(
      purchase({ chargedByStore: true, tax: { amount: 100, rateBps: 1000 } })
    );

    expect(definition("Tax included")).toBe("¥100 (10%)");
    expect(screen.queryByText("Issued by")).toBeNull();
    expect(screen.queryByText("Registration number")).toBeNull();
  });

  it("states nothing for a purchase that was charged no tax", () => {
    const { container } = renderTax(purchase());

    expect(container.querySelector("dl")?.childElementCount).toBe(0);
  });
});
