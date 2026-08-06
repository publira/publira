"use client";

import { cn } from "@publira/utils";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

export const badgeVariants = cva(
  "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 whitespace-normal",
  {
    compoundVariants: [
      {
        className: "border-destructive/30 text-destructive",
        tone: "destructive",
        variant: "outline",
      },
      {
        className: "border-destructive/20 bg-destructive/10 text-destructive",
        tone: "destructive",
        variant: "soft",
      },
      {
        className: "bg-destructive text-destructive-foreground",
        tone: "destructive",
        variant: "solid",
      },
      {
        className: "border-info/30 text-info",
        tone: "info",
        variant: "outline",
      },
      {
        className: "border-info/20 bg-info/10 text-info",
        tone: "info",
        variant: "soft",
      },
      {
        className: "bg-info text-info-foreground",
        tone: "info",
        variant: "solid",
      },
      {
        className: "border-border text-muted-foreground",
        tone: "muted",
        variant: "outline",
      },
      {
        className: "border-border bg-muted text-foreground",
        tone: "muted",
        variant: "soft",
      },
      {
        className: "bg-foreground text-background",
        tone: "muted",
        variant: "solid",
      },
      {
        className: "border-success/30 text-success",
        tone: "success",
        variant: "outline",
      },
      {
        className: "border-success/20 bg-success/10 text-success",
        tone: "success",
        variant: "soft",
      },
      {
        className: "bg-success text-success-foreground",
        tone: "success",
        variant: "solid",
      },
      {
        className: "border-warning/30 text-warning",
        tone: "warning",
        variant: "outline",
      },
      {
        className: "border-warning/20 bg-warning/10 text-warning",
        tone: "warning",
        variant: "soft",
      },
      {
        className: "bg-warning text-warning-foreground",
        tone: "warning",
        variant: "solid",
      },
    ],
    defaultVariants: {
      tone: "muted",
      variant: "soft",
    },
    variants: {
      tone: {
        destructive: "",
        info: "",
        muted: "",
        success: "",
        warning: "",
      },
      variant: {
        outline: "bg-background",
        soft: "",
        solid: "border-transparent",
      },
    },
  }
);

type BadgeVariantOptions = VariantProps<typeof badgeVariants>;

export type BadgeTone = NonNullable<BadgeVariantOptions["tone"]>;
export type BadgeVariant = NonNullable<BadgeVariantOptions["variant"]>;

export type BadgeProps = ComponentPropsWithoutRef<"span"> & BadgeVariantOptions;

export const Badge = ({ className, tone, variant, ...props }: BadgeProps) => (
  <span
    {...props}
    className={cn(badgeVariants({ tone, variant }), className)}
  />
);
