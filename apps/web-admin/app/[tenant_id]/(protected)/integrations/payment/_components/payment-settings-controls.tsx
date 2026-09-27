"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { createContext, use, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

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
 * Whether the tenant takes payments, which decides whether an unstored secret
 * is required. Seeded once per mount; the form keys it by the saved settings.
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

interface PaymentSecretContextValue {
  configured: boolean;
  hint: string;
  isEditing: boolean;
  name: string;
  required: boolean;
  setIsEditing: (isEditing: boolean) => void;
}

const PaymentSecretContext = createContext<PaymentSecretContextValue | null>(
  null
);

const usePaymentSecret = () => {
  const context = use(PaymentSecretContext);
  if (!context) {
    throw new Error(
      "PaymentSecret slots must be rendered inside PaymentSecret."
    );
  }
  return context;
};

/**
 * A write-only secret: a stored one shows only its hint until the operator
 * asks to replace it, and a successful save puts it back behind that hint.
 */
export const PaymentSecret = ({
  children,
  configured,
  disabled,
  hint,
  name,
}: {
  children: ReactNode;
  configured: boolean;
  disabled: boolean;
  hint: string;
  /** The field the form posts the new secret as. */
  name: string;
}) => {
  const { enabled } = usePaymentEnabled();
  const [isEditing, setIsEditing] = useState(false);
  const required = !disabled && enabled && !configured;
  const context = useMemo(
    () => ({ configured, hint, isEditing, name, required, setIsEditing }),
    [configured, hint, isEditing, name, required]
  );

  useActionFormSettled((settled) => {
    if (settled?.ok) {
      setIsEditing(false);
    }
  });

  return (
    <PaymentSecretContext value={context}>{children}</PaymentSecretContext>
  );
};

/** The field's label, required while payments are on and none is stored. */
export const PaymentSecretLabel = ({ children }: { children: ReactNode }) => {
  const { required } = usePaymentSecret();

  return <FieldLabel required={required}>{children}</FieldLabel>;
};

/**
 * The stored secret's hint and the control that opens it for replacing, whose
 * wording is `children`. Renders nothing while a new one is being entered.
 */
export const PaymentSecretStored = ({ children }: { children: ReactNode }) => {
  const { configured, hint, isEditing, setIsEditing } = usePaymentSecret();

  if (!configured || isEditing) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input disabled readOnly type="text" value={hint} />
      <Button
        onClick={() => {
          setIsEditing(true);
        }}
        type="button"
        variant="outline"
      >
        {children}
      </Button>
    </div>
  );
};

/**
 * The box for a new secret, and, when one is stored, the control that keeps
 * it instead, whose wording is `children`. Renders nothing while the stored one
 * is kept.
 */
export const PaymentSecretEditor = ({ children }: { children: ReactNode }) => {
  const { configured, isEditing, name, required, setIsEditing } =
    usePaymentSecret();

  if (configured && !isEditing) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        autoComplete="off"
        name={name}
        required={required}
        type="password"
      />
      {configured ? (
        <Button
          onClick={() => {
            setIsEditing(false);
          }}
          type="button"
          variant="outline"
        >
          {children}
        </Button>
      ) : null}
    </div>
  );
};
