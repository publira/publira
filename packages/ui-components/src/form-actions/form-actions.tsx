import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, JSX } from "react";

export type FormActionsProps = ComponentPropsWithoutRef<"div">;

export const FormActions = ({
  className,
  ...props
}: FormActionsProps): JSX.Element => (
  <div
    {...props}
    className={cn(
      "flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4",
      className
    )}
  />
);
