"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { Fieldset } from "@publira/ui-components/fieldset";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { TenantEmailSettingsFormState } from "../email-types";

type SavedSettingsState = NonNullable<TenantEmailSettingsFormState>;

interface SmtpOverrideContextValue {
  canEdit: boolean;
  /** Whether the SMTP fields can be edited: the override is on for an admin. */
  interactive: boolean;
  setEnabled: (enabled: boolean) => void;
  enabled: boolean;
}

const SmtpOverrideContext = createContext<SmtpOverrideContextValue | null>(
  null
);

const useSmtpOverrideState = () => {
  const context = use(SmtpOverrideContext);
  if (!context) {
    throw new Error("SmtpOverride slots must be rendered inside SmtpOverride.");
  }
  return context;
};

/**
 * Whether the tenant sends over its own SMTP server, which opens the fields
 * below it and the connection test. Seeded once per mount; a save replaces it
 * with what the server confirmed.
 */
const SmtpOverride = ({
  canEdit,
  children,
  initialEnabled,
}: {
  canEdit: boolean;
  children: ReactNode;
  initialEnabled: boolean;
}) => {
  const [enabled, setEnabled] = useState(initialEnabled);
  const context = useMemo(
    () => ({
      canEdit,
      enabled,
      interactive: canEdit && enabled,
      setEnabled,
    }),
    [canEdit, enabled]
  );

  ActionForm.useSettled<SavedSettingsState>((settled) => {
    if (settled?.ok) {
      setEnabled(settled.settings.smtpOverrideEnabled);
    }
  });

  return <SmtpOverrideContext value={context}>{children}</SmtpOverrideContext>;
};

/** The checkbox the form posts as `smtp_override_enabled`, with `children` beside it. */
const SmtpOverrideCheckbox = ({ children }: { children: ReactNode }) => {
  const { canEdit, enabled, setEnabled } = useSmtpOverrideState();

  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <Checkbox
        checked={enabled}
        disabled={!canEdit}
        name="smtp_override_enabled"
        onCheckedChange={setEnabled}
      />
      {children}
    </label>
  );
};

/** The SMTP fields, closed while the tenant sends over the platform relay. */
const SmtpOverrideFieldset = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  const { interactive } = useSmtpOverrideState();

  return (
    <Fieldset className={className} disabled={!interactive}>
      {children}
    </Fieldset>
  );
};

/** An SMTP field's label, marked required while the fields are open. */
const SmtpOverrideSettingLabel = ({ children }: { children: ReactNode }) => {
  const { interactive } = useSmtpOverrideState();

  return <Field.Label required={interactive}>{children}</Field.Label>;
};

export {
  SmtpOverride as Root,
  SmtpOverrideCheckbox as Checkbox,
  SmtpOverrideFieldset as Fieldset,
  SmtpOverrideSettingLabel as SettingLabel,
  useSmtpOverrideState as useState,
};
