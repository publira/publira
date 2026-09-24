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

import { AcceptInviteForm } from "./accept-invite-form";

const { save } = vi.hoisted(() => ({
  save: { current: Promise.withResolvers<FormActionState>() },
}));

vi.mock("../_lib/actions", () => ({
  acceptInviteAction: () => save.current.promise,
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

// The real field is an async Server Component, which a client render cannot
// run; the same control without its catalog placeholder stands in for it.
vi.mock("./name-field", async () => {
  const { Field, FieldContent, FieldLabel } =
    await import("@publira/ui-components/field");
  const { Input } = await import("@publira/ui-components/input");

  return {
    NameField: () => (
      <Field>
        <FieldLabel htmlFor="name">Full name</FieldLabel>
        <FieldContent>
          <Input id="name" name="name" type="text" />
        </FieldContent>
      </Field>
    ),
  };
});

const fields = () => [
  screen.getByRole("textbox", { name: /Full name/u }),
  screen.getByLabelText(/^Password\b(?! \(confirm\))/u),
  screen.getByLabelText(/Password \(confirm\)/u),
];

afterEach(() => {
  cleanup();
  save.current = Promise.withResolvers<FormActionState>();
});

describe("AcceptInviteForm", () => {
  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would sit under the success message unsaved.
  it("closes the new account's fields while the acceptance is in flight", async () => {
    render(
      <AcceptInviteForm
        accountExists={false}
        email="editor@example.com"
        tenantId="TENANT001"
        token="TOKEN001"
      />
    );

    const [name, password, confirmation] = fields();
    fireEvent.change(name, { target: { value: "Grace Hopper" } });
    fireEvent.change(password, { target: { value: "correct horse" } });
    fireEvent.change(confirmation, { target: { value: "correct horse" } });
    for (const field of fields()) {
      expect(field.matches(":disabled")).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() => {
      for (const field of fields()) {
        expect(field.matches(":disabled")).toBe(true);
      }
    });

    save.current.resolve({ message: "Could not accept.", ok: false });
    await waitFor(() => {
      expect(fields()[0].matches(":disabled")).toBe(false);
    });
  });
});
