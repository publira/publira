"use client";

import { createContext } from "react";
import type { ReactNode } from "react";

import type { HostClientMessages } from "#lib/messages";

/**
 * The request's catalog as the read that resolves it, so the provider renders
 * in the static shell and only a component that names a string waits.
 */
export const HostMessagesContext =
  createContext<Promise<HostClientMessages> | null>(null);

export const HostMessagesContextProvider = ({
  children,
  messages,
}: {
  children: ReactNode;
  messages: Promise<HostClientMessages>;
}) => <HostMessagesContext value={messages}>{children}</HostMessagesContext>;
