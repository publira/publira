"use client";

import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface CredentialsEnabledContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

const CredentialsEnabledContext =
  createContext<CredentialsEnabledContextValue | null>(null);

const useCredentialsEnabled = () => {
  const context = use(CredentialsEnabledContext);

  if (!context) {
    throw new Error(
      "CredentialsEnabled slots must be rendered inside CredentialsEnabled."
    );
  }

  return context;
};

/**
 * Whether one outside service is switched on, which marks its credentials
 * required. Seeded once per mount; the form keys it by the saved settings.
 */
const CredentialsEnabled = ({
  children,
  initialEnabled,
}: {
  children: ReactNode;
  initialEnabled: boolean;
}) => {
  const [enabled, setEnabled] = useState(initialEnabled);
  const context = useMemo(() => ({ enabled, setEnabled }), [enabled]);

  return (
    <CredentialsEnabledContext value={context}>
      {children}
    </CredentialsEnabledContext>
  );
};

/** The service's switch, posted as `name`, with `children` beside it. */
const CredentialsEnabledCheckbox = ({
  children,
  name,
}: {
  children: ReactNode;
  name: string;
}) => {
  const { enabled, setEnabled } = useCredentialsEnabled();

  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <Checkbox checked={enabled} name={name} onCheckedChange={setEnabled} />
      {children}
    </label>
  );
};

/** A credential's label, marked required while its service is switched on. */
const CredentialsEnabledLabel = ({ children }: { children: ReactNode }) => {
  const { enabled } = useCredentialsEnabled();

  return <Field.Label required={enabled}>{children}</Field.Label>;
};

export {
  CredentialsEnabled as Root,
  CredentialsEnabledCheckbox as Checkbox,
  CredentialsEnabledLabel as Label,
};
