import {
  AuthScreenBody,
  AuthScreenFooter,
  AuthScreenNote,
} from "@publira/layouts/auth-screen";
import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { MfaCodeField } from "#components/mfa-code-field";

import { verifyMfaAction } from "../_lib/actions";
import {
  MfaRecoveryCodeSpent,
  MfaRemainingRecoveryCodes,
  MfaVerifySteps,
} from "./mfa-verify-steps";

interface MfaVerifyFormProps {
  /** Whether the challenge has already been spent. */
  finished: boolean;
  /** Where the login was heading before the second factor interrupted it. */
  nextPath: string;
  tenantId: string;
}

export const MfaVerifyForm = ({
  finished,
  nextPath,
  tenantId,
}: MfaVerifyFormProps) => (
  <MfaVerifySteps
    finished={finished}
    nextPath={nextPath}
    spent={
      <AuthScreenBody>
        <h2 className="font-medium text-foreground">
          <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
            <Message message="admin.auth.mfa.recovery_used_title" />
          </Suspense>
        </h2>
        <AuthScreenNote>
          <MfaRemainingRecoveryCodes />
        </AuthScreenNote>
        <LinkButton
          className="justify-self-start"
          render={<Link href={nextPath} />}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.auth.mfa.continue_to_console" />
          </Suspense>
        </LinkButton>
      </AuthScreenBody>
    }
    verify={
      <>
        <AuthScreenBody>
          <AuthScreenNote>
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <Message message="admin.auth.mfa.verify_description" />
            </Suspense>
          </AuthScreenNote>

          <ActionForm
            action={verifyMfaAction}
            className="grid gap-4"
            showSuccess={false}
          >
            <input name="tenant_id" type="hidden" value={tenantId} />
            <MfaRecoveryCodeSpent />

            <MfaCodeField allowRecoveryCode />

            <ActionFormSubmit className="justify-self-start">
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <ActionFormIdle>
                  <Message message="admin.auth.mfa.verify_submit" />
                </ActionFormIdle>
                <ActionFormPending>
                  <Message message="admin.auth.mfa.verify_submitting" />
                </ActionFormPending>
              </Suspense>
            </ActionFormSubmit>
          </ActionForm>
        </AuthScreenBody>

        <AuthScreenFooter>
          <p>
            <Link
              className="text-primary underline underline-offset-4"
              href="/login"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
                <Message message="admin.auth.mfa.back_to_login" />
              </Suspense>
            </Link>
          </p>
        </AuthScreenFooter>
      </>
    }
  />
);
