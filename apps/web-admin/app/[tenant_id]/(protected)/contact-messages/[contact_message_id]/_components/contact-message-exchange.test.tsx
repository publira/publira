// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContactMessageEntryItem } from "../../contact-message-types";
import { ContactMessageExchange } from "./contact-message-exchange";

vi.mock("../_lib/actions", () => ({
  replyToContactMessageAction: () => Promise.resolve(null),
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

const staffAnswer: ContactMessageEntryItem = {
  authorName: "Kei Arata",
  authorPublicId: "STAFF000001",
  body: "Every episode marked free.\nThe rest need a ticket.",
  createdAt: "2026-06-02T01:00:00Z",
  direction: "staff",
  fromEmail: "",
  id: "018f0f80-0004-7000-8000-000000000001",
};

const readerReply: ContactMessageEntryItem = {
  authorName: "",
  authorPublicId: "",
  body: "And on the app?",
  createdAt: "2026-06-03T01:00:00Z",
  direction: "reader",
  fromEmail: "reader.work@example.com",
  id: "018f0f80-0004-7000-8000-000000000002",
};

const renderExchange = (entries: ContactMessageEntryItem[]) =>
  render(
    <ContactMessageExchange
      contactMessage={{
        entries,
        entryCount: entries.length,
        id: "018f0f80-0003-7000-8000-000000000001",
        publicId: "CONTACT0001",
        replyToEmail: "reader@example.com",
      }}
      locale="en"
      tenantId="TENANT001"
      timeZone="Asia/Seoul"
    />
  );

afterEach(() => {
  cleanup();
});

describe("ContactMessageExchange", () => {
  it("says nobody has answered a message with no entries, and still offers the answer form", () => {
    renderExchange([]);

    expect(
      screen.getByText("Nobody has answered this message yet.")
    ).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Answer" })).toBeTruthy();
  });

  it("shows the staff entries and the reader's in the order they were written, newest last", () => {
    renderExchange([
      staffAnswer,
      readerReply,
      {
        ...staffAnswer,
        body: "The app shows the same episodes.",
        createdAt: "2026-06-04T01:00:00Z",
        id: "018f0f80-0004-7000-8000-000000000003",
      },
    ]);

    const entries = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(
      entries.map((entry) => entry.querySelector("p")?.textContent)
    ).toEqual([
      "Answer from Kei Arata",
      "Reply from reader.work@example.com",
      "Answer from Kei Arata",
    ]);
    expect(entries.at(-1)?.textContent).toContain(
      "The app shows the same episodes."
    );
  });

  it("names a staff entry's author and the time it was sent in the tenant time zone", () => {
    renderExchange([staffAnswer]);

    const [entry] = within(screen.getByRole("list")).getAllByRole("listitem");
    if (!entry) {
      throw new Error("no entry was rendered");
    }
    const time = entry.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe(staffAnswer.createdAt);
    // 01:00 UTC is 10:00 in Seoul.
    expect(time?.textContent).toMatch(/10:00/u);
    // The writer's own line breaks are kept.
    expect(
      within(entry).getByText(/Every episode marked free\./u).textContent
    ).toBe(staffAnswer.body);
  });

  it("names a reader entry by the address it was mailed from, not the message's reply-to address", () => {
    renderExchange([staffAnswer, readerReply]);

    expect(screen.getByText("Reply from reader.work@example.com")).toBeTruthy();
    expect(screen.queryByText(/Reply from reader@example\.com/u)).toBeNull();
  });

  it("keeps an answer whose author's account has been deleted under the staff", () => {
    renderExchange([{ ...staffAnswer, authorName: "", authorPublicId: "" }]);

    expect(
      screen.getByText("Answer from a former member of staff")
    ).toBeTruthy();
  });
});
