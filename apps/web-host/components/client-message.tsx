"use client";

import { getMessage } from "@publira/i18n";
import type { Locale, MessageValues } from "@publira/i18n";
import { use } from "react";

import { loadHostMessages } from "#lib/messages";
import type { HostMessageKey, HostMessages } from "#lib/messages";

import { useLocale } from "./locale-provider";

/**
 * One promise per locale, so `use()` sees the same promise on every render.
 * `loadHostMessages` is `async`, so calling it during render would hand `use()`
 * a new promise each time and React would suspend again on every retry.
 */
const catalogs = new Map<Locale, Promise<HostMessages>>();

const hostCatalog = (locale: Locale): Promise<HostMessages> => {
  const loaded = catalogs.get(locale);
  if (loaded) {
    return loaded;
  }

  const pending = loadHostMessages(locale);
  catalogs.set(locale, pending);

  return pending;
};

/**
 * The catalog, for a client-only control whose DOM API needs a plain string —
 * an `aria-label` or a `title` that cannot take a node.
 *
 * The locale comes from the route tree through `<LocaleProvider>`, so it is the
 * same value the server rendered with. Keep the hook local to the control that
 * needs it: a catalog object handed across a component boundary makes the key
 * an implicit attribute of whatever the caller happened to load.
 */
export const useHostMessages = () => use(hostCatalog(useLocale()));

/**
 * One catalog string for a Client Component that cannot render `<Message>`.
 *
 * Route-level `error.tsx` files must be client components, so their copy
 * resolves in the browser rather than on the server.
 *
 * **Wrap it in a `<Suspense>` at the call site**, the same as `<Message>`. An
 * error boundary directly under the root layout has no boundary of its own
 * above it, so a suspend with nothing to fall back to leaves React unable to
 * flush the error screen at all.
 */
export const ClientMessage = ({
  message,
  values,
}: {
  message: HostMessageKey;
  values?: MessageValues;
}) => {
  const messages = useHostMessages();

  return getMessage(messages, message, values);
};
