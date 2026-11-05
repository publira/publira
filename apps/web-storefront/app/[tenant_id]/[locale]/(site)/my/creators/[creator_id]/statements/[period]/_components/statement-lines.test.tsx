// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MyCreatorStatementLineItem } from "#lib/creator-pages";

import { StatementLines } from "./statement-lines";

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: string }) => <span>{message}</span>,
}));

const TIP_LABEL = "storefront.my_creator.tip";
const SUBSCRIPTION_LABEL = "storefront.my_creator.subscription";
const ADJUSTMENT_LABEL = "storefront.my_creator.adjustment";

const line = (
  overrides: Partial<MyCreatorStatementLineItem>
): MyCreatorStatementLineItem => ({
  adjustedPeriod: "",
  episodePublicId: "EPISODE00001",
  episodeTitle: "The Harbor",
  grossAmount: 300,
  lineNumber: 1,
  payoutAmount: 150,
  refundedAmount: 0,
  roleName: "Artist",
  saleCount: 2,
  seriesPublicId: "SERIES000001",
  seriesTitle: "Night Ferry",
  shareBps: 5000,
  source: "sale",
  ...overrides,
});

/** The body row at `index`, the header row being the table's first. */
const rowOf = (index: number) => screen.getAllByRole("row")[index + 1];

const renderLines = (lines: MyCreatorStatementLineItem[]) =>
  render(<StatementLines currency="JPY" lines={lines} locale="en" />);

afterEach(cleanup);

describe("StatementLines", () => {
  it("labels a line of tips as a tip, and a line of sales as nothing", () => {
    renderLines([
      line({ lineNumber: 1 }),
      line({ lineNumber: 2, source: "tip" }),
    ]);

    expect(within(rowOf(0)).queryByText(TIP_LABEL)).toBeNull();
    expect(within(rowOf(1)).getByText(TIP_LABEL)).toBeTruthy();
    expect(within(rowOf(1)).queryByText(SUBSCRIPTION_LABEL)).toBeNull();
  });

  it("labels an adjustment of a line of tips as a tip beside the month it adjusts", () => {
    renderLines([
      line({
        adjustedPeriod: "2025-11",
        grossAmount: -100,
        payoutAmount: -50,
        refundedAmount: -100,
        saleCount: -1,
        source: "tip",
      }),
    ]);

    expect(within(rowOf(0)).getByText(TIP_LABEL)).toBeTruthy();
    expect(within(rowOf(0)).getByText(ADJUSTMENT_LABEL)).toBeTruthy();
  });

  it("keeps a subscription line's own label", () => {
    renderLines([line({ source: "subscription" })]);

    expect(within(rowOf(0)).getByText(SUBSCRIPTION_LABEL)).toBeTruthy();
    expect(within(rowOf(0)).queryByText(TIP_LABEL)).toBeNull();
  });
});
