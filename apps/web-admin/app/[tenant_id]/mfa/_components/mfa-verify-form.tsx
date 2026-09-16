"use client";

import {
  AuthScreenBody,
  AuthScreenFooter,
  AuthScreenNote,
} from "@publira/layouts/auth-screen";
import { Button, LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import Link from "next/link";
import { useActionState } from "react";

import { ClientMessage } from "#components/client-message";
import { MfaCodeField } from "#components/mfa-code-field";

import { verifyMfaAction } from "../_lib/actions";

interface MfaVerifyFormProps {
  /** Where the login was heading before the second factor interrupted it. */
  nextPath: string;
  tenantId: string;
}

/** The submit label names the state the form is in, so each state has a key. */
const MfaVerifySubmitLabel = ({ isPending }: { isPending: boolean }) =>
  isPending ? (
    <ClientMessage message="admin.auth.mfa.verify_submitting" />
  ) : (
    <ClientMessage message="admin.auth.mfa.verify_submit" />
  );

export const MfaVerifyForm = ({ nextPath, tenantId }: MfaVerifyFormProps) => {
  const [state, formAction, isPending] = useActionState(verifyMfaAction, null);

  // Only a recovery code answers here: a code from the authenticator finishes
  // the login and the Action redirects, so this branch means one of the ten is
  // now spent and the operator should know how many are left.
  if (state?.ok) {
    return (
      <AuthScreenBody>
        <h2 className="font-medium text-foreground">
          <ClientMessage message="admin.auth.mfa.recovery_used_title" />
        </h2>
        <AuthScreenNote>
          <ClientMessage
            message="admin.auth.mfa.recovery_used_description"
            values={{ count: String(state.remainingRecoveryCodes) }}
          />
        </AuthScreenNote>
        <LinkButton
          className="justify-self-start"
          render={<Link href={nextPath} />}
        >
          <ClientMessage message="admin.auth.mfa.continue_to_console" />
        </LinkButton>
      </AuthScreenBody>
    );
  }

  return (
    <>
      <AuthScreenBody>
        <AuthScreenNote>
          <ClientMessage message="admin.auth.mfa.verify_description" />
        </AuthScreenNote>

        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />

          <MfaCodeField allowRecoveryCode disabled={isPending} />

          {state && !state.ok ? (
            <FormMessage variant="destructive">{state.message}</FormMessage>
          ) : null}

          <Button
            className="justify-self-start"
            disabled={isPending}
            type="submit"
          >
            <MfaVerifySubmitLabel isPending={isPending} />
          </Button>
        </form>
      </AuthScreenBody>

      <AuthScreenFooter>
        <p>
          <Link
            className="text-primary underline underline-offset-4"
            href="/login"
          >
            <ClientMessage message="admin.auth.mfa.back_to_login" />
          </Link>
        </p>
      </AuthScreenFooter>
    </>
  );
};
