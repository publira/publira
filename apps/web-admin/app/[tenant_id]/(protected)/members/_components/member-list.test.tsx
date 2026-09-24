// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormActionState } from "#components/action-form";

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
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

vi.mock("#lib/messages", () => ({
  getMessagesFor: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
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
        members: [
          {
            createdAt: "2026-06-01T00:00:00Z",
            email: "editor@example.com",
            name: "Grace Hopper",
            role: "tenant_editor",
            status: "active",
            userPublicId: "USER001",
          },
        ],
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
});
