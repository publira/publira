import type { Locale, MessageTree } from "@publira/i18n";
import type { ReactNode } from "react";

import { getLocale } from "./root-locale";

interface LocaleMessagesProviderProps<TCatalog> {
  catalog: Promise<TCatalog>;
  children: ReactNode;
  locale: Promise<Locale>;
}

/**
 * The server provider for one app's client catalog.
 *
 * It awaits nothing, so the layout that places it still reads nothing: both
 * reads start here and are handed down unresolved. `loadCatalog` is the app's
 * client namespace for that locale, not the whole catalog.
 */
export const createLocaleMessagesProvider = <TCatalog extends MessageTree>(
  Provider: (props: LocaleMessagesProviderProps<TCatalog>) => ReactNode,
  loadCatalog: (locale: Locale) => Promise<TCatalog>
): ((props: { children: ReactNode }) => ReactNode) =>
  function LocaleMessagesProvider({
    children,
  }: {
    children: ReactNode;
  }): ReactNode {
    const locale = getLocale();

    return (
      <Provider catalog={locale.then(loadCatalog)} locale={locale}>
        {children}
      </Provider>
    );
  };
