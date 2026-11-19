import * as AuthScreen from "@publira/layouts/auth-screen";
import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { MfaCodeField } from "#components/mfa-code-field";
import * as MfaEnrollment from "#components/mfa-enrollment";
import { MfaEnrollmentSecret } from "#components/mfa-enrollment-secret";
import { MfaRecoveryCodes } from "#components/mfa-recovery-codes";

import {
  confirmMfaEnrollmentAction,
  startMfaEnrollmentAction,
} from "../_lib/actions";
import * as MfaEnrollSteps from "./mfa-enroll-steps";

interface MfaEnrollFlowProps {
  /** Whether the challenge has already been spent. */
  finished: boolean;
  /** Where the sign-in was heading before the policy held it for an enrollment. */
  nextPath: string;
}

/**
 * Starting is a submission rather than something the page does while it
 * renders, because it mints and stores a secret.
 */
const MfaEnrollStart = () => (
  <>
    <AuthScreen.Body>
      <h2 className="font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
          <Message message="platform.auth.mfa.enroll_required_title" />
        </Suspense>
      </h2>
      <AuthScreen.Note>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.auth.mfa.enroll_required_description" />
        </Suspense>
      </AuthScreen.Note>

      <ActionForm.Root
        action={startMfaEnrollmentAction}
        className="grid gap-4"
        showSuccess={false}
      >
        <MfaEnrollment.Started />

        <ActionForm.Submit className="justify-self-start">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <ActionForm.Idle>
              <Message message="platform.auth.mfa.enroll_start" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="platform.auth.mfa.enroll_starting" />
            </ActionForm.Pending>
          </Suspense>
        </ActionForm.Submit>
      </ActionForm.Root>
    </AuthScreen.Body>

    <AuthScreen.Footer>
      <p>
        <Link
          className="text-primary underline underline-offset-4"
          href="/login"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
            <Message message="platform.auth.mfa.back_to_login" />
          </Suspense>
        </Link>
      </p>
    </AuthScreen.Footer>
  </>
);

const MfaEnrollConfirm = () => (
  <AuthScreen.Body>
    <MfaEnrollmentSecret />

    <ActionForm.Root
      action={confirmMfaEnrollmentAction}
      className="grid gap-4"
      showSuccess={false}
    >
      <MfaEnrollSteps.Confirmed />

      <MfaCodeField allowRecoveryCode={false} />

      <ActionForm.Submit className="justify-self-start">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <ActionForm.Idle>
            <Message message="platform.auth.mfa.enroll_confirm_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="platform.auth.mfa.enroll_confirm_submitting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </ActionForm.Root>
  </AuthScreen.Body>
);

/**
 * The enrollment the platform policy requires of an operator before it will
 * finish their sign-in: start, scan, confirm, and keep the recovery codes.
 */
export const MfaEnrollFlow = ({ finished, nextPath }: MfaEnrollFlowProps) => (
  <MfaEnrollSteps.Root
    finished={finished}
    nextPath={nextPath}
    done={
      <AuthScreen.Body>
        <MfaRecoveryCodes />
        <MfaEnrollSteps.DoneLink
          nextPath={nextPath}
          signedIn={
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.auth.mfa.continue_to_console" />
            </Suspense>
          }
          signedOut={
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.auth.mfa.back_to_login" />
            </Suspense>
          }
        />
      </AuthScreen.Body>
    }
    enroll={
      <MfaEnrollment.Root
        confirm={<MfaEnrollConfirm />}
        start={<MfaEnrollStart />}
      />
    }
  />
);
