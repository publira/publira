"use client";

import { Button } from "@publira/ui-components/button";
import type { ReactNode } from "react";

import {
  PlatformPage,
  PlatformPageActions,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";

interface ErrorScreenProps {
  /** Extra navigation shown next to the retry button. */
  actions?: ReactNode;
  description: ReactNode;
  digestLabel?: ReactNode;
  retryLabel?: ReactNode;
  /**
   * `error.digest` from the boundary. Server Component errors are stripped of
   * their message before they reach the client, so the digest is the only
   * handle an operator can quote to match the server log.
   */
  digest?: string;
  retry: () => void;
  title: ReactNode;
}

/**
 * Shared body of the route-level error boundaries (`error.tsx`). Those must be
 * Client Components, so this is one too.
 *
 * It reuses the console page scaffold so the error screen keeps the same
 * heading rhythm as every other console page; the scaffold components are
 * plain markup and hold no server-only code.
 *
 * Retry is wired to `retry()` rather than `reset()`: `reset()` only clears the
 * error state, while `retry()` re-fetches and re-renders the boundary's
 * children, which is what an operator means by Retry.
 */
export const ErrorScreen = ({
  actions,
  description,
  digest,
  digestLabel,
  retry,
  retryLabel,
  title,
}: ErrorScreenProps) => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Error</PlatformPageEyebrow>
        <PlatformPageTitle>{title}</PlatformPageTitle>
        <PlatformPageDescription>{description}</PlatformPageDescription>
      </PlatformPageHeading>
      <PlatformPageActions>
        <Button onClick={() => retry()}>{retryLabel}</Button>
        {actions}
      </PlatformPageActions>
    </PlatformPageHeader>
    {digest ? (
      <PlatformPageContent>
        <p className="text-xs text-muted-foreground">
          {digestLabel} <code className="font-mono">{digest}</code>
        </p>
      </PlatformPageContent>
    ) : null}
  </PlatformPage>
);
