// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContactMessageItem } from "../contact-message-types";
import { ContactMessageManager } from "./contact-message-manager";

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

const contactMessage = (
  overrides: Partial<ContactMessageItem> = {}
): ContactMessageItem => ({
  body: "The second episode will not open for me.",
  createdAt: "2026-06-01T20:00:00Z",
  handledAt: "",
  publicId: "CONTACT0001",
  replyToEmail: "reader@example.com",
  senderName: "Reader One",
  senderPublicId: "READER00001",
  subject: "Cannot open an episode",
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("ContactMessageManager", () => {
  it("lists a message's subject, sender, reply-to address, state, and arrival in the tenant time zone", async () => {
    render(
      await ContactMessageManager({
        filtered: false,
        locale: "en",
        messages: [contactMessage()],
        pageSize: 20,
        timeZone: "Asia/Tokyo",
      })
    );

    expect(
      screen
        .getByRole("link", { name: "Cannot open an episode" })
        .getAttribute("href")
    ).toBe("/contact-messages/CONTACT0001");
    expect(
      screen.getByRole("link", { name: "Reader One" }).getAttribute("href")
    ).toBe("/readers/READER00001");
    expect(screen.getByText("reader@example.com")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    // 2026-06-01T20:00Z is already 2 June in Asia/Tokyo.
    expect(screen.getByText(/Jun 2, 2026/u)).toBeTruthy();
  });

  it("names the message a guest sent without linking it to an account", async () => {
    render(
      await ContactMessageManager({
        filtered: false,
        locale: "en",
        messages: [contactMessage({ senderName: "", senderPublicId: "" })],
        pageSize: 20,
        timeZone: "Asia/Tokyo",
      })
    );

    expect(screen.getByText("Guest")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Reader One" })).toBeNull();
  });

  it("links a message the reader gave no subject by the stand-in for one", async () => {
    render(
      await ContactMessageManager({
        filtered: false,
        locale: "en",
        messages: [contactMessage({ subject: "" })],
        pageSize: 20,
        timeZone: "Asia/Tokyo",
      })
    );

    expect(screen.getByRole("link", { name: "No subject" })).toBeTruthy();
  });

  it("shows a message staff have dealt with as handled", async () => {
    render(
      await ContactMessageManager({
        filtered: false,
        locale: "en",
        messages: [contactMessage({ handledAt: "2026-06-03T00:00:00Z" })],
        pageSize: 20,
        timeZone: "Asia/Tokyo",
      })
    );

    expect(screen.getByText("Handled")).toBeTruthy();
  });

  it("says nothing has arrived yet for a tenant nobody has written to", async () => {
    render(
      await ContactMessageManager({
        filtered: false,
        locale: "en",
        messages: [],
        pageSize: 20,
        timeZone: "Asia/Tokyo",
      })
    );

    expect(
      screen.getByText("There are no contact messages to show.")
    ).toBeTruthy();
    expect(
      screen.getByText("Nothing has arrived through the contact form yet.")
    ).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("points at the filter when no message is in the state that was asked for", async () => {
    render(
      await ContactMessageManager({
        filtered: true,
        locale: "en",
        messages: [],
        pageSize: 20,
        timeZone: "Asia/Tokyo",
      })
    );

    expect(
      screen.getByText(
        "No message is in this state. Try the other state, or reset the filter."
      )
    ).toBeTruthy();
  });

  it("renders the failure instead of the list and the pager when the read failed", async () => {
    render(
      await ContactMessageManager({
        filtered: false,
        listErrorMessage: "Could not load the contact messages.",
        locale: "en",
        messages: [],
        nextHref: "?token=next-token",
        pageSize: 20,
        timeZone: "Asia/Tokyo",
      })
    );

    expect(
      screen.getByText("Could not load the contact messages.")
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("pages through the inbox when the list spans more than one page", async () => {
    render(
      await ContactMessageManager({
        filtered: false,
        locale: "en",
        messages: [contactMessage()],
        nextHref: "?token=next-token",
        pageSize: 20,
        previousHref: "?token=previous-token",
        timeZone: "Asia/Tokyo",
      })
    );

    const pager = screen.getByRole("navigation", {
      name: "Contact messages pagination",
    });
    const hrefs = [...pager.querySelectorAll("a")].map((link) =>
      link.getAttribute("href")
    );
    expect(hrefs).toEqual(["?token=previous-token", "?token=next-token"]);
  });
});
