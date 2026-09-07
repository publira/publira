"use client";

import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type DivProps = ComponentPropsWithoutRef<"div">;

/**
 * The "nothing here yet" state of a list or a section.
 *
 * Composed rather than prop-driven, so each region is an element the caller
 * writes: a heading that streams from a catalog can carry its own `<Suspense>`
 * boundary, and the actions region takes whatever control belongs there.
 *
 * ```tsx
 * <EmptyState>
 *   <EmptyStateIcon>
 *     <InboxIcon className="size-6" />
 *   </EmptyStateIcon>
 *   <EmptyStateHeading>
 *     <EmptyStateTitle>No series yet</EmptyStateTitle>
 *     <EmptyStateDescription>Publish one to see it here.</EmptyStateDescription>
 *   </EmptyStateHeading>
 *   <EmptyStateActions>
 *     <LinkButton href="/series/new">New series</LinkButton>
 *   </EmptyStateActions>
 * </EmptyState>
 * ```
 */
export const EmptyState = ({ className, ...props }: DivProps) => (
  <div
    {...props}
    className={cn(
      "grid gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center",
      className
    )}
  />
);

export const EmptyStateIcon = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto text-muted-foreground">{children}</div>
);

/** Title and description stack. */
export const EmptyStateHeading = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-1">{children}</div>
);

export const EmptyStateTitle = ({ children }: { children: ReactNode }) => (
  <p className="text-base font-medium text-foreground">{children}</p>
);

export const EmptyStateDescription = ({
  children,
}: {
  children: ReactNode;
}) => <p className="text-sm text-muted-foreground">{children}</p>;

export const EmptyStateActions = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto">{children}</div>
);
