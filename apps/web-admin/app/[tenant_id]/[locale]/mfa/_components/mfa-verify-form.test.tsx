// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type {
  AuthenticationResponseJSON,
  StartAuthenticationOpts,
} from "@simplewebauthn/browser";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import type {
  MfaVerifyState,
  PasskeyCeremonyStartState,
} from "#lib/mfa-action-state";
import type { MfaMethodName } from "#lib/mfa-challenge";

import { MfaVerifyForm } from "./mfa-verify-form";

const {
  beginPasskey,
  browserSupportsWebAuthn,
  finishPasskey,
  redirect,
  startAuthentication,
  verify,
} = vi.hoisted(() => ({
  beginPasskey:
    vi.fn<(formData: FormData) => Promise<PasskeyCeremonyStartState>>(),
  browserSupportsWebAuthn: vi.fn<() => boolean>(),
  finishPasskey: vi.fn<(formData: FormData) => Promise<MfaVerifyState>>(),
  redirect: vi.fn<(path: string) => never>(),
  startAuthentication:
    vi.fn<
      (
        options: StartAuthenticationOpts
      ) => Promise<Pick<AuthenticationResponseJSON, "id">>
    >(),
  verify:
    vi.fn<
      (
        previousState: MfaVerifyState,
        formData: FormData
      ) => Promise<MfaVerifyState>
    >(),
}));

// The Actions are `"use server"`, so the module they live in cannot be
// evaluated here at all.
vi.mock("../_lib/actions", () => ({
  beginPasskeyVerificationAction: beginPasskey,
  finishPasskeyVerificationAction: finishPasskey,
  verifyMfaAction: verify,
}));

// jsdom has no WebAuthn; the browser's half of the ceremony is what these
// stand in for.
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn,
  startAuthentication,
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

// The field resolves its placeholder on the server; here it only has to join
// the form the way the real one does.
vi.mock("#components/mfa-code-field", () => ({
  MfaCodeField: () => (
    <label>
      Verification code
      <input name="code" />
    </label>
  ),
}));

const submitCode = (code: string) => {
  fireEvent.change(
    screen.getByLabelText<HTMLInputElement>("Verification code"),
    {
      target: { value: code },
    }
  );
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
};

const renderForm = (
  methods: readonly MfaMethodName[],
  finished = false
): ReturnType<typeof render> =>
  render(
    <MfaVerifyForm
      finished={finished}
      methods={methods}
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

const REQUEST_OPTIONS = {
  challenge: "Y2hhbGxlbmdl",
  rpId: "admin.example.com",
};

const ASSERTION = { id: "credential-id", response: {}, type: "public-key" };

beforeEach(() => {
  browserSupportsWebAuthn.mockReturnValue(true);
  beginPasskey.mockResolvedValue({
    message: "",
    ok: true,
    optionsJson: JSON.stringify(REQUEST_OPTIONS),
  });
  startAuthentication.mockResolvedValue(ASSERTION);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MfaVerifyForm", () => {
  it("says how many recovery codes are left once one is spent", async () => {
    verify.mockResolvedValue({
      message: "9 recovery codes are left.",
      ok: true,
    });

    renderForm(["totp"]);
    submitCode("ABCDE-FGHJK");

    expect(
      await screen.findByText("Signed in with a recovery code")
    ).toBeDefined();
    expect(screen.getByText("9 recovery codes are left.")).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Continue to the console" })
        .getAttribute("href")
    ).toBe("/series");
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();

    const submitted = verify.mock.calls[0]?.[1];
    expect(submitted?.get("code")).toBe("ABCDE-FGHJK");
    expect(submitted?.get("tenant_id")).toBe("TENANT001");
  });

  it("keeps the form and what was typed when the code is refused", async () => {
    verify.mockResolvedValue({ message: "The code is incorrect.", ok: false });

    renderForm(["totp"]);
    submitCode("000000");

    expect(await screen.findByText("The code is incorrect.")).toBeDefined();
    expect(
      screen.getByLabelText<HTMLInputElement>("Verification code").value
    ).toBe("000000");
  });

  it("goes on to where the login was heading when the challenge was spent before this visit", () => {
    redirect.mockImplementation((path) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });

    expect(() => renderForm(["totp"], true)).toThrow("NEXT_REDIRECT:/series");
  });

  it("offers no passkey to an account without one", () => {
    renderForm(["totp"]);

    expect(screen.getByLabelText("Verification code")).toBeDefined();
    expect(screen.queryByRole("button", { name: /passkey/u })).toBeNull();
  });
});

