// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoyaltyStatementSummary } from "#lib/royalties";

import { StatementList } from "./statement-list";

vi.mock("#lib/messages", () => ({
  getMessagesFor: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

const statement = (
  period: string,
  closedByUserName: string
): RoyaltyStatementSummary => ({
  closedAt: "2026-09-02T01:30:00Z",
  closedByUserName,
  period,
  timeZone: "Asia/Tokyo",
  totals: { gross: 7000, payout: 2950, refunded: 500 },
});

afterEach(() => {
  cleanup();
});

describe("StatementList", () => {
  it("links each closed month to its statement with its totals", async () => {
    render(
      await StatementList({
        locale: "en",
        pageSize: 20,
        statements: [
          statement("2026-08", "Operator"),
          statement("2026-07", ""),
        ],
        timeZone: "UTC",
      })
    );

    const august = screen.getByRole("link", { name: "August 2026" });
    expect(august.getAttribute("href")).toBe("/royalties/statements/2026-08");
    expect(
      screen
        .getByRole("link", { name: "Download the CSV for August 2026" })
        .getAttribute("href")
    ).toBe("/api/royalties/statements/2026-08/csv");

    const [, first, second] = screen.getAllByRole("row");
    expect(within(first).getByText("Operator")).toBeDefined();
    expect(within(first).getByText("¥7,000")).toBeDefined();
    expect(within(first).getByText("¥500")).toBeDefined();
    expect(within(first).getByText("¥2,950")).toBeDefined();
    // Nobody is named for an automatic close or a deleted account.
    expect(within(second).getByText("—")).toBeDefined();
  });

  it("says no month has been closed when the first page is empty", async () => {
    render(
      await StatementList({
        locale: "en",
        pageSize: 20,
        statements: [],
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("No month has been closed yet")).toBeDefined();
    expect(screen.queryByLabelText("Closed statement pages")).toBeNull();
  });

  it("keeps the pager on an empty later page", async () => {
    render(
      await StatementList({
        locale: "en",
        pageSize: 20,
        previousHref: "?token=previous",
        statements: [],
        timeZone: "UTC",
      })
    );

    expect(
      screen.getByText("No statements to show on this page.")
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Previous" }).getAttribute("href")
    ).toBe("?token=previous");
  });

  it("replaces the list with the failure instead of an empty state", async () => {
    render(
      await StatementList({
        listErrorMessage: "Could not load royalties. Please try again later.",
        locale: "en",
        pageSize: 20,
        statements: [],
        timeZone: "UTC",
      })
    );

    expect(
      screen.getByText("Could not display closed statements")
    ).toBeDefined();
    expect(screen.queryByText("No month has been closed yet")).toBeNull();
  });
});
