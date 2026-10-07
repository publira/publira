"use client";

/**
 * The controls of a settings form whose provider is chosen from the ones the
 * server registers and whose credential fields that provider declares: the
 * payment provider and the inbound email provider. The form posts `provider`,
 * `enabled`, and for each field `credential_<name>`, `credential_<name>_mode`,
 * and `credential_<name>_configured`, which `#lib/provider-credential-form`
 * reads back.
 */

import { useActionFormSettled } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Checkbox } from "@publira/ui-components/checkbox";
import { FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import type { InputProps } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface ProviderChoiceContextValue {
  credentialsProvider: string;
  provider: string;
  setProvider: (provider: string) => void;
}

const ProviderChoiceContext = createContext<ProviderChoiceContextValue | null>(
  null
);

const useProviderChoice = () => {
  const context = use(ProviderChoiceContext);
  if (!context) {
    throw new Error(
      "ProviderChoice slots must be rendered inside ProviderChoice."
    );
  }
  return context;
};

/**
 * The provider being configured, which decides whose credential fields and
 * webhook URL are shown. Seeded once per mount; the form keys it by the saved
 * settings.
 */
export const ProviderChoice = ({
  children,
  credentialsProvider,
  initialProvider,
}: {
  children: ReactNode;
  /** The provider whose credentials are stored, or empty when none are. */
  credentialsProvider: string;
  initialProvider: string;
}) => {
  const [provider, setProvider] = useState(initialProvider);
  const context = useMemo(
    () => ({ credentialsProvider, provider, setProvider }),
    [credentialsProvider, provider]
  );

  return (
    <ProviderChoiceContext value={context}>{children}</ProviderChoiceContext>
  );
};

/** The select, posted as `provider`. Each option is the provider's own name. */
export const ProviderSelect = ({
  providers,
}: {
  providers: readonly { displayName: string; id: string }[];
}) => {
  const { provider, setProvider } = useProviderChoice();

  return (
    <>
      <Select
        disabled={providers.length === 0}
        items={providers.map((candidate) => ({
          label: candidate.displayName,
          value: candidate.id,
        }))}
        onValueChange={setProvider}
        value={provider}
      />
      <input name="provider" type="hidden" value={provider} />
    </>
  );
};

/** Renders its children while `provider` is the one chosen. */
export const ProviderPanel = ({
  children,
  provider,
}: {
  children: ReactNode;
  provider: string;
}) => (useProviderChoice().provider === provider ? children : null);

/**
 * Renders its children while the chosen provider is not the one whose
 * credentials are stored, which a save would clear.
 */
export const ProviderChangeNotice = ({ children }: { children: ReactNode }) => {
  const { credentialsProvider, provider } = useProviderChoice();

  return credentialsProvider !== "" && provider !== credentialsProvider
    ? children
    : null;
};

interface ProviderEnabledContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

const ProviderEnabledContext =
  createContext<ProviderEnabledContextValue | null>(null);

const useProviderEnabled = () => {
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
export const ProviderEnabled = ({
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
export const ProviderEnabledCheckbox = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { enabled, setEnabled } = useProviderEnabled();

  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <Checkbox checked={enabled} name="enabled" onCheckedChange={setEnabled} />
      {children}
    </label>
  );
};

/** A setting's label, marked required while the provider is on. */
export const ProviderEnabledRequiredLabel = ({
  children,
}: {
  children: ReactNode;
}) => (
  <FieldLabel required={useProviderEnabled().enabled}>{children}</FieldLabel>
);

/** A setting the provider needs once it is on, required from then. */
export const ProviderEnabledRequiredInput = (
  props: Omit<InputProps, "required">
) => <Input {...props} required={useProviderEnabled().enabled} />;

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
export const ProviderCredential = ({
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
  const { enabled } = useProviderEnabled();
  const [mode, setMode] = useState(() => initialMode(configured));
  const required = declaredRequired && !disabled && enabled && !configured;
  const context = useMemo(
    () => ({ configured, hint, mode, name, required, setMode }),
    [configured, hint, mode, name, required]
  );

  useActionFormSettled((settled) => {
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
export const ProviderCredentialLabel = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { required } = useProviderCredential();

  return <FieldLabel required={required}>{children}</FieldLabel>;
};

/** Renders its children while the credential is in `mode`. */
export const ProviderCredentialWhile = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: ProviderCredentialMode;
}) => (useProviderCredential().mode === mode ? children : null);

/** Switches the credential to `mode`; `children` is the control's wording. */
export const ProviderCredentialModeButton = ({
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
export const ProviderCredentialHint = () => {
  const { hint } = useProviderCredential();

  return <Input disabled readOnly type="text" value={hint} />;
};

/** The box for a new secret, posted as `credential_<name>`. */
export const ProviderCredentialSecretInput = () => {
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
export const ProviderCredentialTextInput = () => {
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
