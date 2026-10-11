"use client";

import { createContext } from "react";
import type { ReactNode } from "react";

import type { StorefrontClientMessages } from "#lib/messages";

/**
 * The request's catalog as the read that resolves it, so the provider renders
 * in the static shell and only a component that names a string waits.
 */
export const StorefrontMessagesContext =
  createContext<Promise<StorefrontClientMessages> | null>(null);

export const StorefrontMessagesContextProvider = ({
  children,
  messages,
}: {
  children: ReactNode;
  messages: Promise<StorefrontClientMessages>;
}) => (
  <StorefrontMessagesContext value={messages}>
    {children}
  </StorefrontMessagesContext>
);
