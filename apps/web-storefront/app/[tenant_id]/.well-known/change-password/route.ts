/**
 * The change-password URL a password manager opens for this site
 * (https://w3c.github.io/webappsec-change-password-url/), answered with a
 * temporary redirect to the security settings as that spec asks.
 *
 * The `Location` is relative, so the reader stays on the host they asked, and
 * unprefixed, so the proxy settles the locale and the sign-in a member page
 * needs exactly as it does for any other link to `/settings/security`.
 */
export const GET = () =>
  new Response(null, {
    headers: { Location: "/settings/security" },
    status: 302,
  });
