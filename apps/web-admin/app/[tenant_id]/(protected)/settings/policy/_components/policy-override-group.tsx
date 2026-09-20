"use client";

import { Checkbox } from "@publira/ui-components/checkbox";
import { Field, FieldLabel } from "@publira/ui-components/field";
import type { ReactNode } from "react";

import { ClientMessage } from "#components/client-message";

interface PolicyOverrideGroupProps {
  /** The controls holding this group's own values. */
  children: ReactNode;
  /** What the group means, where the labels alone do not say it. */
  description?: ReactNode;
  /** No edit rights, a failed read, or a save in flight. */
  disabled: boolean;
  legend: ReactNode;
  onUseDefaultChange: (useDefault: boolean) => void;
  /** The platform value this group falls back to, and is bounded by. */
  platformValue: ReactNode;
  useDefault: boolean;
}

/**
 * One setting a tenant either follows the platform on or answers for itself.
 * Ticked, the controls are disabled — and a disabled control submits nothing,
 * which is how the save clears the tenant's own value.
 */
export const PolicyOverrideGroup = ({
  children,
  description,
  disabled,
  legend,
  onUseDefaultChange,
  platformValue,
  useDefault,
}: PolicyOverrideGroupProps) => (
  <fieldset className="grid gap-3 rounded-control border border-border p-4">
    <legend className="px-1 text-sm font-medium text-foreground">
      {legend}
    </legend>
    <Field className="flex items-center gap-2">
      <Checkbox
        checked={useDefault}
        disabled={disabled}
        onCheckedChange={onUseDefaultChange}
      />
      <FieldLabel>
        <ClientMessage message="admin.settings.policy.use_platform_default" />
      </FieldLabel>
    </Field>
    <p className="text-xs text-muted-foreground">{platformValue}</p>
    <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    {description ? (
      <p className="text-xs text-muted-foreground">{description}</p>
    ) : null}
  </fieldset>
);
