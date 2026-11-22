// @vitest-environment jsdom

import type { Locale } from "@publira/i18n";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ClientMessagesBundleProvider,
  createClientMessages,
  splitClientMessages,
} from "./client-messages";

const catalog = {
  greeting: "Hello",
} as const;

const client = createClientMessages<typeof catalog>(
  "ExampleMessagesProvider is required."
);

const fulfilled = <T,>(value: T): Promise<T> =>
  Object.assign(Promise.resolve(value), {
    status: "fulfilled" as const,
    value,
  });

const pendingCatalog = Promise.withResolvers<typeof catalog>().promise;

const LocaleLabel = () => {
  const locale = client.useClientLocale();

  return <p>{locale}</p>;
};

const Provider = ({
  catalog: catalogPromise,
  children,
  locale,
}: {
  catalog: Promise<typeof catalog>;
  children: ReactNode;
  locale: Promise<Locale>;
}) => (
  <client.Provider catalog={catalogPromise} locale={locale}>
    {children}
  </client.Provider>
);

describe("createClientMessages", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders from the catalog and reads the locale without waiting on it", () => {
    render(
      <Provider catalog={fulfilled(catalog)} locale={fulfilled("en")}>
        <client.ClientMessage message="greeting" />
        <LocaleLabel />
      </Provider>
    );

    expect(screen.getByText("Hello")).toBeDefined();
    expect(screen.getByText("en")).toBeDefined();
  });

  it("reads the locale while the catalog is still pending", () => {
    render(
      <Provider catalog={pendingCatalog} locale={fulfilled("ja")}>
        <LocaleLabel />
      </Provider>
    );

    expect(screen.getByText("ja")).toBeDefined();
  });

  it("throws outside the provider", () => {
    expect(() => render(<client.ClientMessage message="greeting" />)).toThrow(
      "ExampleMessagesProvider is required."
    );
  });

  it("splits a fulfilled bundle without suspending", () => {
    const messages = fulfilled({ catalog, locale: "en" as const });

    render(
      <ClientMessagesBundleProvider Provider={Provider} messages={messages}>
        <client.ClientMessage message="greeting" />
      </ClientMessagesBundleProvider>
    );

    expect(screen.getByText("Hello")).toBeDefined();
  });

  it("splits a pending bundle under suspense", async () => {
    const messages = Promise.resolve({ catalog, locale: "en" as const });

    await act(async () => {
      render(
        <Suspense fallback={<p>loading</p>}>
          <ClientMessagesBundleProvider Provider={Provider} messages={messages}>
            <client.ClientMessage message="greeting" />
          </ClientMessagesBundleProvider>
        </Suspense>
      );
      await messages;
    });

    expect(screen.getByText("Hello")).toBeDefined();
  });

  it("normalizes a pending Flight thenable before splitting it", async () => {
    interface Bundle {
      readonly catalog: typeof catalog;
      readonly locale: Locale;
    }

    // oxlint-disable-next-line unicorn/no-thenable -- This regression test models a Flight thenable.
    const thenMethod = "then";
    // SAFETY: This object models a Flight thenable, which is not a native Promise.
    const messages = Object.create(null) as Promise<Bundle>;
    Object.defineProperty(messages, thenMethod, {
      value: (resolve: (value: Bundle) => void) => {
        queueMicrotask(() => resolve({ catalog, locale: "ja" }));
      },
    });
    const reads = splitClientMessages(messages);

    expect(reads.catalog).toBeInstanceOf(Promise);
    expect(reads.locale).toBeInstanceOf(Promise);
    await expect(reads.catalog).resolves.toEqual(catalog);
    await expect(reads.locale).resolves.toBe("ja");
  });
});
