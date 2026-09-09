"use client";

import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef } from "react";

type DivProps = ComponentPropsWithoutRef<"div">;

/**
 * An in-flow surface: a step from the page to `card`, and one hairline. What
 * separates it from the paper is that step and that rule, not a radius and not
 * a shadow — a shadow is for a layer that floats above the page, and this one
 * sits in it.
 */
export const Card = ({ className, ...props }: DivProps) => (
  <div
    {...props}
    className={cn(
      "border border-border bg-card text-card-foreground",
      className
    )}
  />
);

export const CardHeader = ({ className, ...props }: DivProps) => (
  <div {...props} className={cn("grid gap-1.5 p-5", className)} />
);

export const CardTitle = ({ className, ...props }: DivProps) => (
  <div
    {...props}
    className={cn("font-sans text-xl leading-tight font-medium", className)}
  />
);

export const CardDescription = ({ className, ...props }: DivProps) => (
  <div {...props} className={cn("text-sm text-muted-foreground", className)} />
);

export const CardContent = ({ className, ...props }: DivProps) => (
  <div {...props} className={cn("p-5 pt-0", className)} />
);

export const CardFooter = ({ className, ...props }: DivProps) => (
  <div
    {...props}
    className={cn("flex items-center gap-2 p-5 pt-0", className)}
  />
);
