import { Code, ConnectError } from "@publira/api-client/errors";
import { describe, expect, it, vi } from "vitest";

import {
  confirmPlatformPasswordReset,
  requestPlatformPasswordReset,
} from "./password-reset";

const { mockConfirmPasswordReset, mockRequestPasswordReset } = vi.hoisted(
  () => ({
    mockConfirmPasswordReset: vi.fn(),
    mockRequestPasswordReset: vi.fn(),
  })
);

vi.mock("@publira/api-client/platform/client", () => ({
  createPlatformApiClient: () => ({
    auth: {
      confirmPasswordReset: mockConfirmPasswordReset,
      requestPasswordReset: mockRequestPasswordReset,
    },
    setup: {},
  }),
}));

describe("requestPlatformPasswordReset", () => {
  it("returns requested unchanged when the API succeeds", async () => {
    mockRequestPasswordReset.mockResolvedValueOnce({ requested: true });

    await expect(
      requestPlatformPasswordReset("operator@example.com", "en")
    ).resolves.toEqual({ ok: true, requested: true });
  });

  it("replaces invalid_argument with email-specific copy", async () => {
    mockRequestPasswordReset.mockRejectedValueOnce(
      new ConnectError("invalid email", Code.InvalidArgument)
    );

    await expect(
      requestPlatformPasswordReset("invalid", "en")
    ).resolves.toEqual({
      message: "Check the email address.",
      ok: false,
    });
  });

  it("words that copy in the locale it was given, so locale=ja is Japanese", async () => {
    mockRequestPasswordReset.mockRejectedValueOnce(
      new ConnectError("invalid email", Code.InvalidArgument)
    );

    await expect(
      requestPlatformPasswordReset("invalid", "ja")
    ).resolves.toEqual({
      message: "メールアドレスを確認してください。",
      ok: false,
    });
  });

  it("rejects an empty email address with localized copy without calling RPC", async () => {
    await expect(requestPlatformPasswordReset("   ", "en")).resolves.toEqual({
      message: "Enter your email address.",
      ok: false,
    });
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });

  it("propagates unclassified RPC errors", async () => {
    mockRequestPasswordReset.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      requestPlatformPasswordReset("operator@example.com", "en")
    ).rejects.toThrow("boom");
  });
});

describe("confirmPlatformPasswordReset", () => {
  const TOKEN = "a".repeat(64);

  it("treats failed_precondition as an expired link", async () => {
    mockConfirmPasswordReset.mockRejectedValueOnce(
      new ConnectError("expired", Code.FailedPrecondition)
    );

    await expect(
      confirmPlatformPasswordReset(TOKEN, "new-password", "en")
    ).resolves.toEqual({
      message: "This reset link has expired. Request the reset email again.",
      ok: false,
      reason: "expired",
    });
  });

  it("treats not_found as an invalid link", async () => {
    mockConfirmPasswordReset.mockRejectedValueOnce(
      new ConnectError("unknown token", Code.NotFound)
    );

    await expect(
      confirmPlatformPasswordReset(TOKEN, "new-password", "en")
    ).resolves.toEqual({
      message: "This reset link is invalid. Request the reset email again.",
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects an empty password without calling RPC", async () => {
    await expect(
      confirmPlatformPasswordReset(TOKEN, "   ", "en")
    ).resolves.toEqual({
      message: "Enter a new password.",
      ok: false,
      reason: "system",
    });
    expect(mockConfirmPasswordReset).not.toHaveBeenCalled();
  });

  it("propagates unclassified RPC errors", async () => {
    mockConfirmPasswordReset.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      confirmPlatformPasswordReset(TOKEN, "new-password", "en")
    ).rejects.toThrow("boom");
  });
});
