// @vitest-environment jsdom

import * as ActionForm from "@publira/ui-components/action-form";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

import type {
  PasskeyRegistrationStartState,
  PasskeyRegistrationState,
} from "../_lib/passkey-state";
import {
  PasskeyAddForm,
  PasskeyAdded,
  PasskeyAddition,
  PasskeyNameForm,
  PasskeyNamed,
  SkipPasskeyNaming,
} from "./passkey-addition";

const {
  beginRegistration,
  browserSupportsWebAuthn,
  finishRegistration,
  namePasskey,
  startRegistration,
} = vi.hoisted(() => ({
  beginRegistration:
    vi.fn<(formData: FormData) => Promise<PasskeyRegistrationStartState>>(),
  browserSupportsWebAuthn: vi.fn<() => boolean>(),
  finishRegistration:
    vi.fn<(formData: FormData) => Promise<PasskeyRegistrationState>>(),
  namePasskey:
    vi.fn<
      (state: ActionForm.State, formData: FormData) => Promise<ActionForm.State>
    >(),
  startRegistration:
    vi.fn<(options: { optionsJSON: unknown }) => Promise<unknown>>(),
}));

// The Actions are `"use server"`, so the module they live in cannot be
// evaluated here at all.
vi.mock("../_lib/passkey-actions", () => ({
  beginPasskeyRegistrationAction: beginRegistration,
  finishPasskeyRegistrationAction: finishRegistration,
  namePasskeyAction: namePasskey,
}));

// jsdom has no WebAuthn; the browser's half of the ceremony is what these
// stand in for.
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn,
  startRegistration,
}));

/**
 * What `startRegistration` rejects with: a `WebAuthnError`, an `Error`
 * carrying the name of the `DOMException` the browser threw.
 */
const webAuthnError = (name: string) =>
  Object.assign(new Error(`The ceremony failed: ${name}`), { name });

const CREATION_OPTIONS = { challenge: "Y2hhbGxlbmdl", rp: { name: "Site" } };

const CREDENTIAL = { id: "credential-id", response: {}, type: "public-key" };

const renderAddition = () =>
  renderWithClientMessages(
    <PasskeyAddition
      add={
        <PasskeyAddForm>
          <input name="tenantId" type="hidden" value="TENANT001" />
          <PasskeyAdded />
          <ActionForm.Submit>Add a passkey</ActionForm.Submit>
        </PasskeyAddForm>
      }
      name={
        <PasskeyNameForm>
          <PasskeyNamed />
          <label>
            Name this passkey
            <input name="name" />
          </label>
          <SkipPasskeyNaming>Skip</SkipPasskeyNaming>
          <ActionForm.Submit>Save</ActionForm.Submit>
        </PasskeyNameForm>
      }
    />
  );

const addButton = () => screen.getByRole("button", { name: "Add a passkey" });

beforeEach(() => {
  browserSupportsWebAuthn.mockReturnValue(true);
  beginRegistration.mockResolvedValue({
    message: "",
    ok: true,
    optionsJson: JSON.stringify(CREATION_OPTIONS),
  });
  startRegistration.mockResolvedValue(CREDENTIAL);
  finishRegistration.mockResolvedValue({
    message: "",
    ok: true,
    passkeyId: "PSKY0001",
  });
  namePasskey.mockResolvedValue({ message: "", ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PasskeyAddition", () => {
  it("offers nothing in a browser without WebAuthn", async () => {
    browserSupportsWebAuthn.mockReturnValue(false);

    await renderAddition();

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("creates a passkey over the options the server began, stores it, and asks for its name", async () => {
    await renderAddition();
    fireEvent.click(addButton());

    expect(await screen.findByLabelText("Name this passkey")).toBeDefined();
    expect(startRegistration).toHaveBeenCalledWith({
      optionsJSON: CREATION_OPTIONS,
    });
    const finished = finishRegistration.mock.calls[0]?.[0];
    expect(finished?.get("tenantId")).toBe("TENANT001");
    expect(finished?.get("credential")).toBe(JSON.stringify(CREDENTIAL));
  });

  it("names the passkey it stored, then offers to add another", async () => {
    await renderAddition();
    fireEvent.click(addButton());
    fireEvent.change(await screen.findByLabelText("Name this passkey"), {
      target: { value: "Laptop" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", { name: "Add a passkey" })
    ).toBeDefined();
    const named = namePasskey.mock.calls[0]?.[1];
    expect(named?.get("passkeyId")).toBe("PSKY0001");
    expect(named?.get("name")).toBe("Laptop");
  });

  it("leaves the passkey unnamed when the reader skips", async () => {
    await renderAddition();
    fireEvent.click(addButton());
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));

    expect(
      await screen.findByRole("button", { name: "Add a passkey" })
    ).toBeDefined();
    expect(namePasskey).not.toHaveBeenCalled();
  });

  it("stays on the add form with the refusal when the account holds as many as it may", async () => {
    beginRegistration.mockResolvedValueOnce({
      message: "Your account has as many passkeys as it can hold.",
      ok: false,
    });

    await renderAddition();
    fireEvent.click(addButton());

    expect(
      await screen.findByText(
        "Your account has as many passkeys as it can hold."
      )
    ).toBeDefined();
    expect(startRegistration).not.toHaveBeenCalled();
    expect(addButton()).toBeDefined();
  });

  it.each([
    [
      "NotAllowedError",
      "The passkey request was cancelled or timed out. Try again.",
    ],
    [
      "InvalidStateError",
      "This passkey is already registered to your account.",
    ],
    ["SecurityError", "Could not add the passkey. Please try again later."],
  ])(
    "says what a %s from the browser means, and stores nothing",
    async (name, message) => {
      startRegistration.mockRejectedValueOnce(webAuthnError(name));

      await renderAddition();
      fireEvent.click(addButton());

      expect(await screen.findByText(message)).toBeDefined();
      expect(finishRegistration).not.toHaveBeenCalled();
    }
  );
});
