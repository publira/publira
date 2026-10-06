import { render } from "@testing-library/react";
import type { ReactNode } from "react";

import { HostMessagesContextProvider } from "#components/host-messages-context";

import type { HostClientMessages } from "./messages";
import { loadHostClientMessages } from "./messages";

/**
 * Renders `ui` under the provider the root layout places, seeded with the
 * English catalog.
 *
 * The catalog is handed over as a promise React already knows is fulfilled,
 * which is what the RSC payload gives the browser: `use()` then answers on
 * the first render, even in a component that names its first string only
 * after an interaction.
 */
export const renderWithClientMessages = async (ui: ReactNode) => {
  const loaded = await loadHostClientMessages("en");
  const messages = Object.assign(Promise.resolve(loaded), {
    status: "fulfilled",
    value: loaded,
  }) satisfies Promise<HostClientMessages>;

  return render(ui, {
    wrapper: ({ children }) => (
      <HostMessagesContextProvider messages={messages}>
        {children}
      </HostMessagesContextProvider>
    ),
  });
};
