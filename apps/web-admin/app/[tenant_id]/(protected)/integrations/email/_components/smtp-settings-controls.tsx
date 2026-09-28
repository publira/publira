"use client";

import {
  ActionFormSubmit,
  useActionFormSettled,
  useActionFormState,
} from "@publira/ui-components/action-form";
import type { ActionFormControlAction } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Checkbox } from "@publira/ui-components/checkbox";
import { DialogTrigger } from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Fieldset } from "@publira/ui-components/fieldset";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { createContext, use, useActionState, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "#lib/email-settings-shared";

import type {
  TenantEmailSettingsFormState,
  TenantSmtpTestFormState,
} from "../email-types";

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

const useSmtpOverride = () => {
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
export const SmtpOverride = ({
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

  useActionFormSettled<SavedSettingsState>((settled) => {
    if (settled?.ok) {
      setEnabled(settled.settings.smtpOverrideEnabled);
    }
  });

  return <SmtpOverrideContext value={context}>{children}</SmtpOverrideContext>;
};

/** The checkbox the form posts as `smtp_override_enabled`, with `children` beside it. */
export const SmtpOverrideCheckbox = ({ children }: { children: ReactNode }) => {
  const { canEdit, enabled, setEnabled } = useSmtpOverride();

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
export const SmtpOverrideFieldset = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  const { interactive } = useSmtpOverride();

  return (
    <Fieldset className={className} disabled={!interactive}>
      {children}
    </Fieldset>
  );
};

/** An SMTP field's label, marked required while the fields are open. */
export const SmtpSettingLabel = ({ children }: { children: ReactNode }) => {
  const { interactive } = useSmtpOverride();

  return <FieldLabel required={interactive}>{children}</FieldLabel>;
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

/** The password's label, required only while a new one is being entered. */
export const SmtpPasswordLabel = ({ children }: { children: ReactNode }) => {
  const { interactive } = useSmtpOverride();
  const { isEditing } = useSmtpPassword();

  return (
    <FieldLabel required={interactive && isEditing}>{children}</FieldLabel>
  );
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
  const { interactive } = useSmtpOverride();
  const { hasStoredPassword, isEditing, setIsEditing } = useSmtpPassword();

  if (hasStoredPassword && !isEditing) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        autoComplete="new-password"
        name="password"
        required={interactive && isEditing}
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

/**
 * Opens the connection test, whose wording is `children`. A test sends the
 * fields too, which a save in flight has closed and so left out of the form.
 */
export const SmtpTestTrigger = ({ children }: { children: ReactNode }) => {
  const { interactive } = useSmtpOverride();
  const { pending } = useFormStatus();

  return (
    <DialogTrigger
      render={
        <Button
          disabled={!interactive || pending}
          type="button"
          variant="outline"
        />
      }
    >
      {children}
    </DialogTrigger>
  );
};

interface SmtpTestContextValue {
  dispatch: ActionFormControlAction;
  form: string;
  isTesting: boolean;
  sendToSelf: boolean;
  setSendToSelf: (sendToSelf: boolean) => void;
  state: TenantSmtpTestFormState;
}

const SmtpTestContext = createContext<SmtpTestContextValue | null>(null);

const useSmtpTest = () => {
  const context = use(SmtpTestContext);
  if (!context) {
    throw new Error("SmtpTest slots must be rendered inside SmtpTest.");
  }
  return context;
};

/**
 * A test email sent with whatever the settings form holds, saved or not, as a
 * second submission of that form. `form` is its id: the dialog this sits in
 * portals out of the form, so the fields here join it through `form=`.
 */
export const SmtpTest = ({
  action,
  children,
  form,
}: {
  action: (
    prevState: TenantSmtpTestFormState,
    formData: FormData
  ) => Promise<TenantSmtpTestFormState>;
  children: ReactNode;
  form: string;
}) => {
  const [state, dispatch, isTesting] = useActionState(action, null);
  const [sendToSelf, setSendToSelf] = useState(true);
  const context = useMemo(
    () => ({ dispatch, form, isTesting, sendToSelf, setSendToSelf, state }),
    [dispatch, form, isTesting, sendToSelf, state]
  );

  return (
    <SmtpTestContext value={context}>
      <input
        form={form}
        name="recipient_type"
        type="hidden"
        value={String(
          sendToSelf
            ? TEST_EMAIL_RECIPIENT_TYPE_SELF
            : TEST_EMAIL_RECIPIENT_TYPE_CUSTOM
        )}
      />
      {children}
    </SmtpTestContext>
  );
};

/** Whether the test goes to the signed-in operator; `children` labels it. */
export const SmtpTestSendToSelf = ({ children }: { children: ReactNode }) => {
  const { isTesting, sendToSelf, setSendToSelf } = useSmtpTest();

  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <input
        checked={sendToSelf}
        disabled={isTesting}
        onChange={(event) => {
          setSendToSelf(event.target.checked);
        }}
        type="checkbox"
      />
      {children}
    </label>
  );
};

/**
 * The address to send to instead, labelled by `children`. Renders nothing
 * while the test goes to the operator.
 */
export const SmtpTestRecipient = ({ children }: { children: ReactNode }) => {
  const { form, isTesting, sendToSelf } = useSmtpTest();

  if (sendToSelf) {
    return null;
  }

  return (
    <Field>
      <FieldLabel required>{children}</FieldLabel>
      <FieldContent>
        <Input
          disabled={isTesting}
          form={form}
          name="recipient_email"
          placeholder="recipient@example.com"
          required
          type="email"
        />
      </FieldContent>
    </Field>
  );
};

/** What the last test answered. */
export const SmtpTestResult = () => {
  const { state } = useSmtpTest();

  return state ? (
    <FormMessage variant={state.ok ? "success" : "destructive"}>
      {state.message}
    </FormMessage>
  ) : null;
};

/** Sends the test. `children` is its wording, idle and pending. */
export const SmtpTestSubmit = ({ children }: { children: ReactNode }) => {
  const { dispatch, form } = useSmtpTest();

  return (
    <ActionFormSubmit form={form} formAction={dispatch} variant="outline">
      {children}
    </ActionFormSubmit>
  );
};
