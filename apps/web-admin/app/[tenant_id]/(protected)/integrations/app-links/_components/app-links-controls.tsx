"use client";

import { Checkbox } from "@publira/ui-components/checkbox";
import { Field, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import type { InputProps } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import type { TextareaProps } from "@publira/ui-components/textarea";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";

interface AppLinksPlatformState {
  disabled: boolean;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

const AppLinksPlatformContext = createContext<AppLinksPlatformState | null>(
  null
);

const useAppLinksPlatform = (): AppLinksPlatformState => {
  const state = useContext(AppLinksPlatformContext);
  if (!state) {
    throw new Error(
      "AppLinksPlatform slots must be rendered inside an AppLinksPlatform."
    );
  }
  return state;
};

interface AppLinksPlatformProps {
  /** `AppLinksPlatformLegend`, `AppLinksPlatformToggle`, and `AppLinksPlatformFields`. */
  children: ReactNode;
  /** No edit rights, or a failed read. */
  disabled: boolean;
  initialEnabled: boolean;
}

/**
 * Unticked, the fields are disabled and submit nothing, which is how a save
 * clears the platform.
 */
export const AppLinksPlatform = ({
  children,
  disabled,
  initialEnabled,
}: AppLinksPlatformProps) => {
  const [enabled, setEnabled] = useState(() => initialEnabled);
  const state = useMemo(
    () => ({ disabled, enabled, setEnabled }),
    [disabled, enabled]
  );

  return (
    <AppLinksPlatformContext value={state}>
      <fieldset className="grid gap-4 rounded-control border border-border p-4">
        {children}
      </fieldset>
    </AppLinksPlatformContext>
  );
};

export const AppLinksPlatformLegend = ({
  children,
}: {
  children: ReactNode;
}) => (
  <legend className="px-1 text-sm font-medium text-foreground">
    {children}
  </legend>
);

/** The checkbox, labelled by its children. `name` is posted as `on` while it is ticked. */
export const AppLinksPlatformToggle = ({
  children,
  name,
}: {
  children: ReactNode;
  name: string;
}) => {
  const { disabled, enabled, setEnabled } = useAppLinksPlatform();

  return (
    <Field className="flex items-center gap-2">
      <Checkbox
        checked={enabled}
        disabled={disabled}
        name={name}
        onCheckedChange={setEnabled}
      />
      <FieldLabel>{children}</FieldLabel>
    </Field>
  );
};

/** The platform's own fields, disabled while the toggle is unticked. */
export const AppLinksPlatformFields = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { disabled, enabled } = useAppLinksPlatform();

  return (
    <fieldset className="grid min-w-0 gap-4" disabled={disabled || !enabled}>
      {children}
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
