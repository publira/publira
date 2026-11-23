"use client";

import {
  ClientMessagesBundleProvider,
  createClientMessages,
} from "@publira/locale/client-messages";
import type { ReactNode } from "react";

import type {
  PlatformClientCatalog,
  PlatformClientMessages,
} from "#lib/messages";

/**
 * The request's catalog as the read that resolves it, so the provider renders
 * in the static shell and only a component that names a string waits.
 */
const { ClientMessage, Provider, useClientMessages } =
  createClientMessages<PlatformClientCatalog>(
    "PlatformMessagesProvider is required."
  );

export { ClientMessage, useClientMessages };

/** The provider `PlatformMessagesProvider` places. Tests pass the bundle. */
export const PlatformCatalogProvider = Provider;

export const PlatformMessagesContextProvider = ({
  children,
  messages,
}: {
  children: ReactNode;
  messages: Promise<PlatformClientMessages>;
}) => (
  <ClientMessagesBundleProvider Provider={Provider} messages={messages}>
    {children}
  </ClientMessagesBundleProvider>
);
