// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { StorefrontMessageAccessor } from "#lib/messages";

import { PaidPrice } from "./paid-price";

afterEach(cleanup);

// SAFETY: the key is what these tests read, so the accessor answers it, with
// the code a message names appended.
const t = ((key: string, values?: { code?: string }) =>
  values?.code ? `${key} ${values.code}` : key) as StorefrontMessageAccessor;

describe("PaidPrice", () => {
  it("Writes the amount alone where no code discounted it", () => {
    const { container } = render(
      <PaidPrice
        currency="USD"
        listPrice={499}
        locale="en"
        price={499}
        promotionCode=""
        t={t}
      />
    );

    expect(container.textContent).toBe("$4.99");
    expect(container.querySelector("s")).toBeNull();
  });

  it("Strikes the price before the code through beside what was paid, and names the code", () => {
    const { container } = render(
      <PaidPrice
        currency="USD"
        listPrice={499}
        locale="en"
        price={399}
        promotionCode="SPRING10"
        t={t}
      />
    );

    expect(screen.getByText("$3.99")).toBeDefined();
    expect(container.querySelector("s")?.textContent).toBe(
      "storefront.promotion_code.list_price $4.99"
    );
    expect(
      screen.getByText("storefront.promotion_code.code SPRING10")
    ).toBeDefined();
  });

  it("Names no code for a discount taken on the provider's own page", () => {
    render(
      <PaidPrice
        currency="USD"
        listPrice={499}
        locale="en"
        price={399}
        promotionCode=""
        t={t}
      />
    );

    expect(screen.queryByText(/storefront\.promotion_code\.code/u)).toBeNull();
  });
});
