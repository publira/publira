"use client";

import { Checkbox } from "@publira/ui-components/checkbox";
import { Field, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import type { InputProps } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import type { TextareaProps } from "@publira/ui-components/textarea";
import type { ReactNode } from "react";
import { useState } from "react";

interface AppLinksPlatformProps {
  /** The platform's own fields. */
  children: ReactNode;
  /** No edit rights, or a failed read. */
  disabled: boolean;
  initialEnabled: boolean;
  legend: ReactNode;
  /** The checkbox's form field: posted as `on` while the platform is ticked. */
  name: string;
  toggleLabel: ReactNode;
}

/**
 * Unticked, the fields are disabled and submit nothing, which is how a save
 * clears the platform.
 */
export const AppLinksPlatform = ({
  children,
  disabled,
  initialEnabled,
  legend,
  name,
  toggleLabel,
}: AppLinksPlatformProps) => {
  const [enabled, setEnabled] = useState(() => initialEnabled);

  return (
    <fieldset className="grid gap-4 rounded-control border border-border p-4">
      <legend className="px-1 text-sm font-medium text-foreground">
        {legend}
      </legend>
      <Field className="flex items-center gap-2">
        <Checkbox
          checked={enabled}
          disabled={disabled}
          name={name}
          onCheckedChange={setEnabled}
        />
        <FieldLabel>{toggleLabel}</FieldLabel>
      </Field>
      <fieldset className="grid min-w-0 gap-4" disabled={disabled || !enabled}>
        {children}
      </fieldset>
    </fieldset>
  );
};

// React resets an uncontrolled form once its Action settles, which would wipe
// the value a refused save asks the operator to fix.

export const RetainedInput = ({
  defaultValue,
  ...props
}: Omit<InputProps, "defaultValue" | "onChange" | "value"> & {
  defaultValue: string;
}) => {
  const [value, setValue] = useState(() => defaultValue);

  return (
    <Input
      {...props}
      onChange={(event) => setValue(event.target.value)}
      value={value}
    />
  );
};

export const RetainedTextarea = ({
  defaultValue,
  ...props
}: Omit<TextareaProps, "defaultValue" | "onChange" | "value"> & {
  defaultValue: string;
}) => {
  const [value, setValue] = useState(() => defaultValue);

  return (
    <Textarea
      {...props}
      onChange={(event) => setValue(event.target.value)}
      value={value}
    />
  );
};
