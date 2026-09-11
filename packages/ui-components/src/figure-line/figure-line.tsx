"use client";

import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type DlProps = ComponentPropsWithoutRef<"dl">;
type DivProps = ComponentPropsWithoutRef<"div">;

/**
 * The figures a screen opens with, as one line of label-and-figure pairs.
 *
 * A console dashboard is read for what it lists, not for its totals, so the
 * totals are a line of type above the list rather than a row of tiles: each
 * pair is a label and its number on one baseline, and a hairline is all that
 * stands between one pair and the next. Tiles would give three counts the
 * weight of the queue underneath them.
 *
 * The line is vertical below `sm`, where four pairs across leave no room for a
 * label, and the hairlines turn with it. The first and last pairs give up
 * their outer padding so the line starts and ends on the page's own margins.
 *
 * Composed rather than prop-driven, so a label that streams from a catalog can
 * carry its own `<Suspense>` boundary and a loading screen can write a
 * placeholder into the same geometry.
 *
 * ```tsx
 * <FigureLine>
 *   <Figure>
 *     <FigureLabel>Published series</FigureLabel>
 *     <FigureValue>12</FigureValue>
 *   </Figure>
 * </FigureLine>
 * ```
 */
export const FigureLine = ({ className, ...props }: DlProps) => (
  <dl
    {...props}
    className={cn(
      "flex flex-col divide-y divide-border border-y border-border sm:flex-row sm:divide-x sm:divide-y-0",
      className
    )}
  />
);

/** One label-and-figure pair. A `<dt>` and a `<dd>` are its only children. */
export const Figure = ({ className, ...props }: DivProps) => (
  <div
    {...props}
    className={cn(
      "flex items-baseline justify-between gap-4 py-3 sm:min-w-0 sm:flex-1 sm:px-5 sm:first:pl-0 sm:last:pr-0",
      className
    )}
  />
);

export const FigureLabel = ({ children }: { children: ReactNode }) => (
  <dt className="min-w-0 text-sm text-muted-foreground">{children}</dt>
);

/**
 * The number itself. Tabular figures, so a line of them keeps one rhythm
 * whichever digits a tenant's data happens to produce.
 */
export const FigureValue = ({ children }: { children: ReactNode }) => (
  <dd className="text-2xl leading-tight font-medium text-foreground tabular-nums">
    {children}
  </dd>
);
