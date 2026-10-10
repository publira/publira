import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
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
  <ActionForm
    action={startAccountMfaEnrollmentAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <MfaEnrollmentStarted />
    <div className="flex justify-end">
      <ActionFormSubmit>
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionFormIdle>
            <Message message="platform.settings.mfa.enable_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="platform.auth.mfa.enroll_starting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);

const MfaConfirmForm = () => (
  <ActionForm
    action={confirmAccountMfaEnrollmentAction}
    className="grid gap-4"
    showSuccess={false}
  >
    <ReportMfaSettingsChange />
    <MfaEnrollmentSecret />
    <MfaCodeField allowRecoveryCode={false} />
    <div className="flex justify-end">
      <ActionFormSubmit>
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionFormIdle>
            <Message message="platform.auth.mfa.enroll_confirm_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="platform.auth.mfa.enroll_confirm_submitting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);

const MfaRegenerateForm = () => (
  <ActionForm
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
      <ActionFormSubmit variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionFormIdle>
            <Message message="platform.settings.mfa.regenerate_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="platform.settings.mfa.regenerate_submitting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);

const MfaDisableForm = () => (
  <ActionForm
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
      <ActionFormSubmit variant="destructive">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionFormIdle>
            <Message message="platform.settings.mfa.disable_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="platform.settings.mfa.disable_submitting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
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
