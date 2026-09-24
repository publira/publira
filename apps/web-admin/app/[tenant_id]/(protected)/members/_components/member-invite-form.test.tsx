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

import { MemberInviteForm } from "./member-invite-form";

const { save } = vi.hoisted(() => ({
  save: { current: Promise.withResolvers<FormActionState>() },
}));

vi.mock("../_lib/actions", () => ({
  createTenantAdminInvitationAction: () => save.current.promise,
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

afterEach(() => {
  cleanup();
  save.current = Promise.withResolvers<FormActionState>();
});

describe("MemberInviteForm", () => {
  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would sit under the success message unsaved.
  it("closes the address while the invitation is in flight", async () => {
    render(<MemberInviteForm tenantId="TENANT001" />);
    const field = screen.getByRole("textbox", {
      name: /Email address to invite/u,
    });

    fireEvent.change(field, { target: { value: "editor@example.com" } });
    expect(field.matches(":disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(field.matches(":disabled")).toBe(true);
    });

    save.current.resolve({ message: "Could not invite.", ok: false });
    await waitFor(() => {
      expect(field.matches(":disabled")).toBe(false);
    });
  });
});
