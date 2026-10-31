"use client";

import * as ConsolePage from "@publira/layouts/admin/console-page";
import { Button } from "@publira/ui-components/button";
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

interface ErrorScreenState {
  digest: string | undefined;
  retry: () => void;
}

const ErrorScreenStateContext = createContext<ErrorScreenState | null>(null);

interface ErrorScreenProps {
  /** The console page header, with `ErrorScreenRetry` among its actions, and an `ErrorScreenDigest`. */
  children: ReactNode;
  /**
   * `error.digest` from the boundary. Server Component errors are stripped of
   * their message before they reach the client, so the digest is the only
   * handle an operator can quote to match the server log.
   */
  digest: string | undefined;
  retry: () => void;
}

/**
 * Shared body of the route-level error boundaries (`error.tsx`). Those must be
 * Client Components, so this is one too.
 *
 * It reuses the console page scaffold so the error screen keeps the same
 * heading rhythm as every other console page; the scaffold components are
 * plain markup and hold no server-only code.
 *
 * Every string is a child the boundary writes, because `app/[tenant_id]/error.tsx`
 * sits above the provider `<ClientMessage>` reads and resolves its copy another way.
 *
 * ```tsx
 * <ErrorScreen.Root digest={error.digest} retry={retry}>
 *   <ConsolePage.Header>
 *     <ConsolePage.Heading>
 *       <ConsolePage.Title>…</ConsolePage.Title>
 *       <ConsolePage.Description>…</ConsolePage.Description>
 *     </ConsolePage.Heading>
 *     <ConsolePage.Actions>
 *       <ErrorScreen.Retry>…</ErrorScreen.Retry>
 *     </ConsolePage.Actions>
 *   </ConsolePage.Header>
 *   <ErrorScreen.Digest>…</ErrorScreen.Digest>
 * </ErrorScreen.Root>
 * ```
 */
const ErrorScreen = ({ children, digest, retry }: ErrorScreenProps) => {
  const state = useMemo(() => ({ digest, retry }), [digest, retry]);

  return (
    <ErrorScreenStateContext value={state}>
      <ConsolePage.Root>{children}</ConsolePage.Root>
    </ErrorScreenStateContext>
  );
};

const useErrorScreenState = (): ErrorScreenState => {
  const state = useContext(ErrorScreenStateContext);

  if (!state) {
    throw new Error(
      "ErrorScreenRetry and ErrorScreenDigest must be rendered inside an ErrorScreen."
    );
  }

  return state;
};

/**
 * The control that re-renders the boundary; its children are its label.
 * `retry()` rather than `reset()`, because only `retry()` re-fetches the
 * boundary's children, which is what an operator means by Retry.
 */
const ErrorScreenRetry = ({ children }: { children: ReactNode }) => {
  const { retry } = useErrorScreenState();

  return <Button onClick={() => retry()}>{children}</Button>;
};

/**
 * The digest line, behind the children as its prefix ("Error ID:"). Nothing is
 * rendered when the error carries no digest.
 */
const ErrorScreenDigest = ({ children }: { children: ReactNode }) => {
  const { digest } = useErrorScreenState();

  if (!digest) {
    return null;
  }

  return (
    <ConsolePage.Content>
      <p className="text-xs text-muted-foreground">
        {children} <code className="font-mono">{digest}</code>
      </p>
    </ConsolePage.Content>
  );
};

export {
  ErrorScreen as Root,
  ErrorScreenDigest as Digest,
  ErrorScreenRetry as Retry,
};
