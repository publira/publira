"use client";

import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type DivProps = Omit<ComponentPropsWithoutRef<"div">, "title">;

/**
 * The digest and the label that introduces it, as one prop.
 *
 * They travel together because this package holds no copy of its own: a caller
 * that has a digest to show is the only one that can word the prefix in the
 * reader's language, so the type makes showing one without its label
 * impossible rather than falling back to a fixed language.
 */
export interface SectionErrorDigest {
  /** Prefix shown before `value`, such as "Error ID:". */
  label: ReactNode;
  /**
   * `error.digest` from the boundary that caught the failure. Server Component
   * errors are stripped of their message before they reach the client, so the
   * digest is the only handle a reader can quote to match the server log.
   */
  value: string;
}

export type SectionErrorProps = DivProps & {
  /** Recovery affordance — a retry button from an error boundary, a link out. */
  actions?: ReactNode;
  /**
   * Why the section is missing, in the reader's terms. An error boundary passes
   * fixed copy; a screen holding a classified RPC failure passes the message
   * `rpcErrorMessage` produced for it.
   */
  description?: ReactNode;
  digest?: SectionErrorDigest;
  title: ReactNode;
};

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
 * Sibling components, so a screen picks the one that matches what happened:
 * `EmptyState` for "nothing to show yet", `FormMessage` for a submission the
 * server rejected, and the per-app `ErrorScreen` for a failure that takes the
 * whole route down.
 */
export const SectionError = ({
  actions,
  className,
  description,
  digest,
  title,
  ...props
}: SectionErrorProps) => (
  <div
    {...props}
    className={cn(
      "grid gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-6",
      className
    )}
    role="alert"
  >
    <div className="grid gap-1">
      <p className="text-base font-medium text-destructive">{title}</p>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
    {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    {digest ? (
      <p className="text-xs text-muted-foreground">
        {digest.label} <code className="font-mono">{digest.value}</code>
      </p>
    ) : null}
  </div>
);
