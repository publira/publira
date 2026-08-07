"use client";

import { Button as BaseButton } from "@base-ui/react/button";
import { cn } from "@publira/utils";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
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
        default: "bg-primary text-primary-foreground hover:opacity-90",
        destructive:
          "bg-destructive text-destructive-foreground hover:opacity-90",
        ghost: "text-foreground hover:bg-muted",
        link: "text-primary underline-offset-4 hover:underline",
        outline:
          "border border-border bg-background text-foreground hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
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
