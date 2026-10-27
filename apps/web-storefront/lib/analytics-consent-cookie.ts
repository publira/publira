import { profileCookieName } from "@publira/web-session/cookie-name";

/**
 * The reader's answer on the site's consent banner, kept where the tenant asks
 * before its Google tag runs. It holds `granted` or `denied` and nothing else.
 *
 * The browser writes it and reads it, because the answer decides what a page
 * loads after hydration, so it is not `HttpOnly`. The name reaches the client
 * as a prop rather than an import: `profileCookieName` reads
 * `PUBLIRA_COOKIE_SUFFIX`, which only the server has.
 */
export const ANALYTICS_CONSENT_COOKIE_NAME = profileCookieName(
  "publira_web_storefront_analytics_consent"
);
