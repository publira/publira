// @vitest-environment jsdom

import type * as ActionForm from "@publira/ui-components/action-form";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

import type { PasskeyConfirmationStartState } from "../_lib/passkey-confirmation-state";
import {
  PasskeyConfirmation,
  PasskeyConfirmationMessage,
  PasskeyConfirmationSubmit,
} from "./passkey-confirmation";

const { begin, browserSupportsWebAuthn, confirm, startAuthentication } =
  vi.hoisted(() => ({
    begin:
      vi.fn<(formData: FormData) => Promise<PasskeyConfirmationStartState>>(),
    browserSupportsWebAuthn: vi.fn<() => boolean>(),
    confirm: vi.fn<(formData: FormData) => Promise<ActionForm.State>>(),
    startAuthentication:
      vi.fn<(options: { optionsJSON: unknown }) => Promise<unknown>>(),
  }));

// jsdom has no WebAuthn; the browser's half of the ceremony is what these
// stand in for.
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn,
  startAuthentication,
}));

/**
 * What `startAuthentication` rejects with: a `WebAuthnError`, an `Error`
 * carrying the name of the `DOMException` the browser threw.
 */
const webAuthnError = (name: string) =>
  Object.assign(new Error(`The ceremony failed: ${name}`), { name });

const REQUEST_OPTIONS = { challenge: "Y2hhbGxlbmdl", rpId: "reader.example" };

const ASSERTION = { id: "credential-id", response: {}, type: "public-key" };

const renderControl = () =>
  renderWithClientMessages(
    <form>
      <input name="tenantId" type="hidden" value="TENANT001" />
      <label>
        New email address
        <input name="newEmail" required type="email" />
      </label>
      <PasskeyConfirmation begin={begin} confirm={confirm}>
        <PasskeyConfirmationSubmit>
          Confirm with a passkey
        </PasskeyConfirmationSubmit>
        <PasskeyConfirmationMessage />
      </PasskeyConfirmation>
    </form>
  );

const confirmButton = () =>
  screen.getByRole("button", { name: "Confirm with a passkey" });

const typeNewEmail = () => {
  fireEvent.change(screen.getByLabelText("New email address"), {
    target: { value: "moved@example.com" },
  });
};

beforeEach(() => {
  browserSupportsWebAuthn.mockReturnValue(true);
  begin.mockResolvedValue({
    message: "",
    ok: true,
    optionsJson: JSON.stringify(REQUEST_OPTIONS),
  });
  startAuthentication.mockResolvedValue(ASSERTION);
  confirm.mockResolvedValue({ message: "Refused.", ok: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PasskeyConfirmation", () => {
  it("offers nothing in a browser without WebAuthn", async () => {
    browserSupportsWebAuthn.mockReturnValue(false);

    await renderControl();

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("confirms the form's fields with the assertion made over the challenge the server began", async () => {
    await renderControl();
    typeNewEmail();
    fireEvent.click(confirmButton());

    expect(await screen.findByText("Refused.")).toBeDefined();
    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: REQUEST_OPTIONS,
    });
    const submitted = confirm.mock.calls[0]?.[0];
    expect(submitted?.get("tenantId")).toBe("TENANT001");
    expect(submitted?.get("newEmail")).toBe("moved@example.com");
    expect(submitted?.get("passkeyCredential")).toBe(JSON.stringify(ASSERTION));
    // A refusal keeps what the reader typed.
    expect(
      (screen.getByLabelText("New email address") as HTMLInputElement).value
    ).toBe("moved@example.com");
  });

  it("asks for nothing while the form's own fields are not filled in", async () => {
    await renderControl();
    fireEvent.click(confirmButton());

    expect(begin).not.toHaveBeenCalled();
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it("stops at a challenge the server would not begin", async () => {
    begin.mockResolvedValueOnce({
      message: "No passkey is registered to your account. Confirm another way.",
      ok: false,
    });

    await renderControl();
    typeNewEmail();
    fireEvent.click(confirmButton());

    expect(
      await screen.findByText(
        "No passkey is registered to your account. Confirm another way."
      )
    ).toBeDefined();
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("says when the reader closed the prompt, and confirms nothing", async () => {
    startAuthentication.mockRejectedValueOnce(webAuthnError("NotAllowedError"));

    await renderControl();
    typeNewEmail();
    fireEvent.click(confirmButton());

    expect(
      await screen.findByText(
        "The passkey request was cancelled or timed out. Try again."
      )
    ).toBeDefined();
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => {
      expect((confirmButton() as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
