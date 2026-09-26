"use client";

import {
  useActionFormSettled,
  useActionFormState,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
} from "#lib/email-settings-shared";

import type { PlatformEmailSettingsFormState } from "../../_lib/actions";

type SavedSettingsState = NonNullable<PlatformEmailSettingsFormState>;

/**
 * The revision the next save is compared against: the one the page was read
 * at, then the one each successful save wrote.
 */
export const SmtpRevisionField = ({ revision }: { revision: string }) => {
  const state = useActionFormState<SavedSettingsState>();

  return (
    <input
      name="revision"
      type="hidden"
      value={state?.ok ? state.settings.revision : revision}
    />
  );
};

interface SmtpPasswordContextValue {
  hasStoredPassword: boolean;
  isEditing: boolean;
  setIsEditing: (isEditing: boolean) => void;
}

const SmtpPasswordContext = createContext<SmtpPasswordContextValue | null>(
  null
);

const useSmtpPassword = () => {
  const context = use(SmtpPasswordContext);
  if (!context) {
    throw new Error("SmtpPassword slots must be rendered inside SmtpPassword.");
  }
  return context;
};

/**
 * The SMTP password, which never reaches the browser once stored: it is shown
 * masked until the operator asks to change it, and a save that stores one puts
 * it back behind that mask.
 *
 * ```tsx
 * <SmtpPassword hasStoredPassword={…}>
 *   <Field>
 *     <SmtpPasswordLabel>…</SmtpPasswordLabel>
 *     <FieldContent>
 *       <SmtpPasswordStored>{change}</SmtpPasswordStored>
 *       <SmtpPasswordEditor>{undo}</SmtpPasswordEditor>
 *     </FieldContent>
 *   </Field>
 * </SmtpPassword>
 * ```
 */
export const SmtpPassword = ({
  children,
  hasStoredPassword: initialHasStoredPassword,
}: {
  children: ReactNode;
  hasStoredPassword: boolean;
}) => {
  const state = useActionFormState<SavedSettingsState>();
  const hasStoredPassword = state?.ok
    ? state.settings.hasPassword
    : initialHasStoredPassword;
  const [isEditing, setIsEditing] = useState(!initialHasStoredPassword);
  const context = useMemo(
    () => ({ hasStoredPassword, isEditing, setIsEditing }),
    [hasStoredPassword, isEditing]
  );

  useActionFormSettled<SavedSettingsState>((settled) => {
    if (settled?.ok) {
      setIsEditing(!settled.settings.hasPassword);
    }
  });

  const keepsStoredPassword = hasStoredPassword && !isEditing;

  return (
    <SmtpPasswordContext value={context}>
      {children}
      <input
        name="password_update_mode"
        type="hidden"
        value={String(
          keepsStoredPassword
            ? SECRET_UPDATE_MODE_UNCHANGED
            : SECRET_UPDATE_MODE_REPLACE
        )}
      />
    </SmtpPasswordContext>
  );
};

/** The field's label, required only while a new password is being entered. */
export const SmtpPasswordLabel = ({ children }: { children: ReactNode }) => {
  const { isEditing } = useSmtpPassword();

  return <FieldLabel required={isEditing}>{children}</FieldLabel>;
};

/**
 * The masked stored password and the control that opens it for editing, whose
 * wording is `children`. Renders nothing while a password is being entered.
 */
export const SmtpPasswordStored = ({ children }: { children: ReactNode }) => {
  const { hasStoredPassword, isEditing, setIsEditing } = useSmtpPassword();

  if (!hasStoredPassword || isEditing) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input defaultValue="****" disabled readOnly type="password" />
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
 * The box for a new password, and, when one is stored, the control that keeps
 * it instead, whose wording is `children`. Renders nothing while the stored one
 * is kept.
 */
export const SmtpPasswordEditor = ({ children }: { children: ReactNode }) => {
  const { hasStoredPassword, isEditing, setIsEditing } = useSmtpPassword();

  if (hasStoredPassword && !isEditing) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        autoComplete="new-password"
        name="password"
        required={isEditing}
        type="password"
      />
      {hasStoredPassword ? (
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
