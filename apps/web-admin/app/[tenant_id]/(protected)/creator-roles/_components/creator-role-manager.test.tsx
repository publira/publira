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

import { CreatorRoleManager } from "./creator-role-manager";

const { save } = vi.hoisted(() => ({
  save: { current: Promise.withResolvers<FormActionState>() },
}));

vi.mock("../_lib/actions", () => ({
  createCreatorRoleAction: () => save.current.promise,
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

// The real input is an async Server Component, which a client render cannot
// run; the same control without its catalog placeholder stands in for it.
vi.mock("./creator-role-name-input", async () => {
  const { Input } = await import("@publira/ui-components/input");

  return { CreatorRoleNameInput: () => <Input name="name" type="text" /> };
});

afterEach(() => {
  cleanup();
  save.current = Promise.withResolvers<FormActionState>();
});

describe("CreatorRoleManager", () => {
  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would sit under the success message unsaved.
  it("closes the new role's name while its creation is in flight", async () => {
    render(<CreatorRoleManager creatorRoles={[]} tenantId="TENANT001" />);
    const field = screen.getByRole("textbox", { name: /Role name/u });

    fireEvent.change(field, { target: { value: "Colorist" } });
    expect(field.matches(":disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Create role" }));

    await waitFor(() => {
      expect(field.matches(":disabled")).toBe(true);
    });

    save.current.resolve({ message: "Could not create.", ok: false });
    await waitFor(() => {
      expect(field.matches(":disabled")).toBe(false);
    });
  });
});
