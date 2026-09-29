import { getLocale } from "./locale";
import { getMessagesFor } from "./messages";
import type { AdminMessageAccessor } from "./messages";
import { getTenantId } from "./tenant-id";

/**
 * The catalog accessor for this request's locale.
 *
 * The one `await` a Server Component needs before it can name a string:
 *
 * ```ts
 * const t = await getMessages();
 *
 * return { title: t("admin.auth.login.title") };
 * ```
 *
 * It is for the positions a `ReactNode` cannot fill — `generateMetadata`, an
 * HTML attribute such as `placeholder` or `aria-label`, a message crossing into
 * a Server Action, a zod schema's wording. Copy that is rendered as a node is a
 * `<Message>` behind its own `<Suspense>`, so the card, the inputs, and the
 * buttons around it stay in the static shell.
 *
 * The tenant comes from the root segment, the way `<Message>` reads it, because
 * an operator who has never picked a language reads the console in the tenant's
 * stored default. That is also why this module is separate from `lib/locale.ts`
 * and why nothing in a Server Action imports it: `next/root-params` is
 * unavailable there, so an Action takes the tenant id from the form and calls
 * `getActionMessages` instead.
 *
 * **Inside `<Suspense>` only, and never from a `"use cache"` scope.** Resolving
 * the locale reads the `publira_locale` cookie, so this carries the same rule
 * `getLocale` does: a read above a boundary costs the route its static shell,
 * and a read inside a cache scope bakes one request's language into the entry.
 * Code that is handed a locale instead calls `getMessagesFor`.
 */
export const getMessages = async (): Promise<AdminMessageAccessor> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  return getMessagesFor(locale);
};
