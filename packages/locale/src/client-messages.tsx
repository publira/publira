"use client";

import { bindMessages } from "@publira/i18n";
import type {
  Locale,
  MessageAccessor,
  MessageKey,
  MessageTree,
  MessageValues,
} from "@publira/i18n";
import { createContext, use, useMemo } from "react";
import type { ReactNode } from "react";

export interface ClientMessagesProviderProps<TCatalog> {
  catalog: Promise<TCatalog>;
  children: ReactNode;
  locale: Promise<Locale>;
}

export interface ClientMessageProps<TKey extends string> {
  message: TKey;
  values?: MessageValues;
}

export interface ClientMessages<TCatalog extends MessageTree> {
  ClientMessage: (props: ClientMessageProps<MessageKey<TCatalog>>) => string;
  Provider: (props: ClientMessagesProviderProps<TCatalog>) => ReactNode;
  useClientLocale: () => Locale;
  useClientMessages: () => MessageAccessor<TCatalog>;
}

interface Fulfilled<T> extends Promise<T> {
  status: "fulfilled";
  value: T;
}

interface ClientMessageReads<TCatalog> {
  catalog: Promise<TCatalog>;
  locale: Promise<Locale>;
}

// SAFETY: React records `status` on a thenable it has already resolved. A
// promise without that field is not fulfilled, and the cast only reads it.
const isFulfilled = <T,>(promise: Promise<T>): promise is Fulfilled<T> =>
  (promise as Fulfilled<T>).status === "fulfilled";

const fulfilled = <T,>(value: T): Promise<T> =>
  Object.assign(Promise.resolve(value), {
    status: "fulfilled" as const,
    value,
  });

/**
 * The catalog and the locale of a bundle promise, as two reads.
 *
 * A bundle that React already knows is fulfilled — the shape a test gives
 * `use()`, and the shape the RSC payload has in the browser — stays fulfilled,
 * so neither read suspends. A pending bundle stays pending.
 */
export const splitClientMessages = <TCatalog,>(
  messages: Promise<{ readonly catalog: TCatalog; readonly locale: Locale }>
): ClientMessageReads<TCatalog> => {
  if (isFulfilled(messages)) {
    return {
      catalog: fulfilled(messages.value.catalog),
      locale: fulfilled(messages.value.locale),
    };
  }

  return {
    catalog: Promise.resolve(messages).then((value) => value.catalog),
    locale: Promise.resolve(messages).then((value) => value.locale),
  };
};

/**
 * The client catalog of one app.
 *
 * Call it once, at module scope: the contexts are created here. `catalog` and
 * `locale` are separate reads, so a component that only needs the locale does
 * not wait on the catalog `import()`. `missingProvider` is the error both
 * hooks throw when they render outside `Provider`.
 */
export const createClientMessages = <TCatalog extends MessageTree>(
  missingProvider: string
): ClientMessages<TCatalog> => {
  const CatalogContext = createContext<Promise<TCatalog> | null>(null);
  const LocaleContext = createContext<Promise<Locale> | null>(null);

  const useClientLocale = (): Locale => {
    const locale = use(LocaleContext);

    if (locale === null) {
      throw new Error(missingProvider);
    }

    return use(locale);
  };

  const useClientMessages = (): MessageAccessor<TCatalog> => {
    const catalog = use(CatalogContext);

    if (catalog === null) {
      throw new Error(missingProvider);
    }

    return bindMessages(use(catalog), useClientLocale());
  };

  const ClientMessage = ({
    message,
    values,
  }: ClientMessageProps<MessageKey<TCatalog>>): string => {
    const t = useClientMessages();

    return t(message, values);
  };

  const Provider = ({
    catalog,
    children,
    locale,
  }: ClientMessagesProviderProps<TCatalog>): ReactNode => (
    <LocaleContext value={locale}>
      <CatalogContext value={catalog}>{children}</CatalogContext>
    </LocaleContext>
  );

  return { ClientMessage, Provider, useClientLocale, useClientMessages };
};

/**
 * A provider that takes the `{ catalog, locale }` bundle an app's client
 * loader returns, and hands the two reads to `Provider`.
 */
export const ClientMessagesBundleProvider = <TCatalog,>({
  Provider,
  children,
  messages,
}: {
  Provider: (props: ClientMessagesProviderProps<TCatalog>) => ReactNode;
  children: ReactNode;
  messages: Promise<{ readonly catalog: TCatalog; readonly locale: Locale }>;
}): ReactNode => {
  const { catalog, locale } = useMemo(
    () => splitClientMessages(messages),
    [messages]
  );

  return (
    <Provider catalog={catalog} locale={locale}>
      {children}
    </Provider>
  );
};
