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
    <AuthScreenBody>
      <h2 className="font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
          <Message message="platform.auth.mfa.enroll_required_title" />
        </Suspense>
      </h2>
      <AuthScreenNote>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="platform.auth.mfa.enroll_required_description" />
        </Suspense>
      </AuthScreenNote>

      <ActionForm
        action={startMfaEnrollmentAction}
        className="grid gap-4"
        showSuccess={false}
      >
        <MfaEnrollmentStarted />

        <ActionFormSubmit className="justify-self-start">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <ActionFormIdle>
              <Message message="platform.auth.mfa.enroll_start" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="platform.auth.mfa.enroll_starting" />
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
            <Message message="platform.auth.mfa.back_to_login" />
          </Suspense>
        </Link>
      </p>
    </AuthScreenFooter>
  </>
);

const MfaEnrollConfirm = () => (
  <AuthScreenBody>
    <MfaEnrollmentSecret />

    <ActionForm
      action={confirmMfaEnrollmentAction}
      className="grid gap-4"
      showSuccess={false}
    >
      <MfaEnrollmentConfirmed />

      <MfaCodeField allowRecoveryCode={false} />

      <ActionFormSubmit className="justify-self-start">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <ActionFormIdle>
            <Message message="platform.auth.mfa.enroll_confirm_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="platform.auth.mfa.enroll_confirm_submitting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </ActionForm>
  </AuthScreenBody>
);

/**
 * The enrollment the platform policy requires of an operator before it will
 * finish their sign-in: start, scan, confirm, and keep the recovery codes.
 */
export const MfaEnrollFlow = ({ finished, nextPath }: MfaEnrollFlowProps) => (
  <MfaEnrollSteps
    finished={finished}
    nextPath={nextPath}
    done={
      <AuthScreenBody>
        <MfaRecoveryCodes />
        <MfaEnrollDoneLink
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
      </AuthScreenBody>
    }
    enroll={
      <MfaEnrollment
        confirm={<MfaEnrollConfirm />}
        start={<MfaEnrollStart />}
      />
    }
  />
);
