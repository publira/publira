/**
 * The bearer `publira server` accepts from this app, as the app rather than as
 * an operator, on the admin API's tenant-level reads: the answers every
 * operator of a tenant sees alike, which `"use cache"` then keeps once per
 * tenant instead of once per session.
 *
 * Required. Falling back to the operator's session instead would only move the
 * failure: the reads it signs run inside a shared cache scope, which cannot
 * read the session cookie at all.
 */
export const resolveWebServiceToken = (): string => {
  const token = process.env.PUBLIRA_WEB_SERVICE_TOKEN?.trim() ?? "";
  if (!token) {
    throw new Error(
      "PUBLIRA_WEB_SERVICE_TOKEN is not set: web-admin reads the tenant's catalog with the token publira server accepts as PUBLIRA_WEB_SERVICE_TOKEN"
    );
  }
  return token;
};
