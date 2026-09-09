"use client";

import { Button as BaseButton } from "@base-ui/react/button";
import { cn } from "@publira/utils";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

/**
 * A filled control moves its fill one step on hover instead of fading out.
 * `opacity` takes the label down with the fill and lands the button on the
 * washed surface a disabled control uses. Mixing toward the ink darkens Ai,
 * Shu, and crimson by a step; the ink fill has nowhere darker to go, so it
 * moves toward the grey it is tinted from.
 */
const HOVER_FILL_PRIMARY =
  "hover:bg-[color-mix(in_oklab,var(--color-primary)_88%,var(--color-foreground))]";
const HOVER_FILL_SECONDARY =
  "hover:bg-[color-mix(in_oklab,var(--color-secondary)_88%,var(--color-foreground))]";
const HOVER_FILL_DESTRUCTIVE =
  "hover:bg-[color-mix(in_oklab,var(--color-destructive)_88%,var(--color-foreground))]";
const HOVER_FILL_INK =
  "hover:bg-[color-mix(in_oklab,var(--color-foreground)_85%,var(--color-muted-foreground))]";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-control text-sm font-medium whitespace-nowrap transition-colors duration-state ease-state focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    defaultVariants: {
      size: "md",
      variant: "default",
    },
    variants: {
      size: {
        icon: "size-9",
        lg: "h-10 px-6",
        md: "h-9 px-4",
        sm: "h-8 px-3",
      },
      variant: {
        default: `bg-primary text-primary-foreground ${HOVER_FILL_PRIMARY}`,
        /**
         * Crimson, and an outline: a destructive action names itself without
         * spending the one filled slot a screen has. The filled form belongs
         * to the dialog that asks before the thing happens.
         */
        destructive:
          "border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground",
        /** The confirming button inside a `ConfirmDialog`, and nowhere else. */
        destructiveFilled: `bg-destructive text-destructive-foreground ${HOVER_FILL_DESTRUCTIVE}`,
        ghost: "text-foreground hover:bg-muted",
        /**
         * Filled in ink. The one filled button on a screen that is neither a
         * console's primary action, which is Ai, nor the reading action, which
         * is the single Shu the screen is allowed.
         */
        ink: `bg-foreground text-background ${HOVER_FILL_INK}`,
        link: "text-primary underline-offset-4 hover:underline",
        outline: "border border-input bg-card text-foreground hover:bg-muted",
        /** Shu, and the reading action alone. */
        secondary: `bg-secondary text-secondary-foreground ${HOVER_FILL_SECONDARY}`,
      },
    },
  }
);

type BaseButtonProps = ComponentPropsWithoutRef<typeof BaseButton>;

export type ButtonProps = Omit<BaseButtonProps, "className"> &
  VariantProps<typeof buttonVariants> & {
    className?: string;
  };

export const Button = ({ className, size, variant, ...props }: ButtonProps) => (
  <BaseButton
    {...props}
    className={cn(buttonVariants({ size, variant }), className)}
  />
);
