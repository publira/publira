// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnnouncementItem } from "../announcement-types";
import { AnnouncementManager } from "./announcement-manager";

vi.mock("#lib/messages", () => ({
  getMessagesFor: () =>
    Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
  loadAdminMessages: () => Promise.resolve(sharedCatalog("en")),
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en"), "en"),
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
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

const announcement = (id: string): AnnouncementItem => ({
  audience: null,
  body: "Announcement body",
  createdAt: "2026-06-01T00:00:00Z",
  deliverAt: "2026-06-01T00:00:00Z",
  deliveredAt: "2026-06-01T00:00:00Z",
  deliveredCount: 3n,
  delivery: "preferred",
  id,
  linkUrl: "/series/S001",
  openedCount: 1n,
  pinned: false,
  pinnedUntil: "",
  title: "Scheduled maintenance",
  translatedLocales: ["en"],
  translations: [
    { body: "Announcement body", locale: "en", title: "Scheduled maintenance" },
  ],
});

/** The text of every cell of `row`, in column order. */
const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map(({ textContent }) => textContent);

afterEach(() => {
  cleanup();
});

describe("AnnouncementManager", () => {
  it("says nothing is registered yet when the first page is empty", async () => {
    render(
      await AnnouncementManager({
        announcements: [],
        canEdit: true,
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("There are no announcements yet.")).toBeDefined();
    expect(screen.queryByLabelText("Announcements pagination")).toBeNull();
  });

  it("does not say the whole list is empty when a later page is empty", async () => {
    render(
      await AnnouncementManager({
        announcements: [],
        canEdit: true,
        locale: "en",
        pageSize: 20,
        previousHref: "?token=previous",
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(
      screen.getByText("No Announcements to show on this page.")
    ).toBeDefined();
    // The recovery links stay. Hiding them would leave no way back to the list.
    const previous = screen.getByRole("link", { name: "Previous" });
    expect(previous.getAttribute("href")).toBe("?token=previous");
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });

  it("renders the rows and the pager on a later page", async () => {
    render(
      await AnnouncementManager({
        announcements: [announcement("n1")],
        canEdit: true,
        locale: "en",
        nextHref: "?token=next",
        pageSize: 20,
        previousHref: "?token=previous",
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("Scheduled maintenance")).toBeDefined();
    // 2026-06-01T00:00:00Z is 09:00 the same calendar day in UTC.
    expect(screen.getByText("Jun 1, 2026, 12:00 AM")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Previous" }).getAttribute("href")
    ).toBe("?token=previous");
    expect(
      screen.getByRole("link", { name: "Next" }).getAttribute("href")
    ).toBe("?token=next");
  });

  it("shows the default language's title and every language the announcement is written in", async () => {
    render(
      await AnnouncementManager({
        announcements: [
          { ...announcement("n1"), translatedLocales: ["en", "ja"] },
        ],
        canEdit: true,
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    const [, row] = screen.getAllByRole("row");
    const cells = within(row).getAllByRole("cell");
    expect(cells[1]?.textContent).toBe("Scheduled maintenance");
    expect(
      within(cells[2])
        .getAllByRole("listitem")
        .map((item) => [item.getAttribute("lang"), item.textContent])
    ).toEqual([
      ["en", "English"],
      ["ja", "日本語"],
    ]);
  });

  it("shows only the error and does not call the list empty when the fetch fails", async () => {
    render(
      await AnnouncementManager({
        announcements: [],
        canEdit: true,
        listErrorMessage: "Could not load the announcements.",
        locale: "en",
        nextHref: "?token=next",
        pageSize: 20,
        previousHref: "?token=previous",
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    // A failed read is a failed section, so it is reported the way every other
    // screen reports one: `SectionError`, with role="alert" and a title naming
    // the list that is missing.
    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "Could not display the announcements"
    );
    expect(sectionError.textContent).toContain(
      "Could not load the announcements."
    );
    expect(screen.queryByText("There are no announcements yet.")).toBeNull();
    expect(
      screen.queryByText("No Announcements to show on this page.")
    ).toBeNull();
    expect(screen.queryByLabelText("Announcements pagination")).toBeNull();
  });

  it("shows the creation time as a wall clock in the tenant time zone", async () => {
    render(
      await AnnouncementManager({
        announcements: [announcement("n1")],
        canEdit: true,
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "America/Los_Angeles",
      })
    );

    // 2026-06-01T00:00:00Z is 17:00 the previous calendar day in PDT.
    expect(screen.getByText("May 31, 2026, 5:00 PM")).toBeDefined();
    expect(screen.queryByText("Jun 1, 2026, 12:00 AM")).toBeNull();
  });

  it("shows which announcements were sent to everyone", async () => {
    render(
      await AnnouncementManager({
        announcements: [
          { ...announcement("n1"), delivery: "everyone" },
          announcement("n2"),
        ],
        canEdit: true,
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    const [, everyone, preferred] = screen.getAllByRole("row");
    expect(within(everyone).getByText("Sent to everyone")).toBeDefined();
    expect(within(preferred).getByText("As each reader allows")).toBeDefined();
  });

  it.each([
    [true, 1],
    [false, 0],
  ])(
    "offers to take a banner down when the operator may edit: %s",
    async (canEdit, count) => {
      render(
        await AnnouncementManager({
          announcements: [
            {
              ...announcement("n1"),
              pinned: true,
              pinnedUntil: "2026-07-01T00:00:00Z",
            },
          ],
          canEdit,
          locale: "en",
          pageSize: 20,
          tenantId: "TENANT001",
          timeZone: "UTC",
        })
      );

      expect(
        screen.queryAllByRole("button", { name: "Stop showing" })
      ).toHaveLength(count);
    }
  );

  it("names who each announcement is for", async () => {
    render(
      await AnnouncementManager({
        announcements: [
          announcement("n1"),
          {
            ...announcement("n2"),
            audience: [
              { seriesPublicId: "SERIES001", type: "follows_series" },
              { locale: "en", type: "locale" },
            ],
          },
          { ...announcement("n3"), audience: [{ type: "never_purchased" }] },
        ],
        canEdit: true,
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    const [, everyone, two, one] = screen.getAllByRole("row");
    expect(within(everyone).getByText("Everyone")).toBeDefined();
    expect(within(two).getByText("2 conditions")).toBeDefined();
    expect(within(one).getByText("1 condition")).toBeDefined();
  });

  it.each([
    [true, 1],
    [false, 0],
  ])(
    "says when a scheduled announcement goes out, and offers to edit it when the operator may: %s",
    async (canEdit, count) => {
      render(
        await AnnouncementManager({
          announcements: [
            {
              ...announcement("018f0f90-0001-7000-8000-000000000101"),
              deliverAt: "2026-07-01T09:00:00Z",
              deliveredAt: "",
            },
            announcement("n2"),
          ],
          canEdit,
          locale: "en",
          pageSize: 20,
          tenantId: "TENANT001",
          timeZone: "UTC",
        })
      );

      const [, scheduled, delivered] = screen.getAllByRole("row");
      expect(
        within(scheduled).getByText("Scheduled for Jul 1, 2026, 9:00 AM")
      ).toBeDefined();
      expect(
        within(delivered).getByText("Delivered Jun 1, 2026, 12:00 AM")
      ).toBeDefined();

      const edit = screen.queryAllByRole("link", { name: "Edit" });
      expect(edit).toHaveLength(count);
      expect(edit[0]?.getAttribute("href") ?? null).toBe(
        count
          ? "/announcements/018f0f90-0001-7000-8000-000000000101/edit"
          : null
      );
      // One that has gone out is edited no more.
      expect(
        within(delivered).queryByRole("link", { name: "Edit" })
      ).toBeNull();
    }
  );

  it("counts the readers a delivered announcement reached and those who opened it, and neither while it is scheduled", async () => {
    render(
      await AnnouncementManager({
        announcements: [
          { ...announcement("n1"), deliveredCount: 1200n, openedCount: 37n },
          {
            ...announcement("n2"),
            deliverAt: "2026-07-01T09:00:00Z",
            deliveredAt: "",
            deliveredCount: 0n,
            openedCount: 0n,
          },
        ],
        canEdit: true,
        locale: "en",
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    const headers = screen
      .getAllByRole("columnheader")
      .map(({ textContent }) => textContent);

    const delivered = headers.indexOf("Delivered");
    const opened = headers.indexOf("Opened");
    const [, sent, scheduled] = screen.getAllByRole("row");

    expect([cellsOf(sent)[delivered], cellsOf(sent)[opened]]).toEqual([
      "1,200",
      "37",
    ]);
    expect([cellsOf(scheduled)[delivered], cellsOf(scheduled)[opened]]).toEqual(
      ["—", "—"]
    );
  });
});
