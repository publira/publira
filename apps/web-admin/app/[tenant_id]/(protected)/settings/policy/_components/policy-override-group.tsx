"use client";

import { Checkbox } from "@publira/ui-components/checkbox";
import { Field, FieldLabel } from "@publira/ui-components/field";
import { Fieldset } from "@publira/ui-components/fieldset";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface PolicyOverrideContextValue {
  setUseDefault: (useDefault: boolean) => void;
  useDefault: boolean;
}

const PolicyOverrideContext = createContext<PolicyOverrideContextValue | null>(
  null
);

const usePolicyOverride = () => {
  const context = use(PolicyOverrideContext);
  if (!context) {
    throw new Error("Rendered outside a PolicyOverrideGroup.");
  }

  return context;
};

/**
 * One setting a tenant either follows the platform on or answers for itself,
 * holding which of the two is ticked for the slots inside it.
 */
export const PolicyOverrideGroup = ({
  children,
  initialUseDefault,
}: {
  children: ReactNode;
  initialUseDefault: boolean;
}) => {
  const [useDefault, setUseDefault] = useState(initialUseDefault);
  const context = useMemo(() => ({ setUseDefault, useDefault }), [useDefault]);

  return (
    <PolicyOverrideContext value={context}>
      <fieldset className="grid gap-3 rounded-control border border-border p-4">
        {children}
      </fieldset>
    </PolicyOverrideContext>
  );
};

export const PolicyOverrideLegend = ({ children }: { children: ReactNode }) => (
  <legend className="px-1 text-sm font-medium text-foreground">
    {children}
  </legend>
);

/** The box that hands the setting back to the platform; `children` is its label. */
export const PolicyOverrideUseDefault = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { setUseDefault, useDefault } = usePolicyOverride();

  return (
    <Field className="flex items-center gap-2">
      <Checkbox checked={useDefault} onCheckedChange={setUseDefault} />
      <FieldLabel>{children}</FieldLabel>
    </Field>
  );
};

/** The platform value the group falls back to, and is bounded by. */
export const PolicyOverridePlatformValue = ({
  children,
}: {
  children: ReactNode;
}) => <p className="text-xs text-muted-foreground">{children}</p>;

/**
 * The controls holding the group's own values. Ticked, they are disabled — and
 * a disabled control submits nothing, which is how the save clears the tenant's
 * own value.
 */
export const PolicyOverrideValues = ({ children }: { children: ReactNode }) => {
  const { useDefault } = usePolicyOverride();

  return (
    <Fieldset className="grid gap-4 sm:grid-cols-2" disabled={useDefault}>
      {children}
    </Fieldset>
  );
};

/** What the group means, where the labels alone do not say it. */
export const PolicyOverrideDescription = ({
  children,
}: {
  children: ReactNode;
}) => <p className="text-xs text-muted-foreground">{children}</p>;
