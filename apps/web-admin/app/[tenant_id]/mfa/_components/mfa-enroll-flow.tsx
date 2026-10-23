import {
  AuthScreenBody,
  AuthScreenFooter,
  AuthScreenNote,
} from "@publira/layouts/auth-screen";
import * as ActionForm from "@publira/ui-components/action-form";
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
import { PasskeyEnrollForm } from "./passkey-forms";

interface MfaEnrollFlowProps {
  /** Whether the challenge has already been spent. */
  finished: boolean;
  /** Where the login was heading before the tenant held it for an enrollment. */
  nextPath: string;
  tenantId: string;
}

/**
 * Starting is a submission rather than something the page does while it
 * renders, because it mints and stores a secret.
 *
 * A passkey is offered beside it. It needs no second step of its own: the
 * browser's prompt is the whole of it, and its answer is the one confirming
 * an authenticator gives, so it goes straight on to the recovery codes.
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

      <ActionForm.Root
        action={startMfaEnrollmentAction}
        className="grid gap-4"
        showSuccess={false}
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <MfaEnrollmentStarted />

        <ActionForm.Submit className="justify-self-start">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <ActionForm.Idle>
              <Message message="admin.auth.mfa.enroll_start" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.auth.mfa.enroll_starting" />
            </ActionForm.Pending>
          </Suspense>
        </ActionForm.Submit>
      </ActionForm.Root>

      <PasskeyEnrollForm>
        <input name="tenant_id" type="hidden" value={tenantId} />
        <MfaEnrollmentConfirmed />

        <ActionForm.Submit className="justify-self-start" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <ActionForm.Idle>
              <Message message="admin.auth.mfa.passkey_enroll_submit" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.auth.mfa.passkey_waiting" />
            </ActionForm.Pending>
          </Suspense>
        </ActionForm.Submit>
      </PasskeyEnrollForm>
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

    <ActionForm.Root
      action={confirmMfaEnrollmentAction}
      className="grid gap-4"
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <MfaEnrollmentConfirmed />

      <MfaCodeField accepts="authenticator" />

      <ActionForm.Submit className="justify-self-start">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <ActionForm.Idle>
            <Message message="admin.auth.mfa.enroll_confirm_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.auth.mfa.enroll_confirm_submitting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </ActionForm.Root>
  </AuthScreenBody>
);

/**
 * The enrollment a tenant requires of an administrator before it will finish
 * their login: start, scan, confirm, and keep the recovery codes.
 */
export const MfaEnrollFlow = ({
  finished,
  nextPath,
  tenantId,
}: MfaEnrollFlowProps) => (
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
