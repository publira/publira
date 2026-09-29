// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminMfaStatus } from "#lib/admin-mfa";
import type {
  MfaEnrollmentConfirmState,
  MfaEnrollmentStartState,
  MfaRecoveryCodesState,
} from "#lib/mfa-action-state";

import { MfaSettingsCard } from "./mfa-settings-card";

const { confirm, disable, regenerate, start } = vi.hoisted(() => ({
  confirm:
    vi.fn<
      (
        previousState: MfaEnrollmentConfirmState,
        formData: FormData
      ) => Promise<MfaEnrollmentConfirmState>
    >(),
  disable:
    vi.fn<
      (
        previousState: FormActionState,
        formData: FormData
      ) => Promise<FormActionState>
    >(),
  regenerate:
    vi.fn<
      (
        previousState: MfaRecoveryCodesState,
        formData: FormData
      ) => Promise<MfaRecoveryCodesState>
    >(),
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
vi.mock("../_lib/mfa-actions", () => ({
  confirmAccountMfaEnrollmentAction: confirm,
  disableAccountMfaAction: disable,
  regenerateAccountMfaRecoveryCodesAction: regenerate,
  startAccountMfaEnrollmentAction: start,
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

const disabled: AdminMfaStatus = {
  enabled: false,
  remainingRecoveryCodes: 0,
  required: false,
};

const enabled: AdminMfaStatus = {
  enabled: true,
  remainingRecoveryCodes: 10,
  required: false,
};

const formOf = (buttonName: string) => {
  const form = screen.getByRole("button", { name: buttonName }).closest("form");
  if (!form) {
    throw new Error(`${buttonName} is not inside a form`);
  }

  return within(form);
};

const submitCode = (buttonName: string, code: string) => {
  const form = formOf(buttonName);
  fireEvent.change(form.getByLabelText("Verification code"), {
    target: { value: code },
  });
  fireEvent.click(form.getByRole("button", { name: buttonName }));
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MfaSettingsCard", () => {
  // Confirming the enrollment turns the factor on, and the card that comes
  // back holds the enabled forms instead; the codes are shown only now.
  it("keeps the recovery codes an enrollment issued once the card turns to the enabled forms", async () => {
    start.mockResolvedValue({
      message: "",
      ok: true,
      qr: { path: "M0 0h1v1H0z", size: 21 },
      secret: "JBSWY3DPEHPK3PXP",
    });
    confirm.mockResolvedValue({
      message: "Two-step verification is now on.",
      ok: true,
      recoveryCodes: ["AAAAA-BBBBB", "CCCCC-DDDDD"],
      signedIn: true,
    });

    const { rerender } = render(
      <MfaSettingsCard status={disabled} tenantId="TENANT001" />
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeDefined();

    submitCode("Turn on two-step verification", "123456");
    expect(await screen.findByText("AAAAA-BBBBB")).toBeDefined();

    const submitted = confirm.mock.calls[0]?.[1];
    expect(submitted?.get("code")).toBe("123456");
    expect(submitted?.get("tenant_id")).toBe("TENANT001");

    rerender(<MfaSettingsCard status={enabled} tenantId="TENANT001" />);

    expect(screen.getByText("Two-step verification is now on.")).toBeDefined();
    expect(screen.getByText("AAAAA-BBBBB")).toBeDefined();
    expect(screen.getByText("CCCCC-DDDDD")).toBeDefined();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDefined();
  });

  it("keeps the codes a regeneration issued when a later one is refused", async () => {
    regenerate
      .mockResolvedValueOnce({
        message: "New recovery codes have been issued.",
        ok: true,
        recoveryCodes: ["EEEEE-FFFFF"],
      })
      .mockResolvedValueOnce({ message: "The code is incorrect.", ok: false });

    render(<MfaSettingsCard status={enabled} tenantId="TENANT001" />);

    submitCode("Regenerate", "123456");
    expect(await screen.findByText("EEEEE-FFFFF")).toBeDefined();

    submitCode("Regenerate", "000000");
    expect(await screen.findByText("The code is incorrect.")).toBeDefined();
    expect(screen.getByText("EEEEE-FFFFF")).toBeDefined();
    expect(
      screen.getByText("New recovery codes have been issued.")
    ).toBeDefined();
  });

  it("drops the codes once the factor is turned off", async () => {
    regenerate.mockResolvedValue({
      message: "New recovery codes have been issued.",
      ok: true,
      recoveryCodes: ["EEEEE-FFFFF"],
    });
    disable.mockResolvedValue({
      message: "Two-step verification has been turned off.",
      ok: true,
    });

    const { rerender } = render(
      <MfaSettingsCard status={enabled} tenantId="TENANT001" />
    );

    submitCode("Regenerate", "123456");
    expect(await screen.findByText("EEEEE-FFFFF")).toBeDefined();

    submitCode("Turn off", "654321");
    expect(
      await screen.findByText("Two-step verification has been turned off.")
    ).toBeDefined();

    rerender(<MfaSettingsCard status={disabled} tenantId="TENANT001" />);

    expect(
      screen.getByText("Two-step verification has been turned off.")
    ).toBeDefined();
    expect(screen.queryByText("EEEEE-FFFFF")).toBeNull();
    expect(screen.getByRole("button", { name: "Set up" })).toBeDefined();
  });
});