describe("MfaVerifyForm with a passkey", () => {
  it("offers the passkey first, and the code form one click away and back", () => {
    renderForm(["totp", "passkey"]);

    expect(screen.getByRole("button", { name: "Use a passkey" })).toBeDefined();
    expect(screen.queryByLabelText("Verification code")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Enter a code instead" })
    );
    expect(screen.getByLabelText("Verification code")).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Use a passkey instead" })
    );
    expect(screen.getByRole("button", { name: "Use a passkey" })).toBeDefined();
  });

  it("asks an account whose only other factor is a passkey for a recovery code", () => {
    renderForm(["passkey"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Enter a recovery code instead" })
    );

    expect(
      screen.getByText("Enter one of your recovery codes to finish signing in.")
    ).toBeDefined();
  });

  it("runs the ceremony with the options the server began and finishes with its credential", async () => {
    finishPasskey.mockResolvedValue({
      message: "That passkey was not accepted.",
      ok: false,
    });

    renderForm(["passkey"]);
    fireEvent.click(screen.getByRole("button", { name: "Use a passkey" }));

    expect(
      await screen.findByText("That passkey was not accepted.")
    ).toBeDefined();
    expect(beginPasskey.mock.calls[0]?.[0].get("tenant_id")).toBe("TENANT001");
    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: REQUEST_OPTIONS,
    });
    const finished = finishPasskey.mock.calls[0]?.[0];
    expect(finished?.get("tenant_id")).toBe("TENANT001");
    expect(finished?.get("credential")).toBe(JSON.stringify(ASSERTION));
  });

  it("says why the ceremony could not begin", async () => {
    beginPasskey.mockResolvedValue({
      message: "No passkey is registered to this account.",
      ok: false,
    });

    renderForm(["passkey"]);
    fireEvent.click(screen.getByRole("button", { name: "Use a passkey" }));

    expect(
      await screen.findByText("No passkey is registered to this account.")
    ).toBeDefined();
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it("turns a browser without WebAuthn away before beginning anything", async () => {
    browserSupportsWebAuthn.mockReturnValue(false);

    renderForm(["passkey", "totp"]);
    fireEvent.click(screen.getByRole("button", { name: "Use a passkey" }));

    expect(
      await screen.findByText(
        "This browser cannot use a passkey. Use another way to verify."
      )
    ).toBeDefined();
    expect(beginPasskey).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Enter a code instead" })
    ).toBeDefined();
  });

  it("says a closed or timed-out prompt was cancelled, and finishes nothing", async () => {
    startAuthentication.mockRejectedValue(
      Object.assign(
        new Error("The operation either timed out or was not allowed."),
        {
          name: "NotAllowedError",
        }
      )
    );

    renderForm(["passkey", "totp"]);
    fireEvent.click(screen.getByRole("button", { name: "Use a passkey" }));

    expect(
      await screen.findByText(
        "The passkey request was cancelled or timed out. Try again."
      )
    ).toBeDefined();
    expect(finishPasskey).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Enter a code instead" })
    ).toBeDefined();
  });

  it("reports any other failure of the browser's ceremony as one to retry", async () => {
    startAuthentication.mockRejectedValue(
      Object.assign(new Error("invalid domain"), { name: "SecurityError" })
    );

    renderForm(["passkey"]);
    fireEvent.click(screen.getByRole("button", { name: "Use a passkey" }));

    expect(
      await screen.findByText(
        "The passkey could not be used. Try again, or use another way to verify."
      )
    ).toBeDefined();
    expect(finishPasskey).not.toHaveBeenCalled();
  });
});
