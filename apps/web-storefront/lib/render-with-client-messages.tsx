import type { Locale } from "@publira/i18n";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

import { StorefrontMessagesContextProvider } from "#components/storefront-messages-context";

import type { StorefrontClientMessages } from "./messages";
import { loadStorefrontClientMessages } from "./messages";

/**
 * Renders `ui` under the provider the root layout places, seeded with the
 * catalog for `locale` — English unless a test is about another language.
 *
 * The catalog is handed over as a promise React already knows is fulfilled,
 * which is what the RSC payload gives the browser: `use()` then answers on
 * the first render, even in a component that names its first string only
 * after an interaction.
 */
export const renderWithClientMessages = async (
  ui: ReactNode,
  locale: Locale = "en"
) => {
  const loaded = await loadStorefrontClientMessages(locale);
  const messages = Object.assign(Promise.resolve(loaded), {
    status: "fulfilled",
    value: loaded,
  }) satisfies Promise<StorefrontClientMessages>;

  return render(ui, {
    wrapper: ({ children }) => (
      <StorefrontMessagesContextProvider messages={messages}>
        {children}
      </StorefrontMessagesContextProvider>
    ),
  });
};
