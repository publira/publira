// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { EmailChangeActionState } from "../settings-types";
import { EmailChangeForm } from "./email-change-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
);

const fields = () => [
  screen.getByLabelText<HTMLInputElement>(/Current email address/u),
  screen.getByLabelText<HTMLInputElement>(/New email address/u),
  screen.getByLabelText<HTMLInputElement>(/Current password/u),
];

afterEach(() => {
  cleanup();
});

describe("EmailChangeForm", () => {
  // The Action carries what the fields held when the form was submitted, so an
  // edit made while it is in flight would not be the address the request used.
  it("closes the fields while the request is in flight", async () => {
    // Never resolved: the assertions are about the window the request is open in.
    const request = Promise.withResolvers<EmailChangeActionState>();
    const pendingAction = vi.fn(() => request.promise);

    await act(() => {
      render(<EmailChangeForm action={pendingAction} />, {
        wrapper: EnglishConsole,
      });
    });

    const [currentEmail, newEmail, currentPassword] = fields();
    fireEvent.change(currentEmail, {
      target: { value: "current@example.com" },
    });
    fireEvent.change(newEmail, { target: { value: "new@example.com" } });
    fireEvent.change(currentPassword, { target: { value: "password" } });

    for (const field of fields()) {
      expect(field.disabled).toBe(false);
    }

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Send the confirmation email",
      })
    );

    await waitFor(() => {
      for (const field of fields()) {
        expect(field.disabled).toBe(true);
      }
    });
  });
});
