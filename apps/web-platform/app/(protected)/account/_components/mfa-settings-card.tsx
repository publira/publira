import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
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
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSectionTitle,
} from "#components/platform-page";
import type { PlatformMfaStatus } from "#lib/platform-mfa";

import {
  confirmAccountMfaEnrollmentAction,
  disableAccountMfaAction,
  regenerateAccountMfaRecoveryCodesAction,
  startAccountMfaEnrollmentAction,
} from "../_lib/mfa-actions";
import {
  MfaSettingsOutcome,
  ReportMfaSettingsChange,
} from "./mfa-settings-outcome";

interface MfaSettingsCardProps {
  status: PlatformMfaStatus;
}

const MfaStartForm = () => (
  <ActionForm.Root
    action={startAccountMfaEnrollmentAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <MfaEnrollmentStarted />
    <div className="flex justify-end">
      <ActionForm.Submit>
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionForm.Idle>
            <Message message="platform.settings.mfa.enable_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="platform.auth.mfa.enroll_starting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

const MfaConfirmForm = () => (
  <ActionForm.Root
    action={confirmAccountMfaEnrollmentAction}
    className="grid gap-4"
    showSuccess={false}
  >
    <ReportMfaSettingsChange />
    <MfaEnrollmentSecret />
    <MfaCodeField allowRecoveryCode={false} />
    <div className="flex justify-end">
      <ActionForm.Submit>
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionForm.Idle>
            <Message message="platform.auth.mfa.enroll_confirm_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="platform.auth.mfa.enroll_confirm_submitting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

const MfaRegenerateForm = () => (
  <ActionForm.Root
    action={regenerateAccountMfaRecoveryCodesAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <ReportMfaSettingsChange />
    <div className="grid gap-1">
      <p className="text-sm font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="platform.settings.mfa.regenerate_title" />
        </Suspense>
      </p>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="platform.settings.mfa.regenerate_description" />
        </Suspense>
      </p>
    </div>
    <MfaCodeField allowRecoveryCode={false} />
    <div className="flex justify-end">
      <ActionForm.Submit variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionForm.Idle>
            <Message message="platform.settings.mfa.regenerate_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="platform.settings.mfa.regenerate_submitting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

const MfaDisableForm = () => (
  <ActionForm.Root
    action={disableAccountMfaAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <ReportMfaSettingsChange />
    <div className="grid gap-1">
      <p className="text-sm font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="platform.settings.mfa.disable_title" />
        </Suspense>
      </p>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="platform.settings.mfa.disable_description" />
        </Suspense>
      </p>
    </div>
    <MfaCodeField allowRecoveryCode />
    <div className="flex justify-end">
      <ActionForm.Submit variant="destructive">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionForm.Idle>
            <Message message="platform.settings.mfa.disable_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="platform.settings.mfa.disable_submitting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

const MfaStatusSummary = ({ status }: { status: PlatformMfaStatus }) => (
  <div className="grid gap-1">
    <p className="text-sm text-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
        {status.enabled ? (
          <Message message="platform.settings.mfa.status_enabled" />
        ) : (
          <Message message="platform.settings.mfa.status_disabled" />
        )}
      </Suspense>
    </p>
    {status.required ? (
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="platform.settings.mfa.status_required" />
        </Suspense>
      </p>
    ) : null}
    {status.enabled ? (
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <Message
            message="platform.settings.mfa.remaining_recovery_codes"
            values={{ count: status.remainingRecoveryCodes }}
          />
        </Suspense>
      </p>
    ) : null}
  </div>
);

/**
 * The operator's own second factor: turn it on, replace the recovery codes, or
 * turn it off.
 */
export const MfaSettingsCard = ({ status }: MfaSettingsCardProps) => (
  <PlatformSection>
    <PlatformSectionHeader>
      <PlatformSectionHeading>
        <PlatformSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
            <Message message="platform.settings.mfa.title" />
          </Suspense>
        </PlatformSectionTitle>
        <PlatformSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.settings.mfa.description" />
          </Suspense>
        </PlatformSectionDescription>
      </PlatformSectionHeading>
    </PlatformSectionHeader>
    <MfaStatusSummary status={status} />

    <MfaSettingsOutcome recoveryCodes={<MfaRecoveryCodes />}>
      {status.enabled ? (
        <>
          <MfaRegenerateForm />
          <MfaDisableForm />
        </>
      ) : (
        <MfaEnrollment confirm={<MfaConfirmForm />} start={<MfaStartForm />} />
      )}
    </MfaSettingsOutcome>
  </PlatformSection>
);
