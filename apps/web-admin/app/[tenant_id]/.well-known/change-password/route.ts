/**
 * The change-password URL a password manager opens for this console
 * (https://www.w3.org/TR/change-password-url/), answered with a temporary
 * redirect as that spec asks.
 *
 * The console has no form that changes a password from a session, so the
 * target is the reset flow, which is how a member changes it whether signed
 * in or not. Once `/settings/account` gains such a form, this points there.
 * The `Location` is relative, so the member stays on the console domain they
 * asked.
 */
export const GET = () =>
  new Response(null, {
    headers: { Location: "/forgot-password" },
    status: 302,
  });
