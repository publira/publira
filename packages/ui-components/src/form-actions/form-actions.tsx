"use client";

import { cn } from "@publira/utils";
import * as React from "react";

export type FormActionsProps = React.ComponentPropsWithoutRef<"div">;

export const FormActions = ({ className, ...props }: FormActionsProps) => (
  <div
    {...props}
    className={cn(
      "flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4",
      className
    )}
  />
);
