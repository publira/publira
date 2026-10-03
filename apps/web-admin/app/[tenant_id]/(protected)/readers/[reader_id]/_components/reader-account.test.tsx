// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReaderDetail } from "../../reader-types";
import type { ReaderModerationRefusals } from "../_lib/moderation-refusals";
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
const LAST_TENANT_ADMIN =
  "This account is the tenant's last active tenant admin. Make someone else a tenant admin before suspending or deleting it.";

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

const noRefusals: ReaderModerationRefusals = {
  lastTenantAdmin: false,
  ownAccount: false,
};

const renderAccount = async (
  detail: ReaderDetail,
  refusals: ReaderModerationRefusals
) =>
  render(
    await ReaderAccount({
      locale: "en",
      reader: detail,
      refusals,
      tenantId: "TENANT001",
      timeZone: "UTC",
    })
  );

afterEach(() => {
  cleanup();
});

describe("ReaderAccount", () => {
  it("shows the role beside the status", async () => {
    await renderAccount(reader(), noRefusals);

    const status = screen.getByText("Active").closest("dd");
    expect(status?.textContent).toContain("Tenant admin");
  });

  it("shows no role for an account that holds none", async () => {
    await renderAccount(reader({ role: "" }), noRefusals);

    const status = screen.getByText("Active").closest("dd");
    expect(status?.textContent).toBe("Active");
  });

  it("offers suspend and delete when no guard refuses them", async () => {
    await renderAccount(reader(), noRefusals);

    expect(screen.getByRole("button", { name: "Suspend" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.queryByText(OWN_ACCOUNT)).toBeNull();
    expect(screen.queryByText(LAST_TENANT_ADMIN)).toBeNull();
  });

  it.each([
    [
      "the signed-in administrator's own account",
      { ownAccount: true },
      OWN_ACCOUNT,
    ],
    [
      "the tenant's last active administrator",
      { lastTenantAdmin: true },
      LAST_TENANT_ADMIN,
    ],
  ])(
    "withholds suspend and delete on %s and says why",
    async (_case, refusal, reason) => {
      await renderAccount(reader(), { ...noRefusals, ...refusal });

      expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
      expect(screen.getByText(reason)).toBeTruthy();
    }
  );

  it("gives both reasons when both guards apply", async () => {
    await renderAccount(reader(), { lastTenantAdmin: true, ownAccount: true });

    const reasons = screen.getByText(/signed in with/u);
    expect(reasons.textContent).toBe(`${OWN_ACCOUNT} ${LAST_TENANT_ADMIN}`);
  });

  // Lifting a suspension is not something either guard refuses.
  it("still offers to lift a suspension on a guarded account", async () => {
    await renderAccount(reader({ status: "suspended" }), {
      ...noRefusals,
      lastTenantAdmin: true,
    });

    expect(
      screen.getByRole("button", { name: "Lift suspension" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
