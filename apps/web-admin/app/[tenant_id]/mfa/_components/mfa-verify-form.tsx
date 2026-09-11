"use client";

import {
  AuthScreenBody,
  AuthScreenFooter,
  AuthScreenNote,
} from "@publira/layouts/auth-screen";
import { Button, LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense, useActionState } from "react";

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
          <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
            <ClientMessage message="admin.auth.mfa.recovery_used_title" />
          </Suspense>
        </h2>
        <AuthScreenNote>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <ClientMessage
              message="admin.auth.mfa.recovery_used_description"
              values={{ count: String(state.remainingRecoveryCodes) }}
            />
          </Suspense>
        </AuthScreenNote>
        <LinkButton
          className="justify-self-start"
          render={<Link href={nextPath} />}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <ClientMessage message="admin.auth.mfa.continue_to_console" />
          </Suspense>
        </LinkButton>
      </AuthScreenBody>
    );
  }

  return (
    <>
      <AuthScreenBody>
        <AuthScreenNote>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <ClientMessage message="admin.auth.mfa.verify_description" />
          </Suspense>
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
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <MfaVerifySubmitLabel isPending={isPending} />
            </Suspense>
          </Button>
        </form>
      </AuthScreenBody>

      <AuthScreenFooter>
        <p>
          <Link
            className="text-primary underline underline-offset-4"
            href="/login"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.auth.mfa.back_to_login" />
            </Suspense>
          </Link>
        </p>
      </AuthScreenFooter>
    </>
  );
};
