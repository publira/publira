/**
 * The change-password URL a password manager opens for this console
 * (https://www.w3.org/TR/change-password-url/), answered with a temporary
 * redirect as that spec asks.
 *
 * The console has no form that changes a password from a session, so the
 * target is the reset flow, which is how an operator changes it whether signed
 * in or not. Once `/account` gains such a form, this points there.
 */
export const GET = () =>
  new Response(null, {
    headers: { Location: "/reset-password" },
    status: 302,
  });
