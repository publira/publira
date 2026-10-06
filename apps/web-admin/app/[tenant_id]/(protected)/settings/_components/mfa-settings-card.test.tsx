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
import { Activity } from "react";
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

/**
 * How long a case waits for something to reach the screen: the card's content
 * behind its `Suspense` boundaries, or what a mocked Action returned. Both land
 * well inside the 1000ms `findBy*` default on an idle machine, but not on a
 * runner busy with the whole `Test / TypeScript` job, where a wait has been
 * seen to take longer than that.
 */
const onScreen = { timeout: 5000 };

/**
 * The longest case waits on the screen five times, so a case is given room for
 * every one of those waits to use its whole budget.
 */
const caseTimeout = 5 * onScreen.timeout;

// The button is waited for rather than read straight after `render`: until the
// boundaries around its label resolve, the button has no name to find it by.
const formOf = async (buttonName: string) => {
  const button = await screen.findByRole(
    "button",
    { name: buttonName },
    onScreen
  );
  const form = button.closest("form");
  if (!form) {
    throw new Error(`${buttonName} is not inside a form`);
  }

  return within(form);
};

const submitCode = async (buttonName: string, code: string) => {
  const form = await formOf(buttonName);
  fireEvent.change(form.getByLabelText("Verification code"), {
    target: { value: code },
  });
  fireEvent.click(form.getByRole("button", { name: buttonName }));
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MfaSettingsCard", { timeout: caseTimeout }, () => {
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

    fireEvent.click(
      await screen.findByRole("button", { name: "Set up" }, onScreen)
    );
    expect(
      await screen.findByText("JBSWY3DPEHPK3PXP", {}, onScreen)
    ).toBeDefined();

    await submitCode("Turn on two-step verification", "123456");
    expect(await screen.findByText("AAAAA-BBBBB", {}, onScreen)).toBeDefined();

    const submitted = confirm.mock.calls[0]?.[1];
    expect(submitted?.get("code")).toBe("123456");
    expect(submitted?.get("tenant_id")).toBe("TENANT001");

    rerender(<MfaSettingsCard status={enabled} tenantId="TENANT001" />);

    expect(
      await screen.findByRole("button", { name: "Regenerate" }, onScreen)
    ).toBeDefined();
    expect(screen.getByText("Two-step verification is now on.")).toBeDefined();
    expect(screen.getByText("AAAAA-BBBBB")).toBeDefined();
    expect(screen.getByText("CCCCC-DDDDD")).toBeDefined();
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

    await submitCode("Regenerate", "123456");
    expect(await screen.findByText("EEEEE-FFFFF", {}, onScreen)).toBeDefined();

    await submitCode("Regenerate", "000000");
    expect(
      await screen.findByText("The code is incorrect.", {}, onScreen)
    ).toBeDefined();
    expect(screen.getByText("EEEEE-FFFFF")).toBeDefined();
    expect(
      screen.getByText("New recovery codes have been issued.")
    ).toBeDefined();
  });

  // The router keeps a page it leaves inside a hidden Activity and shows it
  // again on Back, which must not bring the codes back with it.
  it("drops the codes when the page is hidden and shown again", async () => {
    regenerate.mockResolvedValue({
      message: "New recovery codes have been issued.",
      ok: true,
      recoveryCodes: ["EEEEE-FFFFF"],
    });

    const { rerender } = render(
      <Activity mode="visible">
        <MfaSettingsCard status={enabled} tenantId="TENANT001" />
      </Activity>
    );

    await submitCode("Regenerate", "123456");
    expect(await screen.findByText("EEEEE-FFFFF", {}, onScreen)).toBeDefined();

    rerender(
      <Activity mode="hidden">
        <MfaSettingsCard status={enabled} tenantId="TENANT001" />
      </Activity>
    );
    rerender(
      <Activity mode="visible">
        <MfaSettingsCard status={enabled} tenantId="TENANT001" />
      </Activity>
    );

    expect(
      await screen.findByRole("button", { name: "Regenerate" }, onScreen)
    ).toBeDefined();
    expect(screen.queryByText("EEEEE-FFFFF")).toBeNull();
    expect(
      screen.queryByText("New recovery codes have been issued.")
    ).toBeNull();
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

    await submitCode("Regenerate", "123456");
    expect(await screen.findByText("EEEEE-FFFFF", {}, onScreen)).toBeDefined();

    await submitCode("Turn off", "654321");
    expect(
      await screen.findByText(
        "Two-step verification has been turned off.",
        {},
        onScreen
      )
    ).toBeDefined();

    rerender(<MfaSettingsCard status={disabled} tenantId="TENANT001" />);

    expect(
      await screen.findByRole("button", { name: "Set up" }, onScreen)
    ).toBeDefined();
    expect(
      screen.getByText("Two-step verification has been turned off.")
    ).toBeDefined();
    expect(screen.queryByText("EEEEE-FFFFF")).toBeNull();
  });
});
