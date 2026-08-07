"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef } from "react";

export type FieldProps = BaseField.Root.Props;

export const Field = ({ className, ...props }: FieldProps) => (
  <BaseField.Root {...props} className={cn("grid gap-2", className)} />
);

export type FieldLabelProps = BaseField.Label.Props & {
  required?: boolean;
};

export const FieldLabel = ({
  children,
  className,
  required,
  ...props
}: FieldLabelProps) => (
  <BaseField.Label
    {...props}
    className={cn("text-sm font-medium text-foreground", className)}
  >
    <span>{children}</span>
    {required ? <span className="ml-1 text-destructive">*</span> : null}
  </BaseField.Label>
);

export type FieldContentProps = ComponentPropsWithoutRef<"div">;

export const FieldContent = ({ className, ...props }: FieldContentProps) => (
  <div {...props} className={cn("grid gap-2", className)} />
);

export type FieldDescriptionProps = BaseField.Description.Props;

export const FieldDescription = ({
  className,
  ...props
}: FieldDescriptionProps) => (
  <BaseField.Description
    {...props}
    className={cn("text-xs text-muted-foreground", className)}
  />
);

export type FieldErrorProps = BaseField.Error.Props;

export const FieldError = ({ className, ...props }: FieldErrorProps) => (
  <BaseField.Error
    {...props}
    className={cn("text-xs text-destructive", className)}
  />
);
