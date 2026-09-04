// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnnouncementItem } from "../announcement-types";
import { AnnouncementManager } from "./announcement-manager";

vi.mock("#components/message", () => ({
  Message: ({ message, values }: { message: string; values?: MessageValues }) =>
    getMessage(sharedCatalog("en"), message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

const announcement = (id: string): AnnouncementItem => ({
  audienceType: "all",
  body: "Announcement body",
  createdAt: "2026-06-01T00:00:00Z",
  id,
  linkUrl: "/series/S001",
  targetUserName: "",
  targetUserPublicId: "",
  title: "Scheduled maintenance",
});

afterEach(() => {
  cleanup();
});

describe("AnnouncementManager", () => {
  it("says nothing is registered yet when the first page is empty", () => {
    render(
      <AnnouncementManager
        announcements={[]}
        locale="en"
        pageSize={20}
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("There are no announcements yet.")).toBeDefined();
    expect(screen.queryByLabelText("Announcements pagination")).toBeNull();
  });

  it("does not say the whole list is empty when a later page is empty", () => {
    render(
      <AnnouncementManager
        announcements={[]}
        locale="en"
        pageSize={20}
        previousHref="?token=previous"
        timeZone="Asia/Tokyo"
      />
    );

    expect(
      screen.getByText("No Announcements to show on this page.")
    ).toBeDefined();
    // The recovery links stay. Hiding them would leave no way back to the list.
    const previous = screen.getByRole("link", { name: "Previous" });
    expect(previous.getAttribute("href")).toBe("?token=previous");
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });

  it("renders the rows and the pager on a later page", () => {
    render(
      <AnnouncementManager
        nextHref="?token=next"
        announcements={[announcement("n1")]}
        locale="en"
        pageSize={20}
        previousHref="?token=previous"
        timeZone="Asia/Tokyo"
      />
    );

    expect(screen.getByText("Scheduled maintenance")).toBeDefined();
    // 2026-06-01T00:00:00Z is 09:00 the same calendar day in Asia/Tokyo.
    expect(screen.getByText("Jun 1, 2026, 9:00 AM")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Previous" }).getAttribute("href")
    ).toBe("?token=previous");
    expect(
      screen.getByRole("link", { name: "Next" }).getAttribute("href")
    ).toBe("?token=next");
  });

  it("shows only the error and does not call the list empty when the fetch fails", () => {
    render(
      <AnnouncementManager
        listErrorMessage="Could not load the announcements."
        nextHref="?token=next"
        announcements={[]}
        locale="en"
        pageSize={20}
        previousHref="?token=previous"
        timeZone="Asia/Tokyo"
      />
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

  it("shows the creation time as a wall clock in the tenant time zone", () => {
    render(
      <AnnouncementManager
        announcements={[announcement("n1")]}
        locale="en"
        pageSize={20}
        timeZone="America/Los_Angeles"
      />
    );

    // 2026-06-01T00:00:00Z is 17:00 the previous calendar day in PDT.
    expect(screen.getByText("May 31, 2026, 5:00 PM")).toBeDefined();
    expect(screen.queryByText("Jun 1, 2026, 9:00 AM")).toBeNull();
  });
});
