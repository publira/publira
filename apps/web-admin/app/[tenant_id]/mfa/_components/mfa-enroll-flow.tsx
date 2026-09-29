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
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { MfaCodeField } from "#components/mfa-code-field";
import {
  MfaEnrollment,
  MfaEnrollmentStarted,
} from "#components/mfa-enrollment";
import { MfaEnrollmentSecret } from "#components/mfa-enrollment-secret";
import { MfaRecoveryCodes } from "#components/mfa-recovery-codes";

import {
  confirmMfaEnrollmentAction,
  startMfaEnrollmentAction,
} from "../_lib/actions";
import {
  MfaEnrollDoneLink,
  MfaEnrollmentConfirmed,
  MfaEnrollSteps,
} from "./mfa-enroll-steps";

interface MfaEnrollFlowProps {
  /** Where the login was heading before the tenant held it for an enrollment. */
  nextPath: string;
  tenantId: string;
}

/**
 * Starting is a submission rather than something the page does while it
 * renders, because it mints and stores a secret.
 */
const MfaEnrollStart = ({ tenantId }: { tenantId: string }) => (
  <>
    <AuthScreenBody>
      <h2 className="font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
          <Message message="admin.auth.mfa.enroll_required_title" />
        </Suspense>
      </h2>
      <AuthScreenNote>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="admin.auth.mfa.enroll_required_description" />
        </Suspense>
      </AuthScreenNote>

      <ActionForm
        action={startMfaEnrollmentAction}
        className="grid gap-4"
        showSuccess={false}
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <MfaEnrollmentStarted />

        <ActionFormSubmit className="justify-self-start">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <ActionFormIdle>
              <Message message="admin.auth.mfa.enroll_start" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.auth.mfa.enroll_starting" />
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
);

const MfaEnrollConfirm = ({ tenantId }: { tenantId: string }) => (
  <AuthScreenBody>
    <MfaEnrollmentSecret />

    <ActionForm
      action={confirmMfaEnrollmentAction}
      className="grid gap-4"
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <MfaEnrollmentConfirmed />

      <MfaCodeField allowRecoveryCode={false} />

      <ActionFormSubmit className="justify-self-start">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <ActionFormIdle>
            <Message message="admin.auth.mfa.enroll_confirm_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.auth.mfa.enroll_confirm_submitting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </ActionForm>
  </AuthScreenBody>
);

/**
 * The enrollment a tenant requires of an administrator before it will finish
 * their login: start, scan, confirm, and keep the recovery codes.
 */
export const MfaEnrollFlow = ({ nextPath, tenantId }: MfaEnrollFlowProps) => (
  <MfaEnrollSteps
    done={
      <AuthScreenBody>
        <MfaRecoveryCodes />
        <MfaEnrollDoneLink
          nextPath={nextPath}
          signedIn={
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.auth.mfa.continue_to_console" />
            </Suspense>
          }
          signedOut={
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.auth.mfa.back_to_login" />
            </Suspense>
          }
        />
      </AuthScreenBody>
    }
    enroll={
      <MfaEnrollment
        confirm={<MfaEnrollConfirm tenantId={tenantId} />}
        start={<MfaEnrollStart tenantId={tenantId} />}
      />
    }
  />
);
