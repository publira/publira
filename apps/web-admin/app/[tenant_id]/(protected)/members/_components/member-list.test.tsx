// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TenantMemberItem } from "#lib/tenant-members";

import { MemberList } from "./member-list";

const { save } = vi.hoisted(() => ({
  save: { current: Promise.withResolvers<FormActionState>() },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantMemberRoleAction: () => save.current.promise,
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

vi.mock("#lib/messages", () => ({
  getMessagesFor: () =>
    Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

// Removing a member is a form of its own, and its dialog needs providers this
// test has no use for.
vi.mock("./member-remove-button", () => ({
  MemberRemoveButton: () => null,
}));

/**
 * Whether a control refuses input, whichever way it says so. A native control
 * closed by its `<fieldset>` keeps `disabled` false and matches `:disabled`.
 */
const isClosed = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true" ||
  Object.hasOwn(element.dataset, "disabled");

const member = (
  overrides: Partial<TenantMemberItem> = {}
): TenantMemberItem => ({
  createdAt: "2026-06-01T00:00:00Z",
  email: "editor@example.com",
  name: "Grace Hopper",
  publicId: "EDITOR00001",
  role: "tenant_editor",
  status: "active",
  userId: "USER001",
  ...overrides,
});

afterEach(() => {
  cleanup();
  save.current = Promise.withResolvers<FormActionState>();
});

describe("MemberList", () => {
  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would sit under the success message unsaved.
  it("closes the member's role while its change is in flight", async () => {
    render(
      await MemberList({
        locale: "en",
        members: [member()],
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );
    const role = screen.getByRole("combobox", {
      name: "Role of Grace Hopper",
    });

    expect(isClosed(role)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Change role" }));

    await waitFor(() => {
      expect(isClosed(role)).toBe(true);
    });

    save.current.resolve({ message: "Could not change the role.", ok: false });
    await waitFor(() => {
      expect(isClosed(role)).toBe(false);
    });
  });

  it("links each member to the reader page their account is acted on from", async () => {
    render(
      await MemberList({
        locale: "en",
        members: [
          member(),
          member({ name: "", publicId: "NONAME00001", userId: "USER002" }),
        ],
        pageSize: 20,
        tenantId: "TENANT001",
        timeZone: "UTC",
      })
    );

    expect(
      screen.getByRole("link", { name: "Grace Hopper" }).getAttribute("href")
    ).toBe("/readers/EDITOR00001");
    expect(
      screen.getByRole("link", { name: "NONAME00001" }).getAttribute("href")
    ).toBe("/readers/NONAME00001");
  });
});
