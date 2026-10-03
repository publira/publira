// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CreatorAccountItem } from "#lib/creator";

import { CreatorAccounts } from "./creator-accounts";

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

// Both forms carry a Server Action and a client picker or dialog, so all that
// is checked here is where the list places them.
vi.mock("./creator-account-link-form", () => ({
  CreatorAccountLinkForm: () => <form aria-label="Link an account" />,
}));

vi.mock("./unlink-creator-account-button", () => ({
  UnlinkCreatorAccountButton: ({
    name,
    readerId,
  }: {
    name: string;
    readerId: string;
  }) => <button type="button" value={readerId}>{`Unlink ${name}`}</button>,
}));

const account = (
  overrides: Partial<CreatorAccountItem> = {}
): CreatorAccountItem => ({
  createdAt: "2026-01-01T00:00:00Z",
  email: "one@example.com",
  id: "018f0e6a-5000-7000-8000-000000000001",
  linkedAt: "2026-09-01T00:00:00Z",
  name: "Reader One",
  publicId: "READER001",
  role: "",
  status: "active",
  ...overrides,
});

const renderAccounts = (accounts: CreatorAccountItem[]) =>
  render(
    <CreatorAccounts
      accounts={accounts}
      creatorId="018f0e6a-2000-7000-8000-000000000001"
      creatorPublicId="CREATOR001"
      locale="en"
      tenantId="TENANT001"
      timeZone="UTC"
    />
  );

afterEach(() => {
  cleanup();
});

describe("CreatorAccounts", () => {
  it("says no account is linked yet, beside the form that links one", async () => {
    renderAccounts([]);

    expect(
      await screen.findByText("No reader account is linked to this author.")
    ).toBeDefined();
    expect(screen.getByRole("form", { name: "Link an account" })).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists each linked account with a way to its reader page and to unlink it", async () => {
    renderAccounts([
      account(),
      account({
        email: "two@example.com",
        id: "018f0e6a-5000-7000-8000-000000000002",
        linkedAt: "2026-09-02T00:00:00Z",
        name: "",
        publicId: "READER002",
      }),
    ]);

    const readerOneLink = await screen.findByRole("link", {
      name: "Reader One",
    });
    expect(readerOneLink.getAttribute("href")).toBe("/readers/READER001");
    // A reader with no name is still named: by public id on the link, and by
    // email in the confirmation.
    expect(
      screen.getByRole("link", { name: "READER002" }).getAttribute("href")
    ).toBe("/readers/READER002");
    expect(screen.getByText("Sep 1, 2026")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Unlink Reader One" })
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Unlink two@example.com" })
    ).toBeDefined();
    expect(
      screen.queryByText("No reader account is linked to this author.")
    ).toBeNull();
  });
});
