"use client";

import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef } from "react";

type DivProps = ComponentPropsWithoutRef<"div">;

export const Card = ({ className, ...props }: DivProps) => (
  <div
    {...props}
    className={cn(
      "rounded-xl border border-border bg-card text-card-foreground shadow-xs",
      className
    )}
  />
);

export const CardHeader = ({ className, ...props }: DivProps) => (
  <div {...props} className={cn("grid gap-1.5 p-5", className)} />
);

export const CardTitle = ({ className, ...props }: DivProps) => (
  <div {...props} className={cn("text-lg font-semibold", className)} />
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
