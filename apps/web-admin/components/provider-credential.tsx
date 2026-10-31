"use client";

/**
 * The controls of a settings form whose provider is chosen from the ones the
 * server registers and whose credential fields that provider declares: the
 * payment provider and the inbound email provider. The form posts `provider`,
 * `enabled`, and for each field `credential_<name>`, `credential_<name>_mode`,
 * and `credential_<name>_configured`, which `#lib/provider-credential-form`
 * reads back.
 */

import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import * as ProviderEnabled from "./provider-enabled";

type ProviderCredentialMode = "clear" | "keep" | "replace";

interface ProviderCredentialContextValue {
  configured: boolean;
  hint: string;
  mode: ProviderCredentialMode;
  name: string;
  required: boolean;
  setMode: (mode: ProviderCredentialMode) => void;
}

const ProviderCredentialContext =
  createContext<ProviderCredentialContextValue | null>(null);

const useProviderCredential = () => {
  const context = use(ProviderCredentialContext);

  if (!context) {
    throw new Error(
      "ProviderCredential slots must be rendered inside ProviderCredential."
    );
  }

  return context;
};

const initialMode = (configured: boolean): ProviderCredentialMode =>
  configured ? "keep" : "replace";

/**
 * One credential the provider declares. The mode travels with the form as
 * `credential_<name>_mode` so the Action can tell "left as it is" from
 * "removed", and a successful save puts a secret back behind its hint.
 */
const ProviderCredential = ({
  children,
  configured,
  disabled,
  hint,
  name,
  required: declaredRequired,
}: {
  children: ReactNode;
  configured: boolean;
  disabled: boolean;
  hint: string;
  /** The field's name as the provider declares it. */
  name: string;
  /** Whether the provider needs the field before it is turned on. */
  required: boolean;
}) => {
  const { enabled } = ProviderEnabled.useState();
  const [mode, setMode] = useState(() => initialMode(configured));
  const required = declaredRequired && !disabled && enabled && !configured;

  const context = useMemo(
    () => ({ configured, hint, mode, name, required, setMode }),
    [configured, hint, mode, name, required]
  );

  ActionForm.useSettled((settled) => {
    if (settled?.ok) {
      setMode(initialMode(configured));
    }
  });

  return (
    <ProviderCredentialContext value={context}>
      <input name={`credential_${name}_mode`} type="hidden" value={mode} />
      <input
        name={`credential_${name}_configured`}
        type="hidden"
        value={configured ? "1" : "0"}
      />
      {children}
    </ProviderCredentialContext>
  );
};

/** The field's label, required while the provider is on and none is stored. */
const ProviderCredentialLabel = ({ children }: { children: ReactNode }) => {
  const { required } = useProviderCredential();

  return <Field.Label required={required}>{children}</Field.Label>;
};

/** Renders its children while the credential is in `mode`. */
const ProviderCredentialWhile = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: ProviderCredentialMode;
}) => (useProviderCredential().mode === mode ? children : null);

/** Switches the credential to `mode`; `children` is the control's wording. */
const ProviderCredentialModeButton = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: ProviderCredentialMode;
}) => {
  const { setMode } = useProviderCredential();

  return (
    <Button
      onClick={() => {
        setMode(mode);
      }}
      type="button"
      variant="outline"
    >
      {children}
    </Button>
  );
};

/** The stored secret's masked hint, which is all a secret is ever shown as. */
const ProviderCredentialHint = () => {
  const { hint } = useProviderCredential();

  return <Input disabled readOnly type="text" value={hint} />;
};

/** The box for a new secret, posted as `credential_<name>`. */
const ProviderCredentialSecretInput = () => {
  const { name, required } = useProviderCredential();

  return (
    <Input
      autoComplete="off"
      name={`credential_${name}`}
      required={required}
      type="password"
    />
  );
};

/**
 * A credential that is not secret, shown as stored and edited in place.
 * Emptying a stored one removes it, and leaving it as stored keeps it.
 */
const ProviderCredentialTextInput = () => {
  const { configured, hint, name, required, setMode } = useProviderCredential();

  return (
    <Input
      autoComplete="off"
      defaultValue={hint}
      name={`credential_${name}`}
      onChange={(event) => {
        const value = event.target.value.trim();

        if (!configured) {
          setMode("replace");
        } else if (value === hint.trim()) {
          setMode("keep");
        } else {
          setMode(value === "" ? "clear" : "replace");
        }
      }}
      required={required}
      spellCheck={false}
      type="text"
    />
  );
};

export {
  ProviderCredential as Root,
  ProviderCredentialHint as Hint,
  ProviderCredentialLabel as Label,
  ProviderCredentialModeButton as ModeButton,
  ProviderCredentialSecretInput as SecretInput,
  ProviderCredentialTextInput as TextInput,
  ProviderCredentialWhile as While,
};
