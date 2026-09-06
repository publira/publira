"use client";

import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type DivProps = ComponentPropsWithoutRef<"div">;

/**
 * The failure state of one section of a page: the section is gone, the rest of
 * the page is not.
 *
 * It is the shared body of both halves of that story. The `catchError`
 * boundary each app wires up renders it with a `retry()` button when a Server
 * Component throws, and a screen that already holds a classified `ok: false`
 * result renders it directly with that result's message. Before this existed,
 * every such screen hand-rolled its own destructive-toned block and its own
 * wording.
 *
 * Composed rather than prop-driven, so every piece of copy is written on the
 * element that carries it and can stream from the caller's catalog behind its
 * own `<Suspense>`.
 *
 * ```tsx
 * <SectionError>
 *   <SectionErrorHeading>
 *     <SectionErrorTitle>Could not display the operators</SectionErrorTitle>
 *     <SectionErrorDescription>Try again in a moment.</SectionErrorDescription>
 *   </SectionErrorHeading>
 *   <SectionErrorActions>
 *     <SectionErrorRetry>Try again</SectionErrorRetry>
 *   </SectionErrorActions>
 *   <SectionErrorDigest>Error ID:</SectionErrorDigest>
 * </SectionError>
 * ```
 *
 * Sibling components, so a screen picks the one that matches what happened:
 * `EmptyState` for "nothing to show yet", `FormMessage` for a submission the
 * server rejected, and the per-app `ErrorScreen` for a failure that takes the
 * whole route down.
 */
export const SectionError = ({ className, ...props }: DivProps) => (
  <div
    {...props}
    className={cn(
      "grid gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-6",
      className
    )}
    role="alert"
  />
);

/** Title and description stack. */
export const SectionErrorHeading = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-1">{children}</div>
);

/** Names the section that is missing: "Could not display the recommendations". */
export const SectionErrorTitle = ({ children }: { children: ReactNode }) => (
  <p className="text-base font-medium text-destructive">{children}</p>
);

/**
 * Why the section is missing, in the reader's terms. An error boundary renders
 * fixed copy; a screen holding a classified RPC failure renders the message
 * `rpcErrorMessage` produced for it.
 */
export const SectionErrorDescription = ({
  children,
}: {
  children: ReactNode;
}) => <p className="text-sm text-muted-foreground">{children}</p>;

/** Recovery affordance — a retry button from an error boundary, a link out. */
export const SectionErrorActions = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap gap-3">{children}</div>
);

/**
 * The paragraph that carries the digest. `SectionErrorDigest` composes it with
 * the identifier the boundary caught; nothing else renders one.
 */
export const SectionErrorDigestLine = ({
  children,
}: {
  children: ReactNode;
}) => <p className="text-xs text-muted-foreground">{children}</p>;

/**
 * `error.digest` from the boundary that caught the failure. Server Component
 * errors are stripped of their message before they reach the client, so the
 * digest is the only handle a reader can quote to match the server log.
 */
export const SectionErrorDigestValue = ({
  children,
}: {
  children: ReactNode;
}) => <code className="font-mono">{children}</code>;
