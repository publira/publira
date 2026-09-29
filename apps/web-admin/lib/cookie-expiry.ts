/**
 * The one place web-admin turns an instant into a `Date`.
 *
 * `sessionCookieOptions` takes `expires` as a `Date` because the Next.js cookie
 * API does, and it accepts nothing else. Every value upstream of this function
 * is a `Temporal.Instant` — an API timestamp is parsed with `parseInstant`,
 * never with `Date` — so the conversion happens here, at the boundary, and this
 * module is the only web-admin file listed in the `no-restricted-globals`
 * exemption in `oxlint.config.ts`.
 */
export const toCookieExpires = (expiresAt: Temporal.Instant): Date =>
  new Date(expiresAt.epochMilliseconds);
