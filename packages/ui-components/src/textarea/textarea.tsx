"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef } from "react";

export type TextareaProps = Omit<
  ComponentPropsWithoutRef<"textarea">,
  "color"
> & {
  className?: string;
};

export const Textarea = ({ className, ...props }: TextareaProps) => (
  <BaseField.Control
    {...(props as unknown as BaseField.Control.Props)}
    render={<textarea />}
    className={cn(
      "min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
  />
);
