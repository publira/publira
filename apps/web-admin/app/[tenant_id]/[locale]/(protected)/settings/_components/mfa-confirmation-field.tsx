import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

/** The second factors the signed-in account already holds. */
export interface MfaConfirmationFactors {
  authenticator: boolean;
  passkey: boolean;
}

interface MfaConfirmationFieldProps {
  factors: MfaConfirmationFactors;
  /** The form the field joins from a dialog's portal. */
  form?: string;
}

const MfaConfirmationHelp = ({
  factors,
}: Pick<MfaConfirmationFieldProps, "factors">) => {
  if (factors.authenticator && factors.passkey) {
    return (
      <Message message="admin.settings.mfa.confirmation_help_totp_or_passkey" />
    );
  }

  if (factors.authenticator) {
    return <Message message="admin.settings.mfa.confirmation_help_totp" />;
  }

  return <Message message="admin.settings.mfa.confirmation_help_passkey" />;
};

/**
 * The proof of an existing factor a form asks for before it adds a factor to
 * the account or removes one: a code from the authenticator app, or a
 * recovery code, typed in, or, when the account holds a passkey and the field
 * is left empty, an assertion `usePasskeyConfirmation` has one of them make.
 * An account that holds no factor yet adds its first without one, so the
 * field renders nothing for it.
 */
export const MfaConfirmationField = ({
  factors,
  form,
}: MfaConfirmationFieldProps) => {
  if (!(factors.authenticator || factors.passkey)) {
    return null;
  }

  return (
    <ActionForm.Fieldset>
      {factors.passkey ? (
        <input
          form={form}
          name="confirmation_passkey"
          type="hidden"
          value="true"
        />
      ) : null}
      <Field.Root>
        <Field.Label required={!factors.passkey}>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            {factors.authenticator ? (
              <Message message="admin.auth.mfa.code_label" />
            ) : (
              <Message message="admin.auth.mfa.recovery_code_label" />
            )}
          </Suspense>
        </Field.Label>
        <Field.Content>
          <Input
            autoComplete="one-time-code"
            form={form}
            // A recovery code carries letters and a separator, so the numeric
            // keypad would get in its way here.
            inputMode="text"
            name="confirmation_code"
            // A passkey confirms the change when the field is left empty.
            required={!factors.passkey}
            type="text"
          />
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <MfaConfirmationHelp factors={factors} />
            </Suspense>
          </Field.Description>
        </Field.Content>
      </Field.Root>
    </ActionForm.Fieldset>
  );
};
