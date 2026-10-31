// @vitest-environment jsdom

import * as ActionForm from "@publira/ui-components/action-form";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

import type {
  PasskeyLoginStartState,
  PasskeyLoginState,
} from "../_lib/passkey-login-state";
import { PasskeySignIn } from "./passkey-sign-in";

const {
  beginPasskeyLogin,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  cancelCeremony,
  finishPasskeyLogin,
  startAuthentication,
} = vi.hoisted(() => ({
  beginPasskeyLogin:
    vi.fn<(formData: FormData) => Promise<PasskeyLoginStartState>>(),
  browserSupportsWebAuthn: vi.fn<() => boolean>(),
  browserSupportsWebAuthnAutofill: vi.fn<() => Promise<boolean>>(),
  cancelCeremony: vi.fn<() => void>(),
  finishPasskeyLogin:
    vi.fn<(formData: FormData) => Promise<PasskeyLoginState>>(),
  startAuthentication:
    vi.fn<
      (options: {
        optionsJSON: unknown;
        useBrowserAutofill?: boolean;
      }) => Promise<unknown>
    >(),
}));

// The Actions are `"use server"`, so the module they live in cannot be
// evaluated here at all.
vi.mock("../_lib/actions", () => ({
  beginPasskeyLoginAction: beginPasskeyLogin,
  finishPasskeyLoginAction: finishPasskeyLogin,
}));

// jsdom has no WebAuthn; the browser's half of the ceremony is what these
// stand in for.
vi.mock("@simplewebauthn/browser", () => ({
  WebAuthnAbortService: { cancelCeremony },
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
    <PasskeySignIn>
      <input name="locale" type="hidden" value="en" />
      <input name="tenantId" type="hidden" value={TENANT_ID} />
      <input name="returnTo" type="hidden" value="/my" />
      <ActionForm.Submit>Sign in with a passkey</ActionForm.Submit>
    </PasskeySignIn>
  );

const signInButton = () =>
  screen.getByRole("button", { name: "Sign in with a passkey" });

beforeEach(() => {
  browserSupportsWebAuthn.mockReturnValue(true);
  browserSupportsWebAuthnAutofill.mockResolvedValue(false);
  beginPasskeyLogin.mockResolvedValue({
    message: "",
    ok: true,
    optionsJson: JSON.stringify(REQUEST_OPTIONS),
  });
  startAuthentication.mockResolvedValue(ASSERTION);
  finishPasskeyLogin.mockResolvedValue({
    message: "That passkey was not accepted.",
    ok: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PasskeySignIn", () => {
  it("offers nothing in a browser without WebAuthn", async () => {
    browserSupportsWebAuthn.mockReturnValue(false);

    await renderControl();

    expect(screen.queryByRole("button")).toBeNull();
    expect(browserSupportsWebAuthnAutofill).not.toHaveBeenCalled();
    expect(beginPasskeyLogin).not.toHaveBeenCalled();
  });

  it("asks for a passkey with the options the server began and finishes with the assertion", async () => {
    await renderControl();
    fireEvent.click(signInButton());

    expect(
      await screen.findByText("That passkey was not accepted.")
    ).toBeDefined();
    expect(beginPasskeyLogin.mock.calls[0]?.[0].get("tenantId")).toBe(
      TENANT_ID
    );
    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: REQUEST_OPTIONS,
    });
    const finished = finishPasskeyLogin.mock.calls[0]?.[0];
    expect(finished?.get("credential")).toBe(JSON.stringify(ASSERTION));
    expect(finished?.get("returnTo")).toBe("/my");
    expect(finished?.get("tenantId")).toBe(TENANT_ID);
  });

  it("says why the sign-in could not begin", async () => {
    beginPasskeyLogin.mockResolvedValue({
      message: "Too many requests in a short time.",
      ok: false,
    });

    await renderControl();
    fireEvent.click(signInButton());

    expect(
      await screen.findByText("Too many requests in a short time.")
    ).toBeDefined();
    expect(startAuthentication).not.toHaveBeenCalled();
    expect(finishPasskeyLogin).not.toHaveBeenCalled();
  });

  it("returns to the form when the reader closes the prompt", async () => {
    startAuthentication.mockRejectedValue(webAuthnError("NotAllowedError"));

    await renderControl();
    fireEvent.click(signInButton());

    expect(
      await screen.findByText(
        "The passkey request was cancelled or timed out. Try again, or sign in with your email address and password."
      )
    ).toBeDefined();
    expect(finishPasskeyLogin).not.toHaveBeenCalled();
    expect(signInButton()).toBeDefined();
  });

  it("reports an authenticator that failed apart from a closed prompt", async () => {
    startAuthentication.mockRejectedValue(webAuthnError("SecurityError"));

    await renderControl();
    fireEvent.click(signInButton());

    expect(
      await screen.findByText(
        "Could not sign in with this passkey. Try again, or sign in with your email address and password."
      )
    ).toBeDefined();
    expect(finishPasskeyLogin).not.toHaveBeenCalled();
  });
});

describe("PasskeySignIn in the autofill", () => {
  it("offers the passkeys in the autofill and finishes with the one the reader picks", async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);

    await renderControl();

    expect(
      await screen.findByText("That passkey was not accepted.")
    ).toBeDefined();
    expect(beginPasskeyLogin).toHaveBeenCalledTimes(1);
    expect(beginPasskeyLogin.mock.calls[0]?.[0].get("tenantId")).toBe(
      TENANT_ID
    );
    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: REQUEST_OPTIONS,
      useBrowserAutofill: true,
    });
    const finished = finishPasskeyLogin.mock.calls[0]?.[0];
    expect(finished?.get("credential")).toBe(JSON.stringify(ASSERTION));
    expect(finished?.get("returnTo")).toBe("/my");
  });

  it("starts no autofill request once the button has asked for a passkey", async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);

    const { promise: autofillStarted, resolve: startAutofill } =
      Promise.withResolvers<PasskeyLoginStartState>();

    beginPasskeyLogin.mockReturnValueOnce(autofillStarted);

    await renderControl();
    await waitFor(() => {
      expect(beginPasskeyLogin).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(signInButton());
    expect(
      await screen.findByText("That passkey was not accepted.")
    ).toBeDefined();

    startAutofill({
      message: "",
      ok: true,
      optionsJson: JSON.stringify(REQUEST_OPTIONS),
    });
    await autofillStarted;

    expect(startAuthentication).toHaveBeenCalledTimes(1);
    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: REQUEST_OPTIONS,
    });
  });

  it("leaves the form untouched when the autofill request is stopped", async () => {
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    startAuthentication.mockRejectedValue(webAuthnError("AbortError"));

    await renderControl();

    await waitFor(() => {
      expect(startAuthentication).toHaveBeenCalledTimes(1);
    });
    expect(finishPasskeyLogin).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("asks for nothing where the browser has no passkey autofill", async () => {
    await renderControl();

    await waitFor(() => {
      expect(browserSupportsWebAuthnAutofill).toHaveBeenCalled();
    });
    expect(beginPasskeyLogin).not.toHaveBeenCalled();
    expect(signInButton()).toBeDefined();
  });

  it("stops offering the passkeys once the control is gone", async () => {
    const { unmount } = await renderControl();

    unmount();

    expect(cancelCeremony).toHaveBeenCalled();
  });
});
