import { getLocale } from "./locale";
import { getMessagesFor } from "./messages";
import type { HostMessageAccessor } from "./messages";

/**
 * The catalog accessor for this request's locale.
 *
 * The one `await` a Server Component needs before it can name a string:
 *
 * ```ts
 * const t = await getMessages();
 *
 * return { title: t("host.auth.login.title") };
 * ```
 *
 * It is for the positions a `ReactNode` cannot fill — `generateMetadata`, an
 * HTML attribute such as `placeholder` or `aria-label`, a message crossing into
 * a Server Action, a zod schema's wording. Copy that is rendered as a node is a
 * `<Message>` behind its own `<Suspense>`, so the card, the inputs, and the
 * headings around it stay in the static shell.
 *
 * The locale comes from the `[locale]` root segment, so resolving it costs
 * nothing and the value is already part of every cache key downstream; the
 * `import()` of the catalog is what suspends. A Server Action has no root
 * parameters and a `"use cache"` scope must not resolve a locale of its own —
 * both take the locale as an argument and call `getMessagesFor` instead.
 *
 * This module reads `next/root-params`, so it is server-only. A Client
 * Component resolves its copy through `<ClientMessage>` or `useHostMessages()`.
 */
export const getMessages = async (): Promise<HostMessageAccessor> => {
  const locale = await getLocale();

  return getMessagesFor(locale);
};
