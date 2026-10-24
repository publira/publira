// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccessTicketItem } from "#lib/access-ticket";

import { ReaderTickets } from "./reader-tickets";

vi.mock("#lib/messages", () => ({
  getMessagesFor: () =>
    Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
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

vi.mock("#lib/access-ticket-actions", () => ({
  issueAccessTicketInPlaceAction: vi.fn(),
}));

// The revoke button and the issue form carry Server Actions, so all that is
// checked here is which ticket each one is for.
vi.mock("#components/revoke-access-ticket-button", () => ({
  RevokeTicketButton: ({ ticketId }: { ticketId: string }) => (
    <button type="button">{`Revoke ${ticketId}`}</button>
  ),
}));

vi.mock("#components/access-ticket-form", () => ({
  TicketForm: ({ readerId }: { readerId?: string }) => (
    <form aria-label={`Issue to ${readerId}`} />
  ),
}));

vi.mock("./issue-ticket-dialog", () => ({
  Body: ({ children }: { children: React.ReactNode }) => children,
  CloseOnIssued: () => null,
  Popup: ({ children }: { children: React.ReactNode }) => children,
  Root: ({ children }: { children: React.ReactNode }) => children,
  Trigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("@publira/ui-components/dialog", () => ({
  Description: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  Header: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Title: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}));

const READER_ID = "018f0e6a-5000-7000-8000-000000000009";

const ticket = (
  publicId: string,
  overrides: Partial<AccessTicketItem> = {}
): AccessTicketItem => ({
  createdAt: "2026-06-01T00:00:00Z",
  episodePublicId: "EPISODE001",
  episodeTitle: "Episode 1",
  expiresAt: "",
  id: `id-${publicId}`,
  note: "",
  publicId,
  revokedAt: "",
  seriesPublicId: "SERIES001",
  seriesTitle: "Series 1",
  status: "active",
  userEmail: "reader@example.com",
  userName: "Reader",
  userPublicId: "READER001",
  ...overrides,
});

const renderTickets = async (
  props: Partial<Parameters<typeof ReaderTickets>[0]> = {}
) =>
  render(
    await ReaderTickets({
      locale: "en",
      name: "Reader",
      pageSize: 20,
      readerId: READER_ID,
      series: [],
      tenantId: "TENANT001",
      tickets: [],
      timeZone: "UTC",
      ...props,
    })
  );

afterEach(() => {
  cleanup();
});

describe("ReaderTickets", () => {
  it("lists each ticket with its episode and state, and offers revoke on an active one", async () => {
    await renderTickets({
      tickets: [
        ticket("TICKET000001", { note: "Support case" }),
        ticket("TICKET000002", {
          revokedAt: "2026-06-02T00:00:00Z",
          status: "revoked",
        }),
      ],
    });

    const rows = screen.getAllByRole("table")[0].querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    const [active, revoked] = [...rows] as HTMLElement[];
    expect(
      within(active).getByRole("link", { name: "Episode 1" })
    ).toHaveProperty(
      "href",
      expect.stringMatching(/\/series\/SERIES001\/episodes\/EPISODE001$/u)
    );
    expect(active.textContent).toContain("Active");
    expect(active.textContent).toContain("Support case");
    expect(
      within(active).getByRole("button", { name: "Revoke id-TICKET000001" })
    ).toBeTruthy();
    expect(revoked.textContent).toContain("Revoked");
    expect(within(revoked).queryByRole("button")).toBeNull();
  });

  it("issues a ticket to the reader the page is about", async () => {
    await renderTickets();

    expect(screen.getByRole("button", { name: "Issue a ticket" })).toBeTruthy();
    expect(screen.getByText("Issue a ticket to Reader")).toBeTruthy();
    expect(
      screen.getByRole("form", { name: `Issue to ${READER_ID}` })
    ).toBeTruthy();
  });

  it("says the reader holds no tickets when the list is empty", async () => {
    await renderTickets();

    expect(
      screen.getByText("This reader holds no access tickets.")
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists the tickets but offers no issue without the reader's primary key", async () => {
    await renderTickets({
      readerId: undefined,
      tickets: [ticket("TICKET000001")],
    });

    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Issue a ticket" })).toBeNull();
  });

  it("shows the failure instead of an empty list or a pager", async () => {
    await renderTickets({ listErrorMessage: "The API is down." });

    expect(
      screen.getByText("Could not display this reader's access tickets")
    ).toBeTruthy();
    expect(screen.getByText("The API is down.")).toBeTruthy();
    expect(
      screen.queryByText("This reader holds no access tickets.")
    ).toBeNull();
  });
});
