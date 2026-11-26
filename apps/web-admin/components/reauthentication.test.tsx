// @vitest-environment jsdom

import * as ActionForm from "@publira/ui-components/action-form";
import type {
  AuthenticationResponseJSON,
  StartAuthenticationOpts,
} from "@simplewebauthn/browser";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import type { PasskeyCeremonyStartState } from "#lib/mfa-action-state";
import type { ReauthenticationRequiredState } from "#lib/reauthentication";

import * as Reauthentication from "./reauthentication";

const { begin, reauthenticate, startAuthentication } = vi.hoisted(() => ({
  begin: vi.fn<(formData: FormData) => Promise<PasskeyCeremonyStartState>>(),
  reauthenticate:
    vi.fn<
      (
        previousState: ActionForm.State,
        formData: FormData
      ) => Promise<ActionForm.State>
    >(),
  startAuthentication:
    vi.fn<
      (
        options: StartAuthenticationOpts
      ) => Promise<Pick<AuthenticationResponseJSON, "id">>
    >(),
}));

// The Actions are `"use server"`, so the module they live in cannot be
// evaluated here at all.
vi.mock("#lib/reauthentication-actions", () => ({
  beginReauthenticationPasskeyAction: begin,
  reauthenticateAction: reauthenticate,
}));

// jsdom has no WebAuthn; the browser's half of the ceremony is what this
// stands in for.
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication,
}));

afterEach(() => {
  cleanup();
});

const refusal = (
  factors: Partial<ReauthenticationRequiredState["reauthentication"]> = {}
): ReauthenticationRequiredState => ({
  message: "Confirm it's you to make this change.",
  ok: false,
  reauthentication: {
    authenticator: false,
    passkey: false,
    tenantId: "TENANT001",
    ...factors,
  },
});

/**
 * A form whose Action the API refuses once for want of a re-authentication,
 * and takes once it has had one.
 */
const renderRefusedForm = (first: ReauthenticationRequiredState) => {
  const save = vi
    .fn<
      (
        previousState: ActionForm.State,
        formData: FormData
      ) => Promise<ActionForm.State>
    >()
    .mockResolvedValueOnce(first)
    .mockResolvedValue({ message: "Saved.", ok: true });

  render(
    <AdminLocaleTestProvider locale="en">
      <Reauthentication.Root>
        <ActionForm.Root action={save}>
          <Reauthentication.Request />
          <input name="tenant_id" type="hidden" value="TENANT001" />
          <input aria-label="Name" defaultValue="CRM" name="name" />
          <ActionForm.Submit>Save</ActionForm.Submit>
        </ActionForm.Root>
      </Reauthentication.Root>
    </AdminLocaleTestProvider>
  );

  return save;
};

describe("Reauthentication", () => {
  it("asks for the password when the API refuses the form, then sends the form again", async () => {
    reauthenticate.mockResolvedValueOnce({ message: "", ok: true });
    const save = renderRefusedForm(refusal());

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Confirm it's you",
    });

    expect(
      screen.queryByLabelText("Or a code from your authenticator app")
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Use a passkey" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    const proof = reauthenticate.mock.calls[0]?.[1];
    expect(proof?.get("password")).toBe("correct horse");
    expect(proof?.get("tenant_id")).toBe("TENANT001");
    // What was typed into the refused form goes out again as it was.
    expect(save.mock.calls[1]?.[1].get("name")).toBe("CRM");
    await waitFor(() => {
      expect(dialog.isConnected).toBe(false);
    });
  });

  it("keeps the dialog open on a refused password, and leaves the form unsent", async () => {
    reauthenticate.mockResolvedValueOnce({
      fieldErrors: { password: "The password is not correct." },
      message: "The password is not correct.",
      ok: false,
    });
    const save = renderRefusedForm(refusal());

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("dialog", { name: "Confirm it's you" });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const refusals = await screen.findAllByText("The password is not correct.");
    expect(refusals.length).toBeGreaterThan(0);
    expect(save).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("dialog", { name: "Confirm it's you" })
    ).toBeTruthy();
  });

  it("offers the account's own second factors beside the password", async () => {
    begin.mockResolvedValueOnce({
      message: "",
      ok: true,
      optionsJson: JSON.stringify({ challenge: "Y2hhbGxlbmdl" }),
    });
    startAuthentication.mockResolvedValueOnce({ id: "credential-id" });
    reauthenticate.mockResolvedValueOnce({ message: "", ok: true });

    const save = renderRefusedForm(
      refusal({ authenticator: true, passkey: true })
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("dialog", { name: "Confirm it's you" });
    expect(
      screen.getByLabelText("Or a code from your authenticator app")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use a passkey" }));

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    expect(begin).toHaveBeenCalledOnce();
    expect(
      JSON.parse(
        String(reauthenticate.mock.calls[0]?.[1].get("confirmation_credential"))
      )
    ).toEqual({ id: "credential-id" });
  });
});
