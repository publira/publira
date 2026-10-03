// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReaderDetail } from "../../reader-types";
import { ReaderAccount } from "./reader-account";

vi.mock("../_lib/actions", () => ({
  deleteReaderAction: vi.fn(),
  setReaderBirthDateAction: vi.fn(),
  suspendReaderAction: vi.fn(),
  unsuspendReaderAction: vi.fn(),
}));

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

const OWN_ACCOUNT =
  "This is the account you are signed in with, so it cannot be suspended or deleted here.";

const reader = (overrides: Partial<ReaderDetail> = {}): ReaderDetail => ({
  birthDate: "",
  createdAt: "2026-06-01T00:00:00Z",
  email: "admin@example.com",
  emailVerifiedAt: "",
  id: "01920000-0000-7000-8000-000000000001",
  name: "Avery Admin",
  publicId: "ADMIN000001",
  role: "tenant_admin",
  status: "active",
  ...overrides,
});

const renderAccount = async (detail: ReaderDetail, ownAccount = false) =>
  render(
    await ReaderAccount({
      locale: "en",
      ownAccount,
      reader: detail,
      tenantId: "TENANT001",
      timeZone: "UTC",
    })
  );

afterEach(() => {
  cleanup();
});

describe("ReaderAccount", () => {
  it("shows the role beside the status", async () => {
    await renderAccount(reader());

    const status = screen.getByText("Active").closest("dd");
    expect(status?.textContent).toContain("Tenant admin");
  });

  it("shows no role for an account that holds none", async () => {
    await renderAccount(reader({ role: "" }));

    const status = screen.getByText("Active").closest("dd");
    expect(status?.textContent).toBe("Active");
  });

  // Another administrator's account included: the caller is then the other
  // active administrator the API's last-administrator guard looks for.
  it("offers suspend and delete on an account other than one's own", async () => {
    await renderAccount(reader());

    expect(screen.getByRole("button", { name: "Suspend" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.queryByText(OWN_ACCOUNT)).toBeNull();
  });

  it("withholds suspend and delete on one's own account and says why", async () => {
    await renderAccount(reader(), true);

    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText(OWN_ACCOUNT)).toBeTruthy();
  });

  it("offers to lift a suspension in place of suspending again", async () => {
    await renderAccount(reader({ status: "suspended" }));

    expect(
      screen.getByRole("button", { name: "Lift suspension" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });
});
