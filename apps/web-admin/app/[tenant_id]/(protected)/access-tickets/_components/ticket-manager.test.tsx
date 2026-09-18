// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccessTicketItem } from "../ticket-types";
import { TicketManager } from "./ticket-manager";

vi.mock("#lib/messages", () => ({
  getMessagesFor: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
  loadAdminMessages: () => Promise.resolve(sharedCatalog("en")),
}));

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en")),
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

// The revoke button is a client component carrying a Server Action and
// useRouter, so all that is checked here is that the list renders one per row.
vi.mock("./revoke-ticket-button", () => ({
  RevokeTicketButton: ({ publicId }: { publicId: string }) => (
    <button type="button">{`Revoke ${publicId}`}</button>
  ),
}));

const ticket = (publicId: string): AccessTicketItem => ({
  createdAt: "2026-06-01T00:00:00Z",
  episodePublicId: "EPISODE001",
  episodeTitle: "Episode 1",
  expiresAt: "",
  note: "",
  publicId,
  revokedAt: "",
  seriesPublicId: "SERIES001",
  seriesTitle: "Series A",
  status: "active",
  userEmail: "reader@example.com",
  userName: "Reader",
  userPublicId: "USER001",
});

afterEach(() => {
  cleanup();
});

describe("TicketManager", () => {
  it("says nothing is registered yet when the first page is empty", async () => {
    render(
      await TicketManager({
        locale: "en",
        pageSize: 20,
        tickets: [],
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("There are no tickets yet.")).toBeDefined();
    expect(screen.queryByLabelText("Access tickets pagination")).toBeNull();
  });

  it("does not say the whole list is empty when a later page is empty", async () => {
    render(
      await TicketManager({
        locale: "en",
        pageSize: 20,
        previousHref: "?token=previous",
        tickets: [],
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("No tickets to show on this page.")).toBeDefined();
    // The recovery links stay. Hiding them would leave no way back to the list.
    const previous = screen.getByRole("link", { name: "Previous" });
    expect(previous.getAttribute("href")).toBe("?token=previous");
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });

  it("lists the status and the note of an active ticket", async () => {
    render(
      await TicketManager({
        locale: "en",
        pageSize: 20,
        tickets: [
          {
            ...ticket("TICKET001"),
            note: "For review",
            status: "active",
          },
        ],
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("Active")).toBeDefined();
    expect(screen.getByText("For review")).toBeDefined();
    expect(screen.getByText("Revoke TICKET001")).toBeDefined();
  });

  it("renders the per-row actions and the pager on a later page", async () => {
    render(
      await TicketManager({
        locale: "en",
        nextHref: "?token=next",
        pageSize: 20,
        previousHref: "?token=previous",
        tickets: [ticket("TICKET001")],
        timeZone: "UTC",
      })
    );

    expect(screen.getByText("Revoke TICKET001")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Previous" }).getAttribute("href")
    ).toBe("?token=previous");
    expect(
      screen.getByRole("link", { name: "Next" }).getAttribute("href")
    ).toBe("?token=next");
  });

  it("shows only the error and does not call the list empty when the fetch fails", async () => {
    render(
      await TicketManager({
        listErrorMessage: "Could not load the tickets.",
        locale: "en",
        nextHref: "?token=next",
        pageSize: 20,
        previousHref: "?token=previous",
        tickets: [],
        timeZone: "UTC",
      })
    );

    // A failed read is a failed section, so it is reported the way every other
    // screen reports one: `SectionError`, with role="alert" and a title naming
    // the list that is missing.
    const sectionError = screen.getByRole("alert");
    expect(sectionError.textContent).toContain(
      "Could not display the access tickets"
    );
    expect(sectionError.textContent).toContain("Could not load the tickets.");
    expect(screen.queryByText("There are no tickets yet.")).toBeNull();
    expect(screen.queryByText("No tickets to show on this page.")).toBeNull();
    expect(screen.queryByLabelText("Access tickets pagination")).toBeNull();
  });
});
