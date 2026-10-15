// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import type {
  MfaEnrollmentConfirmState,
  MfaEnrollmentStartState,
  PasskeyCeremonyStartState,
} from "#lib/mfa-action-state";

import { MfaEnrollFlow } from "./mfa-enroll-flow";

const {
  beginPasskey,
  confirm,
  finishPasskey,
  redirect,
  start,
  startRegistration,
} = vi.hoisted(() => ({
  beginPasskey:
    vi.fn<(formData: FormData) => Promise<PasskeyCeremonyStartState>>(),
  confirm:
    vi.fn<
      (
        previousState: MfaEnrollmentConfirmState,
        formData: FormData
      ) => Promise<MfaEnrollmentConfirmState>
    >(),
  finishPasskey:
    vi.fn<(formData: FormData) => Promise<MfaEnrollmentConfirmState>>(),
  redirect: vi.fn<(path: string) => never>(),
  start:
    vi.fn<
      (
        previousState: MfaEnrollmentStartState,
        formData: FormData
      ) => Promise<MfaEnrollmentStartState>
    >(),
  startRegistration: vi.fn<(options: unknown) => Promise<unknown>>(),
}));

// The Actions are `"use server"`, so the module they live in cannot be
// evaluated here at all.
vi.mock("../_lib/actions", () => ({
  beginPasskeyRegistrationAction: beginPasskey,
  confirmMfaEnrollmentAction: confirm,
  finishPasskeyRegistrationAction: finishPasskey,
  startMfaEnrollmentAction: start,
}));

// jsdom has no WebAuthn; the browser's half of the ceremony is what these
// stand in for.
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startRegistration,
}));

vi.mock("next/navigation", () => ({ redirect }));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

// Both resolve an attribute on the server; here they only have to put the
// field and the secret on the screen the way the real ones do.
vi.mock("#components/mfa-code-field", () => ({
  MfaCodeField: () => (
    <label>
      Verification code
      <input name="code" />
    </label>
  ),
}));

vi.mock("#components/mfa-enrollment-secret", async () => {
  const { MfaEnrollmentSecretText } =
    await import("#components/mfa-enrollment");

  return { MfaEnrollmentSecret: MfaEnrollmentSecretText };
});

const renderFlow = (finished = false): ReturnType<typeof render> =>
  render(
    <MfaEnrollFlow
      finished={finished}
      nextPath="/series"
      tenantId="TENANT001"
    />,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AdminLocaleTestProvider locale="en">
          {children}
        </AdminLocaleTestProvider>
      ),
    }
  );

const confirmEnrollment = async () => {
  renderFlow();

  fireEvent.click(
    screen.getByRole("button", { name: "Set up an authenticator app" })
  );
  expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeDefined();

  fireEvent.change(screen.getByLabelText("Verification code"), {
    target: { value: "123456" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Turn on two-step verification" })
  );
  expect(await screen.findByText("AAAAA-BBBBB")).toBeDefined();
};

beforeEach(() => {
  start.mockResolvedValue({
    message: "",
    ok: true,
    qr: { path: "M0 0h1v1H0z", size: 21 },
    secret: "JBSWY3DPEHPK3PXP",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MfaEnrollFlow", () => {
  it("shows the recovery codes and goes on to where the login was heading", async () => {
    confirm.mockResolvedValue({
      message: "",
      ok: true,
      recoveryCodes: ["AAAAA-BBBBB"],
      signedIn: true,
    });

    await confirmEnrollment();

    expect(confirm.mock.calls[0]?.[1].get("code")).toBe("123456");
    expect(
      screen
        .getByRole("link", { name: "Continue to the console" })
        .getAttribute("href")
    ).toBe("/series");
  });

  it("sends the operator back to sign in when no session came with the codes", async () => {
    confirm.mockResolvedValue({
      message: "",
      ok: true,
      recoveryCodes: ["AAAAA-BBBBB"],
      signedIn: false,
    });

    await confirmEnrollment();

    expect(
      screen.getByRole("link", { name: "Back to sign-in" }).getAttribute("href")
    ).toBe("/login");
    expect(
      screen.queryByRole("link", { name: "Continue to the console" })
    ).toBeNull();
  });

  it("keeps the confirm step when the code is refused", async () => {
    confirm.mockResolvedValue({
      message: "The code is incorrect.",
      ok: false,
    });

    renderFlow();

    fireEvent.click(
      screen.getByRole("button", { name: "Set up an authenticator app" })
    );
    fireEvent.change(await screen.findByLabelText("Verification code"), {
      target: { value: "000000" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Turn on two-step verification" })
    );

    expect(await screen.findByText("The code is incorrect.")).toBeDefined();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeDefined();
  });

  it("goes on to where the login was heading when the challenge was spent before this visit", () => {
    redirect.mockImplementation((path) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });

    expect(() => renderFlow(true)).toThrow("NEXT_REDIRECT:/series");
  });

  it("registers a passkey instead and shows the recovery codes it came with", async () => {
    const creationOptions = { challenge: "Y2hhbGxlbmdl", rp: { name: "Seed" } };
    const credential = {
      id: "credential-id",
      response: {},
      type: "public-key",
    };
    beginPasskey.mockResolvedValue({
      message: "",
      ok: true,
      optionsJson: JSON.stringify(creationOptions),
    });
    startRegistration.mockResolvedValue(credential);
    finishPasskey.mockResolvedValue({
      message: "",
      ok: true,
      recoveryCodes: ["CCCCC-DDDDD"],
      signedIn: true,
    });

    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "Set up a passkey" }));

    expect(await screen.findByText("CCCCC-DDDDD")).toBeDefined();
    expect(startRegistration).toHaveBeenCalledWith({
      optionsJSON: creationOptions,
    });
    expect(finishPasskey.mock.calls[0]?.[0].get("credential")).toBe(
      JSON.stringify(credential)
    );
    expect(start).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("link", { name: "Continue to the console" })
        .getAttribute("href")
    ).toBe("/series");
  });

  it("keeps both ways of enrolling when the passkey is refused", async () => {
    beginPasskey.mockResolvedValue({
      message: "",
      ok: true,
      optionsJson: "{}",
    });
    startRegistration.mockRejectedValue(
      Object.assign(new Error("previously registered"), {
        name: "InvalidStateError",
      })
    );

    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "Set up a passkey" }));

    expect(
      await screen.findByText(
        "This passkey is already registered to your account."
      )
    ).toBeDefined();
    expect(finishPasskey).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Set up an authenticator app" })
    ).toBeDefined();
  });
});
