// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MfaEnrollmentConfirmState,
  MfaEnrollmentStartState,
} from "#lib/mfa-action-state";

import { MfaEnrollFlow } from "./mfa-enroll-flow";

const { confirm, redirect, start } = vi.hoisted(() => ({
  confirm:
    vi.fn<
      (
        previousState: MfaEnrollmentConfirmState,
        formData: FormData
      ) => Promise<MfaEnrollmentConfirmState>
    >(),
  redirect: vi.fn<(path: string) => never>(),
  start:
    vi.fn<
      (
        previousState: MfaEnrollmentStartState,
        formData: FormData
      ) => Promise<MfaEnrollmentStartState>
    >(),
}));

// The Actions are `"use server"`, so the module they live in cannot be
// evaluated here at all.
vi.mock("../_lib/actions", () => ({
  confirmMfaEnrollmentAction: confirm,
  startMfaEnrollmentAction: start,
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

const confirmEnrollment = async () => {
  render(<MfaEnrollFlow finished={false} nextPath="/tenants" />);

  fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
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
  it("shows the recovery codes and goes on to where the sign-in was heading", async () => {
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
        .getByRole("link", { name: "Continue to the Platform Console" })
        .getAttribute("href")
    ).toBe("/tenants");
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
      screen.queryByRole("link", { name: "Continue to the Platform Console" })
    ).toBeNull();
  });

  it("keeps the confirm step when the code is refused", async () => {
    confirm.mockResolvedValue({
      message: "The code is incorrect.",
      ok: false,
    });

    render(<MfaEnrollFlow finished={false} nextPath="/tenants" />);

    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    fireEvent.change(await screen.findByLabelText("Verification code"), {
      target: { value: "000000" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Turn on two-step verification" })
    );

    expect(await screen.findByText("The code is incorrect.")).toBeDefined();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeDefined();
  });

  it("goes on to where the sign-in was heading when the challenge was spent before this visit", () => {
    redirect.mockImplementation((path) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });

    expect(() =>
      render(<MfaEnrollFlow finished nextPath="/tenants" />)
    ).toThrow("NEXT_REDIRECT:/tenants");
  });
});
