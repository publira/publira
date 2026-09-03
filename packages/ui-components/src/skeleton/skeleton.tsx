"use client";

import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef } from "react";

type DivProps = ComponentPropsWithoutRef<"div">;

export const Skeleton = ({ className, ...props }: DivProps) => (
  <div
    {...props}
    aria-hidden
    className={cn(
      "rounded-md bg-muted/70 motion-safe:animate-pulse",
      className
    )}
  />
);

export type SkeletonLineProps = ComponentPropsWithoutRef<"span">;

/**
 * The skeleton for a placeholder that sits in an inline flow — inside a
 * heading, or among a row of buttons.
 *
 * {@link Skeleton} is a `<div>`, so dropping it into such a place breaks the
 * line it lands in. This one is a `<span>` and does not.
 */
export const SkeletonLine = ({ className, ...props }: SkeletonLineProps) => (
  <span
    {...props}
    aria-hidden
    className={cn(
      "inline-block rounded-md bg-muted/70 align-middle motion-safe:animate-pulse",
      className
    )}
  />
);

export type SkeletonTextProps = DivProps & {
  lines?: number;
};

export const SkeletonText = ({
  className,
  lines = 3,
  ...props
}: SkeletonTextProps) => (
  <div {...props} className={cn("grid gap-2", className)}>
    {Array.from({ length: lines }, (_, index) => (
      <Skeleton
        key={index}
        className={cn("h-4", index === lines - 1 ? "w-2/3" : "w-full")}
      />
    ))}
  </div>
);

export type SkeletonCardProps = ComponentPropsWithoutRef<"div">;

export const SkeletonCard = ({ className, ...props }: SkeletonCardProps) => (
  <div
    {...props}
    className={cn("rounded-xl border border-border bg-card p-5", className)}
  >
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>

      <SkeletonText lines={3} />

      <div className="grid gap-2 sm:grid-cols-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  </div>
);
