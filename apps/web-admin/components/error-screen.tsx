"use client";

import { Button } from "@publira/ui-components/button";
import type { ReactNode } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";

interface ErrorScreenProps {
  /** Extra navigation shown next to the retry button. */
  actions?: ReactNode;
  description: string;
  /**
   * `error.digest` from the boundary. Server Component errors are stripped of
   * their message before they reach the client, so the digest is the only
   * handle an operator can quote to match the server log.
   */
  digest?: string;
  retry: () => void;
  title: string;
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
 * children, which is what an operator means by 再試行.
 */
export const ErrorScreen = ({
  actions,
  description,
  digest,
  retry,
  title,
}: ErrorScreenProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Error</AdminPageEyebrow>
        <AdminPageTitle>{title}</AdminPageTitle>
        <AdminPageDescription>{description}</AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <Button onClick={() => retry()}>再試行</Button>
        {actions}
      </AdminPageActions>
    </AdminPageHeader>
    {digest ? (
      <AdminPageContent>
        <p className="text-xs text-muted-foreground">
          エラー ID: <code className="font-mono">{digest}</code>
        </p>
      </AdminPageContent>
    ) : null}
  </AdminPage>
);
