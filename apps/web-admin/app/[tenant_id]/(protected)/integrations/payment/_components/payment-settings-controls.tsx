"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { createContext, use, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface PaymentProviderChoiceContextValue {
  credentialsProvider: string;
  provider: string;
  selectId: string;
  setProvider: (provider: string) => void;
}

const PaymentProviderChoiceContext =
  createContext<PaymentProviderChoiceContextValue | null>(null);

const usePaymentProviderChoice = () => {
  const context = use(PaymentProviderChoiceContext);
  if (!context) {
    throw new Error(
      "PaymentProviderChoice slots must be rendered inside PaymentProviderChoice."
    );
  }
  return context;
};

/**
 * The provider being configured, which decides whose credential fields and
 * webhook URL are shown. Seeded once per mount; the form keys it by the saved
 * settings.
 */
export const PaymentProviderChoice = ({
  children,
  credentialsProvider,
  initialProvider,
}: {
  children: ReactNode;
  /** The provider whose credentials are stored, or empty when none are. */
  credentialsProvider: string;
  initialProvider: string;
}) => {
  const selectId = useId();
  const [provider, setProvider] = useState(initialProvider);
  const context = useMemo(
    () => ({ credentialsProvider, provider, selectId, setProvider }),
    [credentialsProvider, provider, selectId]
  );

  return (
    <PaymentProviderChoiceContext value={context}>
      {children}
    </PaymentProviderChoiceContext>
  );
};

/** The field's label, pointing at the select. */
export const PaymentProviderLabel = ({ children }: { children: ReactNode }) => {
  const { selectId } = usePaymentProviderChoice();

  return <FieldLabel htmlFor={selectId}>{children}</FieldLabel>;
};

/** The select, posted as `provider`. Each option is the provider's own name. */
export const PaymentProviderSelect = ({
  providers,
}: {
  providers: readonly { displayName: string; id: string }[];
}) => {
  const { provider, selectId, setProvider } = usePaymentProviderChoice();

  return (
    <>
      <Select
        disabled={providers.length === 0}
        id={selectId}
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
export const PaymentProviderPanel = ({
  children,
  provider,
}: {
  children: ReactNode;
  provider: string;
}) => (usePaymentProviderChoice().provider === provider ? children : null);

/**
 * Renders its children while the chosen provider is not the one whose
 * credentials are stored, which a save would clear.
 */
export const PaymentProviderChangeNotice = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { credentialsProvider, provider } = usePaymentProviderChoice();

  return credentialsProvider !== "" && provider !== credentialsProvider
    ? children
    : null;
};

interface PaymentEnabledContextValue {
  checkboxId: string;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

const PaymentEnabledContext = createContext<PaymentEnabledContextValue | null>(
  null
);

const usePaymentEnabled = () => {
  const context = use(PaymentEnabledContext);
  if (!context) {
    throw new Error(
      "PaymentEnabled slots must be rendered inside PaymentEnabled."
    );
  }
  return context;
};

/**
 * Whether the tenant takes payments, which decides whether an unstored
 * required credential has to be entered. Seeded once per mount; the form keys
 * it by the saved settings.
 */
export const PaymentEnabled = ({
  children,
  initialEnabled,
}: {
  children: ReactNode;
  initialEnabled: boolean;
}) => {
  const checkboxId = useId();
  const [enabled, setEnabled] = useState(initialEnabled);
  const context = useMemo(
    () => ({ checkboxId, enabled, setEnabled }),
    [checkboxId, enabled]
  );

  return (
    <PaymentEnabledContext value={context}>{children}</PaymentEnabledContext>
  );
};

/** The field's label, pointing at the checkbox. */
export const PaymentEnabledLabel = ({ children }: { children: ReactNode }) => {
  const { checkboxId } = usePaymentEnabled();

  return <FieldLabel htmlFor={checkboxId}>{children}</FieldLabel>;
};

/** The checkbox the form posts as `enabled`, with `children` beside it. */
export const PaymentEnabledCheckbox = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { checkboxId, enabled, setEnabled } = usePaymentEnabled();

  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <input
        checked={enabled}
        id={checkboxId}
        name="enabled"
        onChange={(event) => {
          setEnabled(event.target.checked);
        }}
        type="checkbox"
      />
      {children}
    </label>
  );
};

type PaymentCredentialMode = "clear" | "keep" | "replace";

interface PaymentCredentialContextValue {
  configured: boolean;
  hint: string;
  mode: PaymentCredentialMode;
  name: string;
  required: boolean;
  setMode: (mode: PaymentCredentialMode) => void;
}

const PaymentCredentialContext =
  createContext<PaymentCredentialContextValue | null>(null);

const usePaymentCredential = () => {
  const context = use(PaymentCredentialContext);
  if (!context) {
    throw new Error(
      "PaymentCredential slots must be rendered inside PaymentCredential."
    );
  }
  return context;
};

const initialMode = (configured: boolean): PaymentCredentialMode =>
  configured ? "keep" : "replace";

/**
 * One credential the provider declares. The mode travels with the form as
 * `credential_<name>_mode` so the Action can tell "left as it is" from
 * "removed", and a successful save puts a secret back behind its hint.
 */
export const PaymentCredential = ({
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
  /** Whether the provider needs the field before it takes payments. */
  required: boolean;
}) => {
  const { enabled } = usePaymentEnabled();
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
    <PaymentCredentialContext value={context}>
      <input name={`credential_${name}_mode`} type="hidden" value={mode} />
      <input
        name={`credential_${name}_configured`}
        type="hidden"
        value={configured ? "1" : "0"}
      />
      {children}
    </PaymentCredentialContext>
  );
};

/** The field's label, required while payments are on and none is stored. */
export const PaymentCredentialLabel = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { required } = usePaymentCredential();

  return <FieldLabel required={required}>{children}</FieldLabel>;
};

/** Renders its children while the credential is in `mode`. */
export const PaymentCredentialWhile = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: PaymentCredentialMode;
}) => (usePaymentCredential().mode === mode ? children : null);

/** Switches the credential to `mode`; `children` is the control's wording. */
export const PaymentCredentialModeButton = ({
  children,
  mode,
}: {
  children: ReactNode;
  mode: PaymentCredentialMode;
}) => {
  const { setMode } = usePaymentCredential();

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
export const PaymentCredentialHint = () => {
  const { hint } = usePaymentCredential();

  return <Input disabled readOnly type="text" value={hint} />;
};

/** The box for a new secret, posted as `credential_<name>`. */
export const PaymentCredentialSecretInput = () => {
  const { name, required } = usePaymentCredential();

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
export const PaymentCredentialTextInput = () => {
  const { configured, hint, name, required, setMode } = usePaymentCredential();

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
