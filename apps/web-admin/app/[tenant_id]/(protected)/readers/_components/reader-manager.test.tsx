// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReaderItem } from "../reader-types";
import { ReaderManager } from "./reader-manager";

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

const reader = (overrides: Partial<ReaderItem> = {}): ReaderItem => ({
  createdAt: "2026-06-01T20:00:00Z",
  email: "reader@example.com",
  name: "Reader One",
  publicId: "READER00001",
  status: "active",
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("ReaderManager", () => {
  it("lists a reader's name, email, state, and sign-up date in the tenant time zone", async () => {
    render(
      await ReaderManager({
        filtered: false,
        locale: "en",
        pageSize: 20,
        readers: [reader({ status: "suspended" })],
        timeZone: "Asia/Tokyo",
      })
    );

    expect(
      screen.getByRole("link", { name: "Reader One" }).getAttribute("href")
    ).toBe("/readers/READER00001");
    expect(screen.getByText("reader@example.com")).toBeTruthy();
    expect(screen.getByText("Suspended")).toBeTruthy();
    // 2026-06-01T20:00Z is already 2 June in Asia/Tokyo.
    expect(screen.getByText(/Jun 2, 2026/u)).toBeTruthy();
  });

  it("links a reader without a name by their public_id", async () => {
    render(
      await ReaderManager({
        filtered: false,
        locale: "en",
        pageSize: 20,
        readers: [reader({ name: "" })],
        timeZone: "Asia/Tokyo",
      })
    );

    expect(screen.getByRole("link", { name: "READER00001" })).toBeTruthy();
  });

  it("says nobody has signed up yet for a tenant with no readers", async () => {
    render(
      await ReaderManager({
        filtered: false,
        locale: "en",
        pageSize: 20,
        readers: [],
        timeZone: "Asia/Tokyo",
      })
    );

    expect(screen.getByText("There are no readers to show.")).toBeTruthy();
    expect(
      screen.getByText("Nobody has signed up to read this site yet.")
    ).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("points at the filters when a search matched nobody", async () => {
    render(
      await ReaderManager({
        filtered: true,
        locale: "en",
        pageSize: 20,
        readers: [],
        timeZone: "Asia/Tokyo",
      })
    );

    expect(
      screen.getByText(
        "Nobody matches these filters. Try another name or email, or reset the filters."
      )
    ).toBeTruthy();
  });

  it("renders the failure instead of the list and the pager when the read failed", async () => {
    render(
      await ReaderManager({
        filtered: false,
        listErrorMessage: "The API is unavailable.",
        locale: "en",
        pageSize: 20,
        readers: [],
        timeZone: "Asia/Tokyo",
      })
    );

    expect(screen.getByText("Could not display the readers")).toBeTruthy();
    expect(screen.getByText("The API is unavailable.")).toBeTruthy();
    expect(screen.queryByText("There are no readers to show.")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("offers both page links when the list continues in both directions", async () => {
    render(
      await ReaderManager({
        filtered: false,
        locale: "en",
        nextHref: "?token=next",
        pageSize: 20,
        previousHref: "?token=previous",
        readers: [reader()],
        timeZone: "Asia/Tokyo",
      })
    );

    const pager = screen.getByRole("navigation", {
      name: "Readers pagination",
    });
    const hrefs = [...pager.querySelectorAll("a")].map((link) =>
      link.getAttribute("href")
    );
    expect(hrefs).toEqual(["?token=previous", "?token=next"]);
  });
});
