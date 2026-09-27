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

import type { EmailChangeActionState } from "../settings-types";
import { EmailChangeForm } from "./email-change-form";

const { request } = vi.hoisted(() => ({
  request: { current: Promise.withResolvers<EmailChangeActionState>() },
}));

vi.mock("../_lib/actions", () => ({
  requestEmailChangeAction: () => request.current.promise,
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

const fields = () => [
  screen.getByLabelText<HTMLInputElement>(/Current email address/u),
  screen.getByLabelText<HTMLInputElement>(/New email address/u),
  screen.getByLabelText<HTMLInputElement>(/Current password/u),
];

const fillIn = () => {
  const [currentEmail, newEmail, currentPassword] = fields();
  fireEvent.change(currentEmail, {
    target: { value: "current@example.com" },
  });
  fireEvent.change(newEmail, { target: { value: "new@example.com" } });
  fireEvent.change(currentPassword, { target: { value: "password" } });
};

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  request.current.resolve(null);
  request.current = Promise.withResolvers<EmailChangeActionState>();
});

describe("EmailChangeForm", () => {
  // The Action carries what the fields held when the form was submitted, so an
  // edit made while it is in flight would not be the address the request used.
  it("closes the fields while the request is in flight", async () => {
    render(<EmailChangeForm tenantId="TENANT001" />);

    fillIn();

    for (const field of fields()) {
      expect(field.matches(":disabled")).toBe(false);
    }

    fireEvent.click(
      screen.getByRole("button", { name: "Send the confirmation email" })
    );

    await waitFor(() => {
      for (const field of fields()) {
        expect(field.matches(":disabled")).toBe(true);
      }
    });
  });

  it("keeps what was typed when the request is refused", async () => {
    render(<EmailChangeForm tenantId="TENANT001" />);

    fillIn();
    fireEvent.click(
      screen.getByRole("button", { name: "Send the confirmation email" })
    );
    request.current.resolve({ message: "Could not send.", ok: false });

    expect(await screen.findByText("Could not send.")).toBeDefined();
    expect(fields().map((field) => field.value)).toStrictEqual([
      "current@example.com",
      "new@example.com",
      "password",
    ]);
  });
});
