"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import * as PasswordInput from "@publira/ui-components/password-input";
import { createContext, use, useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ClientMessage } from "#components/client-message";
import { usePasskeyConfirmation } from "#components/passkey-ceremony";
import type { PasskeyFailure } from "#components/passkey-ceremony";
import type { ReauthenticationRequiredState } from "#lib/reauthentication";
import {
  beginReauthenticationPasskeyAction,
  reauthenticateAction,
} from "#lib/reauthentication-actions";

type ReauthenticationAsked = ReauthenticationRequiredState["reauthentication"];

/** Asks the operator to re-authenticate, then sends `form` again. */
type Ask = (form: HTMLFormElement, request: ReauthenticationAsked) => void;

const ReauthenticationContext = createContext<Ask | null>(null);

const isReauthenticationRequired = (
  state: ActionForm.Result | null
): state is ReauthenticationRequiredState =>
  state !== null && !state.ok && "reauthentication" in state;

/** Closes the dialog and sends the refused form again once the proof is in. */
const ReauthenticationConfirmed = ({
  onConfirmed,
}: {
  onConfirmed: () => void;
}) => {
  ActionForm.useSettled((state) => {
    if (state?.ok) {
      onConfirmed();
    }
  });

  return null;
};

const ReauthenticationForm = ({
  onConfirmed,
  request,
}: {
  onConfirmed: () => void;
  request: ReauthenticationAsked;
}) => {
  const confirmed = usePasskeyConfirmation<ActionForm.State>(
    beginReauthenticationPasskeyAction,
    reauthenticateAction
  );

  return (
    <ActionForm.Root<ActionForm.Result | PasskeyFailure>
      action={confirmed}
      className="mt-4 grid gap-4"
      showSuccess={false}
    >
      <ReauthenticationConfirmed onConfirmed={onConfirmed} />
      <input name="tenant_id" type="hidden" value={request.tenantId} />
      <ActionForm.Fieldset className="grid gap-4">
        <Field.Root>
          <Field.Label>
            <ClientMessage message="admin.reauthentication.password_label" />
          </Field.Label>
          <Field.Content>
            <PasswordInput.Root>
              <PasswordInput.Control
                autoComplete="current-password"
                name="password"
              />
              <PasswordInput.Toggle>
                <ClientMessage message="admin.common.show_password" />
              </PasswordInput.Toggle>
            </PasswordInput.Root>
            <ActionForm.FieldError name="password" />
          </Field.Content>
        </Field.Root>
        {request.authenticator ? (
          <Field.Root>
            <Field.Label>
              <ClientMessage message="admin.reauthentication.code_label" />
            </Field.Label>
            <Field.Content>
              <Input
                autoComplete="one-time-code"
                // A recovery code carries letters and a separator, so the
                // numeric keypad would get in its way here.
                inputMode="text"
                name="confirmation_code"
                type="text"
              />
              <Field.Description>
                <ClientMessage message="admin.reauthentication.code_description" />
              </Field.Description>
            </Field.Content>
          </Field.Root>
        ) : null}
      </ActionForm.Fieldset>
      <Dialog.Footer>
        <Dialog.Close render={<Button type="button" variant="outline" />}>
          <ClientMessage message="admin.common.cancel" />
        </Dialog.Close>
        {request.passkey ? (
          // `usePasskeyConfirmation` has a passkey make the proof when the
          // form carries this pair and no code.
          <ActionForm.Submit
            name="confirmation_passkey"
            value="true"
            variant="outline"
          >
            <ClientMessage message="admin.reauthentication.use_passkey" />
          </ActionForm.Submit>
        ) : null}
        <ActionForm.Submit>
          <ActionForm.Idle>
            <ClientMessage message="admin.reauthentication.submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <ClientMessage message="admin.reauthentication.submitting" />
          </ActionForm.Pending>
        </ActionForm.Submit>
      </Dialog.Footer>
    </ActionForm.Root>
  );
};

/**
 * Where a refusal for want of a re-authentication is answered: a dialog that
 * asks the operator for their password, a code, or a passkey, and then sends
 * the refused form again with the step-up token the proof earned.
 *
 * The signed-in layout places it once, around every screen, and each form
 * whose Action calls `withReauthentication` holds a
 * `Reauthentication.Request`. The dialog is rendered here rather than inside
 * the form, so its own form is not nested in the refused one, in the DOM or
 * in the React tree a submit event bubbles through.
 */
export const ReauthenticationRoot = ({ children }: { children: ReactNode }) => {
  const [pending, setPending] = useState<{
    form: HTMLFormElement;
    request: ReauthenticationAsked;
  } | null>(null);

  // Every request opens on an empty form, not on what was typed last time.
  const [attempt, setAttempt] = useState(0);

  const ask = useCallback<Ask>((form, request) => {
    setPending({ form, request });
    setAttempt((current) => current + 1);
  }, []);

  return (
    <ReauthenticationContext value={ask}>
      {children}
      <Dialog.Root
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
          }
        }}
        open={pending !== null}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="z-50" />
          <Dialog.Viewport>
            <Dialog.Popup className="z-60 w-[min(92vw,28rem)]">
              <Dialog.Header>
                <Dialog.Title className="text-lg font-semibold">
                  <ClientMessage message="admin.reauthentication.title" />
                </Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  <ClientMessage message="admin.reauthentication.description" />
                </Dialog.Description>
              </Dialog.Header>
              {pending ? (
                <ReauthenticationForm
                  key={attempt}
                  onConfirmed={() => {
                    setPending(null);
                    pending.form.requestSubmit();
                  }}
                  request={pending.request}
                />
              ) : null}
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </ReauthenticationContext>
  );
};

/**
 * Placed in a form whose Action calls `withReauthentication`: when the Action
 * answers that the API asked for a re-authentication, it hands the form to the
 * surrounding `Reauthentication.Root`.
 */
export const ReauthenticationRequest = () => {
  const ask = use(ReauthenticationContext);
  const fieldRef = useRef<HTMLInputElement>(null);

  // Outside a Root, as a form rendered on its own is, the refusal is left to
  // the form's own message: there is no dialog to ask in.
  ActionForm.useSettled((state) => {
    const form = fieldRef.current?.form;

    if (ask && form && isReauthenticationRequired(state)) {
      ask(form, state.reauthentication);
    }
  });

  // An unnamed field submits nothing; it is here for the form it sits in.
  return <input ref={fieldRef} type="hidden" />;
};

export { ReauthenticationRequest as Request, ReauthenticationRoot as Root };
