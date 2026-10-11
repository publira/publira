/**
 * Bare paths whose page belongs to one reader rather than to the catalogue.
 * `proxy.ts` decides who may open them, and `robots.txt` keeps crawlers out of
 * them, so the two read the same list.
 */

/**
 * Pages that need a session. `/notifications` is the personal inbox, and
 * `/settings/notifications` is the email-preference screen under `/settings`.
 *
 * `/announcements` is deliberately absent: an announcement is the tenant's word
 * to everyone who opens the site, and the banner above every page links there,
 * so a visitor with no session reads it. What a session adds on that page is
 * read state, which the page itself asks for.
 */
export const MEMBER_PATH_PREFIXES = [
  "/my",
  "/notifications",
  "/settings",
] as const;

/** Pages a signed-in reader is sent away from. */
export const GUEST_ONLY_PATHS = ["/login", "/signup"] as const;

/**
 * The steps of an account flow a mail or a form leads one reader through,
 * each answering a token or a submission of its own.
 */
export const ACCOUNT_FLOW_PATHS = [
  "/confirm-email",
  "/confirm-password",
  "/resend-verification",
  "/reset-password",
  "/verify",
] as const;
