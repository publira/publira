import { getPlatformLocale } from "./locale";
import { getMessagesFor } from "./messages";
import type { PlatformMessageAccessor } from "./messages";

/**
 * The catalog accessor for this request's locale.
 *
 * The one `await` a Server Component needs before it can name a string:
 *
 * ```ts
 * const t = await getMessages();
 *
 * return { title: t("platform.auth.login.title") };
 * ```
 *
 * It is for the positions a `ReactNode` cannot fill — `generateMetadata`, an
 * HTML attribute such as `placeholder` or `aria-label`, a message crossing into
 * a Server Action, a zod schema's wording. Copy that is rendered as a node is a
 * `<Message>` behind its own `<Suspense>`, so the card, the inputs, and the
 * buttons around it stay in the static shell.
 *
 * **Inside `<Suspense>` only, and never from a `"use cache"` scope.** Resolving
 * the locale reads the `publira_locale` cookie, so this carries the same rule
 * `getPlatformLocale` does: a read above a boundary costs the route its static
 * shell, and a read inside a cache scope bakes one request's language into the
 * entry. Code that is handed a locale instead calls `getMessagesFor`.
 */
export const getMessages = async (): Promise<PlatformMessageAccessor> => {
  const locale = await getPlatformLocale();

  return getMessagesFor(locale);
};
