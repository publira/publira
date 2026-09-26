"use client";

import { ActionFormSubmit } from "@publira/ui-components/action-form";
import type { ActionFormControlAction } from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { createContext, use, useActionState, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "#lib/email-settings-shared";

import type { PlatformSmtpTestFormState } from "../_lib/actions";

interface SmtpTestContextValue {
  dispatch: ActionFormControlAction;
  form: string;
  sendToSelf: boolean;
  setSendToSelf: (sendToSelf: boolean) => void;
  state: PlatformSmtpTestFormState;
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
    prevState: PlatformSmtpTestFormState,
    formData: FormData
  ) => Promise<PlatformSmtpTestFormState>;
  children: ReactNode;
  form: string;
}) => {
  const [state, dispatch] = useActionState(action, null);
  const [sendToSelf, setSendToSelf] = useState(true);
  const context = useMemo(
    () => ({ dispatch, form, sendToSelf, setSendToSelf, state }),
    [dispatch, form, sendToSelf, state]
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
  const { sendToSelf, setSendToSelf } = useSmtpTest();

  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <input
        checked={sendToSelf}
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
  const { form, sendToSelf } = useSmtpTest();

  if (sendToSelf) {
    return null;
  }

  return (
    <Field>
      <FieldLabel required>{children}</FieldLabel>
      <FieldContent>
        <Input
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
