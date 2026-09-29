import type { Page } from "@playwright/test";

import { SIGN_IN_PROVIDER_BASE_URL } from "./urls";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";

/** The Google account a stubbed sign-in answers for. */
export interface GoogleAccount {
  email: string;
  name: string;
  /** Google's stable id for the account, which a link is keyed on. */
  subject: string;
}

/**
 * Sign the ID token a provider would have issued, with the key the E2E stack's
 * server trusts in place of the provider's.
 */
export const signIdToken = async (
  claims: Record<string, unknown>
): Promise<string> => {
  const response = await fetch(`${SIGN_IN_PROVIDER_BASE_URL}/id-tokens`, {
    body: JSON.stringify(claims),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`sign-in-provider refused the claims: ${response.status}`);
  }
  return response.text();
};

const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

/** What `response_mode=form_post` answers with: a form that posts itself. */
const formPostPage = (action: string, fields: Record<string, string>) => `
<!doctype html>
<form method="post" action="${escapeAttribute(action)}">
  ${Object.entries(fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${name}" value="${escapeAttribute(value)}">`
    )
    .join("\n  ")}
</form>
<script>document.forms[0].submit();</script>
`;

/**
 * Stand in for Google's authorization endpoint: the reader is signed in as
 * `account` at once, and the answer is posted to the site's callback with an
 * ID token for the client and nonce the site asked with.
 */
export const stubGoogleSignIn = async (
  page: Page,
  account: GoogleAccount
): Promise<void> => {
  await page.route(`${GOOGLE_AUTHORIZATION_ENDPOINT}**`, async (route) => {
    const request = new URL(route.request().url());
    const idToken = await signIdToken({
      aud: request.searchParams.get("client_id"),
      email: account.email,
      email_verified: true,
      iss: "https://accounts.google.com",
      name: account.name,
      nonce: request.searchParams.get("nonce"),
      sub: account.subject,
    });
    await route.fulfill({
      body: formPostPage(request.searchParams.get("redirect_uri") ?? "", {
        id_token: idToken,
        state: request.searchParams.get("state") ?? "",
      }),
      contentType: "text/html",
    });
  });
};
