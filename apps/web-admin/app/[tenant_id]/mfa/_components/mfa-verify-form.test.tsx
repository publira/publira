// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MfaVerifyState } from "#lib/mfa-action-state";

import { MfaVerifyForm } from "./mfa-verify-form";

const { redirect, verify } = vi.hoisted(() => ({
  redirect: vi.fn<(path: string) => never>(),
  verify:
    vi.fn<
      (
        previousState: MfaVerifyState,
        formData: FormData
      ) => Promise<MfaVerifyState>
    >(),
}));

// The Action is `"use server"`, so the module it lives in cannot be evaluated
// here at all.
vi.mock("../_lib/actions", () => ({ verifyMfaAction: verify }));

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

    render(
      <MfaVerifyForm finished={false} nextPath="/series" tenantId="TENANT001" />
    );
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

    render(
      <MfaVerifyForm finished={false} nextPath="/series" tenantId="TENANT001" />
    );
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

    expect(() =>
      render(<MfaVerifyForm finished nextPath="/series" tenantId="TENANT001" />)
    ).toThrow("NEXT_REDIRECT:/series");
  });
});
