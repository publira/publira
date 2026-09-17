"use client";

import { createContext } from "react";
import type { ReactNode } from "react";

import type { PlatformClientMessages } from "#lib/messages";

/**
 * The request's catalog as the read that resolves it, so the provider renders
 * in the static shell and only a component that names a string waits.
 */
export const PlatformMessagesContext =
  createContext<Promise<PlatformClientMessages> | null>(null);

export const PlatformMessagesContextProvider = ({
  children,
  messages,
}: {
  children: ReactNode;
  messages: Promise<PlatformClientMessages>;
}) => (
  <PlatformMessagesContext value={messages}>{children}</PlatformMessagesContext>
);
