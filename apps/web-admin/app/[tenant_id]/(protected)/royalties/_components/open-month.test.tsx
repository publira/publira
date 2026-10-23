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
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

// The button carries a Server Action and is covered by its own test; here it
// only has to show what the confirmation will say, so the confirmation's slots
// render outside the dialog that would otherwise keep them closed.
vi.mock("./close-statement-button", () => ({
  CloseStatementButton: ({
    children,
    period,
  }: {
    children: ReactNode;
    period: string;
  }) => (
    <div data-period={period} data-testid="close-button">
      {children}
    </div>
  ),
}));

vi.mock("@publira/ui-components/confirm-dialog", () => ({
  Description: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Title: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

const line = (
  lineNumber: number,
  creatorPublicId: string,
  creatorName: string,
  overrides: Partial<RoyaltyLine> = {}
): RoyaltyLine => ({
  adjustedPeriod: "",
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

const totals = { adjustment: 0, gross: 7000, payout: 2950, refunded: 500 };

afterEach(() => {
  cleanup();
});

describe("OpenMonth", () => {
  it("states the month, the instants it counts sales between, and its totals", () => {
    render(
      <OpenMonth
        closeState={{ kind: "ready" }}
        endsAt="2026-08-31T15:00:00Z"
        lines={lines}
        currency="JPY"
        locale="en"
        period="2026-08"
        startsAt="2026-07-31T15:00:00Z"
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
        totals={totals}
      />
    );

    expect(screen.getByText("Open month: August 2026")).toBeDefined();
    expect(
      screen.getByText(
        "Sales from Aug 1, 2026, 12:00 AM up to Sep 1, 2026, 12:00 AM, in the tenant's time zone (Asia/Tokyo). The figures keep changing until the month is closed."
      )
    ).toBeDefined();
    expect(screen.getByText("¥7,000")).toBeDefined();
    expect(screen.getByText("¥500", { selector: "dd" })).toBeDefined();
    expect(screen.getByText("¥2,950")).toBeDefined();
  });

  it("states the totals in the tenant's currency, from its minor unit", () => {
    render(
      <OpenMonth
        closeState={{ kind: "ready" }}
        currency="USD"
        endsAt="2026-08-31T15:00:00Z"
        lines={lines}
        locale="en"
        period="2026-08"
        startsAt="2026-07-31T15:00:00Z"
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
        totals={totals}
      />
    );

    expect(screen.getByText("$70.00")).toBeDefined();
    expect(screen.getByText("$29.50")).toBeDefined();
  });

  it("states a start the closed month before it set in another zone", () => {
    // March was closed in Asia/Tokyo and the zone then changed to UTC, so
    // April starts where March ended rather than at its own UTC midnight.
    render(
      <OpenMonth
        closeState={{ kind: "ready" }}
        endsAt="2026-05-01T00:00:00Z"
        lines={lines}
        currency="JPY"
        locale="en"
        period="2026-04"
        startsAt="2026-03-31T15:00:00Z"
        tenantId="TENANT001"
        timeZone="UTC"
        totals={totals}
      />
    );

    expect(
      screen.getByText(
        "Sales from Mar 31, 2026, 3:00 PM up to May 1, 2026, 12:00 AM, in the tenant's time zone (UTC). The figures keep changing until the month is closed."
      )
    ).toBeDefined();
  });

  it("offers no download until the month is closed, and says why", () => {
    render(
      <OpenMonth
        closeState={{ kind: "ready" }}
        endsAt="2026-08-31T15:00:00Z"
        lines={lines}
        currency="JPY"
        locale="en"
        period="2026-08"
        startsAt="2026-07-31T15:00:00Z"
        tenantId="TENANT001"
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
        endsAt="2026-08-31T15:00:00Z"
        lines={lines}
        currency="JPY"
        locale="en"
        period="2026-08"
        startsAt="2026-07-31T15:00:00Z"
        tenantId="TENANT001"
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

  it("marks an adjustment with the month it takes refunds back from, and nets it into the subtotal", () => {
    render(
      <OpenMonth
        closeState={{ kind: "ready" }}
        endsAt="2026-08-31T15:00:00Z"
        lines={[
          line(1, "ARTIST", "Aki"),
          line(2, "ARTIST", "Aki", {
            adjustedPeriod: "2026-07",
            grossAmount: -500,
            payoutAmount: -150,
            saleCount: -1,
          }),
        ]}
        currency="JPY"
        locale="en"
        period="2026-08"
        startsAt="2026-07-31T15:00:00Z"
        tenantId="TENANT001"
        timeZone="UTC"
        totals={{ adjustment: -500, gross: 5000, payout: 1350, refunded: 0 }}
      />
    );

    expect(screen.getByText("-¥500", { selector: "dd" })).toBeDefined();
    const aki = within(screen.getAllByRole("rowgroup")[1]);
    const rows = aki.getAllByRole("row");
    expect(within(rows[1]).queryByText(/Refund adjustment/u)).toBeNull();
    expect(
      within(rows[2]).getByText("Refund adjustment for July 2026")
    ).toBeDefined();
    expect(within(rows[2]).getByText("-¥150")).toBeDefined();
    expect(aki.getByText("¥1,350")).toBeDefined();
  });

  it("asks to confirm the period and total payout of a month ready to close", () => {
    render(
      <OpenMonth
        closeState={{ kind: "ready" }}
        endsAt="2026-08-31T15:00:00Z"
        lines={lines}
        currency="JPY"
        locale="en"
        period="2026-08"
        startsAt="2026-07-31T15:00:00Z"
        tenantId="TENANT001"
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
        endsAt="2026-08-31T15:00:00Z"
        lines={lines}
        currency="JPY"
        locale="en"
        period="2026-08"
        startsAt="2026-07-31T15:00:00Z"
        tenantId="TENANT001"
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
        endsAt="2026-08-31T15:00:00Z"
        lines={[]}
        currency="JPY"
        locale="en"
        period="2026-09"
        startsAt="2026-07-31T15:00:00Z"
        tenantId="TENANT001"
        timeZone="UTC"
        totals={{ adjustment: 0, gross: 0, payout: 0, refunded: 0 }}
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
