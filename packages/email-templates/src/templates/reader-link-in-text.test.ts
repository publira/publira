import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";

/**
 * The reader confirms an address by opening a link that only exists in the mail
 * — the token is stored as a hash. `e2e/src/mail.ts` reads that link out of
 * Mailpit's plain-text alternative with a bare `https?://\S+` match, so the URL
 * has to survive `toPlainText` whole: on one line, and spelled out rather than
 * hidden behind a label.
 */
const linkWithPath = (text: string, pathname: string): URL | undefined => {
  for (const [link] of text.matchAll(/https?:\/\/\S+/gu)) {
    const url = new URL(link);
    if (url.pathname === pathname) {
      return url;
    }
  }
  return undefined;
};

describe("reader auth email links in the plain-text alternative", () => {
  const cases = [
    {
      data: {
        expires_at: "2026-01-02T03:04:05Z",
        tenant_name: "Example Tenant",
        verify_url: "https://tenant.example.com/verify?token=verify-token",
      },
      pathname: "/verify",
      template: "reader_email_verification",
      token: "verify-token",
    },
    {
      data: {
        confirm_url:
          "https://tenant.example.com/confirm-email?token=confirm-token",
        current_email: "reader@example.com",
        expires_at: "2026-01-02T03:04:05Z",
        new_email: "moved@example.com",
        recipient_kind: "new_email",
        tenant_name: "Example Tenant",
      },
      pathname: "/confirm-email",
      template: "reader_email_change_confirmation",
      token: "confirm-token",
    },
    {
      data: {
        expires_at: "2026-01-02T03:04:05Z",
        reset_url:
          "https://tenant.example.com/confirm-password?token=reset-token",
        tenant_name: "Example Tenant",
      },
      pathname: "/confirm-password",
      template: "reader_password_reset",
      token: "reset-token",
    },
  ] as const;

  for (const { data, pathname, template, token } of cases) {
    it(`carries the ${template} token on ${pathname}`, async () => {
      const messages = await loadEmailMessages("ja");
      const result = await renderEmail({
        data,
        locale: "ja",
        messages,
        template,
        timeZone: "Asia/Tokyo",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(
        linkWithPath(result.text, pathname)?.searchParams.get("token")
      ).toBe(token);
    });
  }
});
