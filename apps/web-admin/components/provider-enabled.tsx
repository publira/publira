"use client";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import type { InputProps } from "@publira/ui-components/input";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface ProviderEnabledContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

const ProviderEnabledContext =
  createContext<ProviderEnabledContextValue | null>(null);

const useProviderEnabledState = () => {
  const context = use(ProviderEnabledContext);
  if (!context) {
    throw new Error(
      "ProviderEnabled slots must be rendered inside ProviderEnabled."
    );
  }
  return context;
};

/**
 * Whether the provider is turned on, which decides whether an unstored
 * required credential has to be entered. Seeded once per mount; the form keys
 * it by the saved settings.
 */
const ProviderEnabled = ({
  children,
  initialEnabled,
}: {
  children: ReactNode;
  initialEnabled: boolean;
}) => {
  const [enabled, setEnabled] = useState(initialEnabled);
  const context = useMemo(() => ({ enabled, setEnabled }), [enabled]);

  return (
    <ProviderEnabledContext value={context}>{children}</ProviderEnabledContext>
  );
};

/** The checkbox the form posts as `enabled`, with `children` beside it. */
const ProviderEnabledCheckbox = ({ children }: { children: ReactNode }) => {
  const { enabled, setEnabled } = useProviderEnabledState();

  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <Checkbox checked={enabled} name="enabled" onCheckedChange={setEnabled} />
      {children}
    </label>
  );
};

/** A setting's label, marked required while the provider is on. */
const ProviderEnabledRequiredLabel = ({
  children,
}: {
  children: ReactNode;
}) => (
  <Field.Label required={useProviderEnabledState().enabled}>
    {children}
  </Field.Label>
);

/** A setting the provider needs once it is on, required from then. */
const ProviderEnabledRequiredInput = (props: Omit<InputProps, "required">) => (
  <Input {...props} required={useProviderEnabledState().enabled} />
);

export {
  ProviderEnabled as Root,
  ProviderEnabledCheckbox as Checkbox,
  ProviderEnabledRequiredInput as RequiredInput,
  ProviderEnabledRequiredLabel as RequiredLabel,
  useProviderEnabledState as useState,
};
