// @vitest-environment jsdom

import * as ActionForm from "@publira/ui-components/action-form";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

import type { PasskeyConfirmationStartState } from "../../_lib/passkey-confirmation-state";
import type {
  PasskeyRegistrationStartState,
  PasskeyRegistrationState,
} from "../_lib/passkey-state";
import * as PasskeyAddition from "./passkey-addition";

const {
  beginConfirmation,
  beginRegistration,
  browserSupportsWebAuthn,
  finishRegistration,
  namePasskey,
  startAuthentication,
  startRegistration,
} = vi.hoisted(() => ({
  beginConfirmation:
    vi.fn<(formData: FormData) => Promise<PasskeyConfirmationStartState>>(),
  beginRegistration:
    vi.fn<(formData: FormData) => Promise<PasskeyRegistrationStartState>>(),
  browserSupportsWebAuthn: vi.fn<() => boolean>(),
  finishRegistration:
    vi.fn<(formData: FormData) => Promise<PasskeyRegistrationState>>(),
  namePasskey:
    vi.fn<
      (state: ActionForm.State, formData: FormData) => Promise<ActionForm.State>
    >(),
  startAuthentication:
    vi.fn<(options: { optionsJSON: unknown }) => Promise<typeof ASSERTION>>(),
  startRegistration:
    vi.fn<(options: { optionsJSON: unknown }) => Promise<typeof CREDENTIAL>>(),
}));

// The Actions are `"use server"`, so the module they live in cannot be
// evaluated here at all.
vi.mock("../../_lib/passkey-confirmation-actions", () => ({
  beginPasskeyConfirmationAction: beginConfirmation,
}));

vi.mock("../_lib/passkey-actions", () => ({
  beginPasskeyRegistrationAction: beginRegistration,
  finishPasskeyRegistrationAction: finishRegistration,
  namePasskeyAction: namePasskey,
}));

// jsdom has no WebAuthn; the browser's half of the ceremony is what these
// stand in for.
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn,
  startAuthentication,
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

const REQUEST_OPTIONS = { challenge: "Y29uZmlybQ" };

const ASSERTION = { id: "existing-id", response: {}, type: "public-key" };

const renderAddition = () =>
  renderWithClientMessages(
    <PasskeyAddition.Root
      add={
        <PasskeyAddition.AddForm>
          <input name="tenantId" type="hidden" value="TENANT001" />
          <PasskeyAddition.Added />
          <ActionForm.Submit>Add a passkey</ActionForm.Submit>
        </PasskeyAddition.AddForm>
      }
      name={
        <PasskeyAddition.NameForm>
          <PasskeyAddition.Named />
          <label>
            Name this passkey
            <input name="name" />
          </label>
          <PasskeyAddition.SkipNaming>Skip</PasskeyAddition.SkipNaming>
          <ActionForm.Submit>Save</ActionForm.Submit>
        </PasskeyAddition.NameForm>
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

  it("confirms with another passkey before beginning, when asked to", async () => {
    beginConfirmation.mockResolvedValueOnce({
      message: "",
      ok: true,
      optionsJson: JSON.stringify(REQUEST_OPTIONS),
    });
    startAuthentication.mockResolvedValueOnce(ASSERTION);

    await renderWithClientMessages(
      <PasskeyAddition.Root
        add={
          <PasskeyAddition.AddForm confirmWith="passkey">
            <input name="tenantId" type="hidden" value="TENANT001" />
            <PasskeyAddition.Added />
            <ActionForm.Submit>Confirm with a passkey</ActionForm.Submit>
          </PasskeyAddition.AddForm>
        }
        name={<p>Name this passkey</p>}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm with a passkey" })
    );

    expect(await screen.findByText("Name this passkey")).toBeDefined();
    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: REQUEST_OPTIONS,
    });
    const begun = beginRegistration.mock.calls[0]?.[0];
    expect(begun?.get("passkeyCredential")).toBe(JSON.stringify(ASSERTION));
  });

  it("begins nothing when the reader closes the confirming passkey's prompt", async () => {
    beginConfirmation.mockResolvedValueOnce({
      message: "",
      ok: true,
      optionsJson: JSON.stringify(REQUEST_OPTIONS),
    });
    startAuthentication.mockRejectedValueOnce(webAuthnError("NotAllowedError"));

    await renderWithClientMessages(
      <PasskeyAddition.Root
        add={
          <PasskeyAddition.AddForm confirmWith="passkey">
            <PasskeyAddition.Added />
            <ActionForm.Submit>Confirm with a passkey</ActionForm.Submit>
          </PasskeyAddition.AddForm>
        }
        name={<p>Name this passkey</p>}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm with a passkey" })
    );

    expect(
      await screen.findByText(
        "The passkey request was cancelled or timed out. Try again."
      )
    ).toBeDefined();
    expect(beginRegistration).not.toHaveBeenCalled();
  });

  it("creates the passkey over the options a provider sign-in left, without beginning again", async () => {
    await renderWithClientMessages(
      <PasskeyAddition.Root
        add={
          <PasskeyAddition.ResumeForm
            optionsJson={JSON.stringify(CREATION_OPTIONS)}
          >
            <PasskeyAddition.Added />
            <ActionForm.Submit>Create the passkey</ActionForm.Submit>
          </PasskeyAddition.ResumeForm>
        }
        name={<p>Name this passkey</p>}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Create the passkey" }));

    expect(await screen.findByText("Name this passkey")).toBeDefined();
    expect(beginRegistration).not.toHaveBeenCalled();
    expect(startRegistration).toHaveBeenCalledWith({
      optionsJSON: CREATION_OPTIONS,
    });
  });
});
