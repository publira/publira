"use client";

import { Button } from "@publira/ui-components/button";
import type { ReactNode } from "react";

interface ErrorScreenProps {
  /** Extra navigation shown next to the retry button. */
  actions?: ReactNode;
  description: string;
  /**
   * `error.digest` from the boundary. Server Component errors are stripped of
   * their message before they reach the client, so the digest is the only
   * handle a reader can quote to match the server log.
   */
  digest?: string;
  retry: () => void;
  title: string;
}

/**
 * Shared body of the route-level error boundaries (`error.tsx`). Those must be
 * Client Components, so this is one too.
 *
 * Retry is wired to `retry()` rather than `reset()`: `reset()` only clears the
 * error state, while `retry()` re-fetches and re-renders the boundary's
 * children, which is what a reader means by 再試行.
 */
export const ErrorScreen = ({
  actions,
  description,
  digest,
  retry,
  title,
}: ErrorScreenProps) => (
  <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
    <h1 className="font-serif text-3xl font-bold">{title}</h1>
    <p className="mt-4 text-muted-foreground">{description}</p>
    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
      <Button onClick={() => retry()}>再試行</Button>
      {actions}
    </div>
    {digest ? (
      <p className="mt-8 text-xs text-muted-foreground">
        エラー ID: <code className="font-mono">{digest}</code>
      </p>
    ) : null}
  </div>
);
