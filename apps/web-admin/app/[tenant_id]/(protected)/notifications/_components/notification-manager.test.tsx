// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NotificationItem } from "../notification-types";
import { NotificationManager } from "./notification-manager";

vi.mock("#components/message", () => ({
  Message: ({ message, values }: { message: string; values?: MessageValues }) =>
    getMessage(sharedCatalog("en"), message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("./notification-read-actions", () => ({
  MarkAllNotificationsAsReadButton: ({ tenantId }: { tenantId: string }) => (
    <button type="button">Mark all as read {tenantId}</button>
  ),
  MarkNotificationAsReadButton: ({
    notificationId,
  }: {
    notificationId: string;
    label: string;
  }) => <button type="button">Mark as read {notificationId}</button>,
}));

const notification = (
  id: string,
  overrides: Partial<NotificationItem> = {}
): NotificationItem => ({
  createdAt: "2026-06-01T00:00:00Z",
  description: "“Episode 1” (Series A) was published.",
  href: "/series/SR01/episodes/EP01",
  id,
  isRead: false,
  notificationType: "episode_published",
  title: "An episode was published",
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("NotificationManager", () => {
  it("says nothing has arrived when the first page is empty", () => {
    render(
      <NotificationManager
        locale="en"
        notifications={[]}
        pageSize={20}
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
        unreadCount={0}
      />
    );

    expect(screen.getByText("You have no notifications yet.")).toBeDefined();
    expect(screen.queryByLabelText("Notifications pagination")).toBeNull();
    expect(screen.queryByText("Mark all as read TENANT001")).toBeNull();
  });

  it("does not say the whole list is empty when a later page is empty", () => {
    render(
      <NotificationManager
        locale="en"
        notifications={[]}
        pageSize={20}
        previousHref="?token=previous"
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
        unreadCount={0}
      />
    );

    expect(
      screen.getByText("No Notifications to show on this page.")
    ).toBeDefined();
    const previous = screen.getByRole("link", { name: "Previous" });
    expect(previous.getAttribute("href")).toBe("?token=previous");
  });

  it("renders the unread row, its link and the mark-as-read button", () => {
    render(
      <NotificationManager
        locale="en"
        nextHref="?token=next"
        notifications={[
          notification("n1"),
          notification("n2", {
            createdAt: "2026-05-31T00:00:00Z",
            href: undefined,
            isRead: true,
            title: "A notification",
          }),
        ]}
        pageSize={20}
        previousHref="?token=previous"
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
        unreadCount={1}
      />
    );

    const titleLink = screen.getByRole("link", {
      name: "An episode was published",
    });
    expect(titleLink.getAttribute("href")).toBe("/series/SR01/episodes/EP01");
    expect(screen.getByText("Jun 1, 2026, 9:00 AM")).toBeDefined();
    expect(screen.getByText("Unread")).toBeDefined();
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("Mark as read n1")).toBeDefined();
    expect(screen.queryByText("Mark as read n2")).toBeNull();
    expect(screen.getByText("Mark all as read TENANT001")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Previous" }).getAttribute("href")
    ).toBe("?token=previous");
    expect(
      screen.getByRole("link", { name: "Next" }).getAttribute("href")
    ).toBe("?token=next");
  });

  it("shows only the error and does not call the list empty when the fetch fails", () => {
    render(
      <NotificationManager
        listErrorMessage="Could not load the notifications."
        locale="en"
        nextHref="?token=next"
        notifications={[]}
        pageSize={20}
        previousHref="?token=previous"
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
        unreadCount={2}
      />
    );

    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "Could not display notifications"
    );
    expect(sectionError.textContent).toContain(
      "Could not load the notifications."
    );
    expect(screen.queryByText("You have no notifications yet.")).toBeNull();
    expect(screen.queryByLabelText("Notifications pagination")).toBeNull();
    expect(screen.queryByText("Mark all as read TENANT001")).toBeNull();
  });

  // The `ja` mirror of the assertions above. The component resolves every
  // string from the `locale` it is handed, so without this case one that
  // ignored the prop and always read the `en` catalog would still pass.
  it("renders its copy in the locale the protected layout resolved, so locale=ja is Japanese", () => {
    render(
      <NotificationManager
        locale="ja"
        notifications={[notification("n1")]}
        pageSize={20}
        tenantId="TENANT001"
        timeZone="Asia/Tokyo"
        unreadCount={1}
      />
    );

    expect(screen.getByText("通知一覧")).toBeDefined();
    expect(screen.getByText("未読")).toBeDefined();
    expect(screen.queryByText("Notifications")).toBeNull();
  });

  it("shows the creation time as a wall clock in the tenant time zone", () => {
    render(
      <NotificationManager
        locale="en"
        notifications={[notification("n1")]}
        pageSize={20}
        tenantId="TENANT001"
        timeZone="America/Los_Angeles"
        unreadCount={1}
      />
    );

    expect(screen.getByText("May 31, 2026, 5:00 PM")).toBeDefined();
    expect(screen.queryByText("Jun 1, 2026, 9:00 AM")).toBeNull();
  });
});
