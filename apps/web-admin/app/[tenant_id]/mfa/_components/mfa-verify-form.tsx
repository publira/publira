import * as AuthScreen from "@publira/layouts/auth-screen";
import * as ActionForm from "@publira/ui-components/action-form";
import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { MfaCodeField } from "#components/mfa-code-field";
import type { MfaMethodName } from "#lib/mfa-challenge";

import { verifyMfaAction } from "../_lib/actions";
import {
  MfaRecoveryCodeSpent,
  MfaRemainingRecoveryCodes,
  MfaVerifyMethods,
  MfaVerifyMethodSwitch,
  MfaVerifySteps,
} from "./mfa-verify-steps";
import { PasskeyVerifyForm } from "./passkey-forms";

interface MfaVerifyFormProps {
  /** Whether the challenge has already been spent. */
  finished: boolean;
  /** The factors the account holds, as the challenge reported them. */
  methods: readonly MfaMethodName[];
  /** Where the login was heading before the second factor interrupted it. */
  nextPath: string;
  tenantId: string;
}

const MfaPasskeyVerify = ({
  passkeyOnly,
  tenantId,
}: {
  passkeyOnly: boolean;
  tenantId: string;
}) => (
  <>
    <AuthScreen.Note>
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="admin.auth.mfa.passkey_verify_description" />
      </Suspense>
    </AuthScreen.Note>

    <PasskeyVerifyForm>
      <input name="tenant_id" type="hidden" value={tenantId} />

      <ActionForm.Submit className="justify-self-start">
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <ActionForm.Idle>
            <Message message="admin.auth.mfa.passkey_verify_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.auth.mfa.passkey_waiting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </PasskeyVerifyForm>

    <MfaVerifyMethodSwitch to="code">
      <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
        {passkeyOnly ? (
          <Message message="admin.auth.mfa.use_recovery_code_instead" />
        ) : (
          <Message message="admin.auth.mfa.use_code_instead" />
        )}
      </Suspense>
    </MfaVerifyMethodSwitch>
  </>
);

const MfaCodeVerify = ({
  methods,
  tenantId,
}: {
  methods: readonly MfaMethodName[];
  tenantId: string;
}) => {
  const passkey = methods.includes("passkey");
  // An account whose only factor is a passkey has no authenticator to read a
  // code from, so the form asks for a recovery code by name. A challenge that
  // names no method at all predates them and keeps the form it always had.
  const recoveryOnly = passkey && !methods.includes("totp");

  return (
    <>
      <AuthScreen.Note>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          {recoveryOnly ? (
            <Message message="admin.auth.mfa.verify_recovery_description" />
          ) : (
            <Message message="admin.auth.mfa.verify_description" />
          )}
        </Suspense>
      </AuthScreen.Note>

      <ActionForm.Root
        action={verifyMfaAction}
        className="grid gap-4"
        showSuccess={false}
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <MfaRecoveryCodeSpent />

        <MfaCodeField
          accepts={recoveryOnly ? "recovery" : "authenticator_or_recovery"}
        />

        <ActionForm.Submit className="justify-self-start">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <ActionForm.Idle>
              <Message message="admin.auth.mfa.verify_submit" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.auth.mfa.verify_submitting" />
            </ActionForm.Pending>
          </Suspense>
        </ActionForm.Submit>
      </ActionForm.Root>

      {passkey ? (
        <MfaVerifyMethodSwitch to="passkey">
          <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
            <Message message="admin.auth.mfa.use_passkey_instead" />
          </Suspense>
        </MfaVerifyMethodSwitch>
      ) : null}
    </>
  );
};

export const MfaVerifyForm = ({
  finished,
  methods,
  nextPath,
  tenantId,
}: MfaVerifyFormProps) => (
  <MfaVerifySteps
    finished={finished}
    nextPath={nextPath}
    spent={
      <AuthScreen.Body>
        <h2 className="font-medium text-foreground">
          <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
            <Message message="admin.auth.mfa.recovery_used_title" />
          </Suspense>
        </h2>
        <AuthScreen.Note>
          <MfaRemainingRecoveryCodes />
        </AuthScreen.Note>
        <LinkButton
          className="justify-self-start"
          render={<Link href={nextPath} />}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.auth.mfa.continue_to_console" />
          </Suspense>
        </LinkButton>
      </AuthScreen.Body>
    }
    verify={
      <>
        <AuthScreen.Body>
          <MfaVerifyMethods
            code={<MfaCodeVerify methods={methods} tenantId={tenantId} />}
            passkey={
              methods.includes("passkey") ? (
                <MfaPasskeyVerify
                  passkeyOnly={!methods.includes("totp")}
                  tenantId={tenantId}
                />
              ) : null
            }
          />
        </AuthScreen.Body>

        <AuthScreen.Footer>
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
        </AuthScreen.Footer>
      </>
    }
  />
);
