"use client";

import { Input as BaseInput } from "@base-ui/react/input";
import { cn } from "@publira/utils";

export type InputProps = BaseInput.Props;

export const Input = ({ className, ...props }: InputProps) => (
  <BaseInput
    {...props}
    className={cn(
      "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
  />
);
