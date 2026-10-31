"use client";

import { Button } from "@publira/ui-components/button";
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import { ClientMessage } from "#components/client-message";

interface ErrorScreenState {
  digest: string | undefined;
  retry: () => void;
}

const ErrorScreenStateContext = createContext<ErrorScreenState | null>(null);

interface ErrorScreenProps {
  /**
   * `ErrorScreen.Title`, `ErrorScreen.Description`, `ErrorScreen.Actions` holding
   * an `ErrorScreen.Retry`, and an `ErrorScreen.Digest`.
   */
  children: ReactNode;
  /**
   * `error.digest` from the boundary. Server Component errors are stripped of
   * their message before they reach the client, so the digest is the only
   * handle a reader can quote to match the server log.
   */
  digest?: string;
  retry: () => void;
}

/**
 * Shared body of the route-level error boundaries (`error.tsx`). Those must be
 * Client Components, so this is one too.
 *
 * One left-aligned column, like every other screen on the site: what went wrong
 * in ink, what to do next as a plain sentence under it, and the controls in a
 * row below. Nothing is centred and nothing is wrapped in a surface — a failure
 * is a page the reader landed on, not a notice pinned to the middle of one.
 *
 * The title and description name the failure, so the caller writes them; the
 * retry label and the digest prefix are the same on every screen, so their
 * slots resolve them from the catalog.
 *
 * ```tsx
 * <ErrorScreen.Root digest={error.digest} retry={retry}>
 *   <ErrorScreen.Title>…</ErrorScreen.Title>
 *   <ErrorScreen.Description>…</ErrorScreen.Description>
 *   <ErrorScreen.Actions>
 *     <ErrorScreen.Retry />
 *   </ErrorScreen.Actions>
 *   <ErrorScreen.Digest />
 * </ErrorScreen.Root>
 * ```
 */
const ErrorScreen = ({ children, digest, retry }: ErrorScreenProps) => {
  const state = useMemo(() => ({ digest, retry }), [digest, retry]);

  return (
    <ErrorScreenStateContext value={state}>
      <div className="mx-auto grid max-w-measure-prose gap-4 px-6 py-16">
        {children}
      </div>
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

const ErrorScreenTitle = ({ children }: { children: ReactNode }) => (
  <h1 className="font-serif text-3xl leading-tight">{children}</h1>
);

const ErrorScreenDescription = ({ children }: { children: ReactNode }) => (
  <p className="text-foreground">{children}</p>
);

const ErrorScreenActions = ({ children }: { children: ReactNode }) => (
  <div className="mt-2 flex flex-wrap items-center gap-3">{children}</div>
);

/**
 * Outline rather than filled: the reading action is what the site's one filled
 * button is for, and a screen that has lost its content has nothing to read.
 * `retry()` rather than `reset()`, because only `retry()` re-fetches the
 * boundary's children, which is what a reader means by Try again.
 */
const ErrorScreenRetry = () => {
  const { retry } = useErrorScreenState();

  return (
    <Button onClick={() => retry()} variant="outline">
      <ClientMessage message="storefront.common.retry" />
    </Button>
  );
};

/** The digest behind its prefix, or nothing when the error carries none. */
const ErrorScreenDigest = () => {
  const { digest } = useErrorScreenState();

  if (!digest) {
    return null;
  }

  return (
    <p className="mt-4 text-xs text-muted-foreground">
      <ClientMessage message="storefront.common.error_id" />{" "}
      <code className="font-mono">{digest}</code>
    </p>
  );
};

export {
  ErrorScreen as Root,
  ErrorScreenActions as Actions,
  ErrorScreenDescription as Description,
  ErrorScreenDigest as Digest,
  ErrorScreenRetry as Retry,
  ErrorScreenTitle as Title,
};
