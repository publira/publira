"use client";

import { cn } from "@publira/utils";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

const formMessageVariants = cva(
  "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
  {
    defaultVariants: {
      variant: "info",
    },
    variants: {
      variant: {
        destructive: "border-destructive/30 bg-destructive/10 text-destructive",
        info: "border-info/30 bg-info/10 text-info",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
      },
    },
  }
);

export type FormMessageProps = Omit<ComponentPropsWithoutRef<"p">, "role"> &
  VariantProps<typeof formMessageVariants>;

const iconByVariant = {
  destructive: "!",
  info: "i",
  success: "✓",
  warning: "!",
} as const;

export const FormMessage = ({
  className,
  variant,
  children,
  ...props
}: FormMessageProps) => {
  const tone = variant ?? "info";

  return (
    // The live region is a <p role="status">, not an <output>. React resets a
    // form once its Action settles, and resetting an <output> replaces its
    // children with a single text node holding the default value. React's fiber
    // keeps pointing at the detached nodes, so every later message is written
    // to a <span> the document no longer contains (#1070).
    <p
      {...props}
      className={cn(formMessageVariants({ variant: tone }), className)}
      role="status"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-semibold"
      >
        {iconByVariant[tone]}
      </span>
      <span className="leading-5">{children}</span>
    </p>
  );
};
