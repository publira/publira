/**
 * The bearer `publira server` accepts from this app, as the app rather than as
 * an operator, on the platform API's platform-level reads: the answers every
 * operator sees alike, which `"use cache"` then keeps once for the platform
 * instead of once per session.
 *
 * Required. Falling back to the operator's session instead would only move the
 * failure: the reads it signs run inside a shared cache scope, which cannot
 * read the session cookie at all.
 */
export const resolveWebServiceToken = (): string => {
  const token = process.env.PUBLIRA_WEB_SERVICE_TOKEN?.trim() ?? "";
  if (!token) {
    throw new Error(
      "PUBLIRA_WEB_SERVICE_TOKEN is not set: web-platform reads the platform's tenants, settings, operators, and end users with the token publira server accepts as PUBLIRA_WEB_SERVICE_TOKEN"
    );
  }
  return token;
};
