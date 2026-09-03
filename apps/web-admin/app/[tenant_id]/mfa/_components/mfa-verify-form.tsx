"use client";

import { getMessage } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import Link from "next/link";
import { useActionState } from "react";

import { useAdminMessages } from "#components/admin-locale-context";
import { MfaCodeField } from "#components/mfa-code-field";

import { verifyMfaAction } from "../_lib/actions";

interface MfaVerifyFormProps {
  /** Where the login was heading before the second factor interrupted it. */
  nextPath: string;
  tenantId: string;
}

export const MfaVerifyForm = ({ nextPath, tenantId }: MfaVerifyFormProps) => {
  const messages = useAdminMessages();
  const [state, formAction, isPending] = useActionState(verifyMfaAction, null);

  // Only a recovery code answers here: a code from the authenticator finishes
  // the login and the Action redirects, so this branch means one of the ten is
  // now spent and the operator should know how many are left.
  if (state?.ok) {
    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <h2 className="font-medium text-foreground">
          {getMessage(messages, "admin.auth.mfa.recovery_used_title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {getMessage(messages, "admin.auth.mfa.recovery_used_description", {
            count: String(state.remainingRecoveryCodes),
          })}
        </p>
        <LinkButton className="w-full" render={<Link href={nextPath} />}>
          {getMessage(messages, "admin.auth.mfa.continue_to_console")}
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <p className="text-sm text-muted-foreground">
        {getMessage(messages, "admin.auth.mfa.verify_description")}
      </p>

      <form action={formAction} className="space-y-4">
        <input name="tenant_id" type="hidden" value={tenantId} />

        <MfaCodeField allowRecoveryCode disabled={isPending} />

        {state && !state.ok ? (
          <FormMessage variant="destructive">{state.message}</FormMessage>
        ) : null}

        <Button className="mt-2 w-full" disabled={isPending} type="submit">
          {getMessage(
            messages,
            isPending
              ? "admin.auth.mfa.verify_submitting"
              : "admin.auth.mfa.verify_submit"
          )}
        </Button>
      </form>

      <div className="text-center text-sm">
        <Link
          className="font-medium text-primary hover:underline"
          href="/login"
        >
          {getMessage(messages, "admin.auth.mfa.back_to_login")}
        </Link>
      </div>
    </div>
  );
};
