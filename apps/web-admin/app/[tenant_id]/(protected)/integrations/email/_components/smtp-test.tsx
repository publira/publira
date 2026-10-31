"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { createContext, use, useActionState, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "#lib/email-settings-shared";

import type { TenantSmtpTestFormState } from "../email-types";
import * as SmtpOverride from "./smtp-override";

/**
 * Opens the connection test, whose wording is `children`. A test sends the
 * fields too, which a save in flight has closed and so left out of the form.
 */
const SmtpTestTrigger = ({ children }: { children: ReactNode }) => {
  const { interactive } = SmtpOverride.useState();
  const { pending } = useFormStatus();

  return (
    <Dialog.Trigger
      render={
        <Button
          disabled={!interactive || pending}
          type="button"
          variant="outline"
        />
      }
    >
      {children}
    </Dialog.Trigger>
  );
};

interface SmtpTestContextValue {
  dispatch: ActionForm.ControlAction;
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
const SmtpTest = ({
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
const SmtpTestSendToSelf = ({ children }: { children: ReactNode }) => {
  const { isTesting, sendToSelf, setSendToSelf } = useSmtpTest();

  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <Checkbox
        checked={sendToSelf}
        disabled={isTesting}
        onCheckedChange={setSendToSelf}
      />
      {children}
    </label>
  );
};

/**
 * The address to send to instead, labelled by `children`. Renders nothing
 * while the test goes to the operator.
 */
const SmtpTestRecipient = ({ children }: { children: ReactNode }) => {
  const { form, isTesting, sendToSelf } = useSmtpTest();

  if (sendToSelf) {
    return null;
  }

  return (
    <Field.Root>
      <Field.Label required>{children}</Field.Label>
      <Field.Content>
        <Input
          disabled={isTesting}
          form={form}
          name="recipient_email"
          placeholder="recipient@example.com"
          required
          type="email"
        />
      </Field.Content>
    </Field.Root>
  );
};

/** What the last test answered. */
const SmtpTestResult = () => {
  const { state } = useSmtpTest();

  return state ? (
    <FormMessage variant={state.ok ? "success" : "destructive"}>
      {state.message}
    </FormMessage>
  ) : null;
};

/** Sends the test. `children` is its wording, idle and pending. */
const SmtpTestSubmit = ({ children }: { children: ReactNode }) => {
  const { dispatch, form } = useSmtpTest();

  return (
    <ActionForm.Submit form={form} formAction={dispatch} variant="outline">
      {children}
    </ActionForm.Submit>
  );
};

export {
  SmtpTest as Root,
  SmtpTestRecipient as Recipient,
  SmtpTestResult as Result,
  SmtpTestSendToSelf as SendToSelf,
  SmtpTestSubmit as Submit,
  SmtpTestTrigger as Trigger,
};
