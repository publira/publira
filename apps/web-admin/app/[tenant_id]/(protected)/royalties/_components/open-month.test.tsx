// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoyaltyLine } from "#lib/royalty-lines";

import { OpenMonth } from "./open-month";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

// The button carries a Server Action and is covered by its own test; here it
// only has to show what the confirmation will say.
vi.mock("./close-statement-button", () => ({
  CloseStatementButton: ({
    confirmDescription,
    confirmTitle,
    period,
  }: {
    confirmDescription: ReactNode;
    confirmTitle: ReactNode;
    period: string;
  }) => (
    <div data-period={period} data-testid="close-button">
      <p>{confirmTitle}</p>
      <p>{confirmDescription}</p>
    </div>
  ),
}));

const line = (
  lineNumber: number,
  creatorPublicId: string,
  creatorName: string,
  overrides: Partial<RoyaltyLine> = {}
): RoyaltyLine => ({
  creatorName,
  creatorPublicId,
  episodeTitle: "Episode 1",
  grossAmount: 5000,
  lineNumber,
  payoutAmount: 1500,
  refundedAmount: 0,
  roleName: "Artist",
  saleCount: 10,
  seriesTitle: "Series A",
  shareBps: 3000,
  ...overrides,
});

const lines = [
  line(1, "ARTIST", "Aki"),
  line(2, "WRITER", "Ben", {
    payoutAmount: 1000,
    roleName: "",
    shareBps: 2000,
  }),
  line(3, "ARTIST", "Aki", {
    episodeTitle: "Episode 2",
    grossAmount: 2000,
    payoutAmount: 450,
    refundedAmount: 500,
  }),
];

const totals = { gross: 7000, payout: 2950, refunded: 500 };

afterEach(() => {
  cleanup();
});

describe("OpenMonth", () => {
  it("states the month, the zone it is cut in, and its totals", () => {
    render(
      <OpenMonth
        closeState={{ kind: "ready" }}
        lines={lines}
        locale="en"
        period="2026-08"
        timeZone="Asia/Tokyo"
        totals={totals}
      />
    );

    expect(screen.getByText("Open month: August 2026")).toBeDefined();
    expect(
      screen.getByText(
        "Sales from Aug 1, 2026 to Aug 31, 2026, cut in the tenant's time zone (Asia/Tokyo). The figures keep changing until the month is closed."
      )
    ).toBeDefined();
    expect(screen.getByText("¥7,000")).toBeDefined();
    expect(screen.getByText("¥500", { selector: "dd" })).toBeDefined();
    expect(screen.getByText("¥2,950")).toBeDefined();
  });

  it("offers no download until the month is closed, and says why", () => {
    render(
      <OpenMonth
        closeState={{ kind: "ready" }}
        lines={lines}
        locale="en"
        period="2026-08"
        timeZone="Asia/Tokyo"
        totals={totals}
      />
    );

    expect(
      screen
        .getByRole("button", { name: "Download CSV" })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen.getByText("The CSV can be downloaded once the month is closed.")
    ).toBeDefined();
  });

  it("groups the lines by author with a subtotal each", () => {
    render(
      <OpenMonth
        closeState={{ kind: "ready" }}
        lines={lines}
        locale="en"
        period="2026-08"
        timeZone="UTC"
        totals={totals}
      />
    );

    const groups = screen.getAllByRole("rowgroup").slice(1);
    expect(groups).toHaveLength(2);

    const aki = within(groups[0]);
    expect(aki.getByRole("rowheader", { name: "Aki" })).toBeDefined();
    expect(aki.getByText("Episode 2")).toBeDefined();
    expect(aki.getByText("¥1,950")).toBeDefined();

    const ben = within(groups[1]);
    expect(ben.getByRole("rowheader", { name: "Ben" })).toBeDefined();
    expect(ben.getByText("20%")).toBeDefined();
    expect(ben.getByText("—")).toBeDefined();
  });

  it("asks to confirm the period and total payout of a month ready to close", () => {
    render(
      <OpenMonth
        closeState={{ kind: "ready" }}
        lines={lines}
        locale="en"
        period="2026-08"
        timeZone="UTC"
        totals={totals}
      />
    );

    const button = screen.getByTestId("close-button");
    expect(button.dataset.period).toBe("2026-08");
    expect(within(button).getByText("Close August 2026?")).toBeDefined();
    expect(
      within(button).getByText(
        "The payout to authors, ¥2,950 in total, will be fixed in a statement. A closed month cannot be reopened."
      )
    ).toBeDefined();
  });

  it("says when an automatic month closes and offers no close", () => {
    render(
      <OpenMonth
        closeState={{ closeDate: "2026-09-05", kind: "automatic" }}
        lines={lines}
        locale="en"
        period="2026-08"
        timeZone="UTC"
        totals={totals}
      />
    );

    expect(
      screen.getByText("This month closes automatically on Sep 5, 2026.")
    ).toBeDefined();
    expect(screen.queryByTestId("close-button")).toBeNull();
  });

  it("says when a running month can be closed and offers no close yet", () => {
    render(
      <OpenMonth
        closeState={{ kind: "in-progress", lastDay: "2026-09-30" }}
        lines={[]}
        locale="en"
        period="2026-09"
        timeZone="UTC"
        totals={{ gross: 0, payout: 0, refunded: 0 }}
      />
    );

    expect(
      screen.getByText(
        "This month is still in progress. It can be closed after Sep 30, 2026."
      )
    ).toBeDefined();
    expect(screen.queryByTestId("close-button")).toBeNull();
    expect(screen.getByText("No sales this month")).toBeDefined();
  });
});
