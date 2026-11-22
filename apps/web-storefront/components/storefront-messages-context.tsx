"use client";

import {
  ClientMessagesBundleProvider,
  createClientMessages,
} from "@publira/locale/client-messages";
import type { ReactNode } from "react";

import type {
  StorefrontClientCatalog,
  StorefrontClientMessages,
} from "#lib/messages";

/**
 * The request's catalog as the read that resolves it, so the provider renders
 * in the static shell and only a component that names a string waits.
 */
const { ClientMessage, Provider, useClientMessages } =
  createClientMessages<StorefrontClientCatalog>(
    "StorefrontMessagesProvider is required."
  );

export { ClientMessage, useClientMessages };

/** The provider `StorefrontMessagesProvider` places. Tests pass the bundle. */
export const StorefrontCatalogProvider = Provider;

export const StorefrontMessagesContextProvider = ({
  children,
  messages,
}: {
  children: ReactNode;
  messages: Promise<StorefrontClientMessages>;
}) => (
  <ClientMessagesBundleProvider Provider={Provider} messages={messages}>
    {children}
  </ClientMessagesBundleProvider>
);
