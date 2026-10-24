import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { MfaCodeField } from "#components/mfa-code-field";
import * as MfaEnrollment from "#components/mfa-enrollment";
import { MfaRecoveryCodes } from "#components/mfa-recovery-codes";
import type { AdminMfaStatus } from "#lib/admin-mfa";

import {
  confirmAccountMfaEnrollmentAction,
  disableAccountMfaAction,
  regenerateAccountMfaRecoveryCodesAction,
  startAccountMfaEnrollmentAction,
} from "../_lib/mfa-actions";
import * as MfaSettingsOutcome from "./mfa-settings-outcome";
import { PasskeySettings } from "./passkey-settings";

interface MfaSettingsCardProps {
  /** For the dates a passkey was added and last used. */
  locale: Locale;
  status: AdminMfaStatus;
  tenantId: string;
  timeZone: string;
}

const MfaStartForm = ({ tenantId }: { tenantId: string }) => (
  <ActionForm.Root
    action={startAccountMfaEnrollmentAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <MfaEnrollment.Started />
    <div className="flex justify-end">
      <ActionForm.Submit>
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionForm.Idle>
            <Message message="admin.settings.mfa.enable_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.auth.mfa.enroll_starting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

const MfaConfirmForm = ({ tenantId }: { tenantId: string }) => (
  <ActionForm.Root
    action={confirmAccountMfaEnrollmentAction}
    className="grid gap-4"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <MfaSettingsOutcome.Report />
    <MfaEnrollment.Secret />
    <MfaCodeField accepts="authenticator" />
    <div className="flex justify-end">
      <ActionForm.Submit>
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionForm.Idle>
            <Message message="admin.auth.mfa.enroll_confirm_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.auth.mfa.enroll_confirm_submitting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

const MfaRegenerateForm = ({ tenantId }: { tenantId: string }) => (
  <ActionForm.Root
    action={regenerateAccountMfaRecoveryCodesAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <MfaSettingsOutcome.Report />
    <div className="grid gap-1">
      <p className="text-sm font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="admin.settings.mfa.regenerate_title" />
        </Suspense>
      </p>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.settings.mfa.regenerate_description" />
        </Suspense>
      </p>
    </div>
    <MfaCodeField accepts="authenticator" />
    <div className="flex justify-end">
      <ActionForm.Submit variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionForm.Idle>
            <Message message="admin.settings.mfa.regenerate_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.settings.mfa.regenerate_submitting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

/**
 * Turning two-step verification off keeps meaning the authenticator app: an
 * account that also holds passkeys keeps them, and the wording says so.
 */
const MfaDisableForm = ({
  keepsPasskeys,
  tenantId,
}: {
  keepsPasskeys: boolean;
  tenantId: string;
}) => (
  <ActionForm.Root
    action={disableAccountMfaAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <MfaSettingsOutcome.Report />
    <div className="grid gap-1">
      <p className="text-sm font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="admin.settings.mfa.disable_title" />
        </Suspense>
      </p>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          {keepsPasskeys ? (
            <Message message="admin.settings.mfa.disable_description_with_passkeys" />
          ) : (
            <Message message="admin.settings.mfa.disable_description" />
          )}
        </Suspense>
      </p>
    </div>
    <MfaCodeField accepts="authenticator_or_recovery" />
    <div className="flex justify-end">
      <ActionForm.Submit variant="destructive">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionForm.Idle>
            <Message message="admin.settings.mfa.disable_submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.settings.mfa.disable_submitting" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);

const MfaStatusMessage = ({ status }: { status: AdminMfaStatus }) => {
  const hasPasskey = status.passkeys.length > 0;
  if (status.enabled && hasPasskey) {
    return <Message message="admin.settings.mfa.status_both" />;
  }
  if (status.enabled) {
    return <Message message="admin.settings.mfa.status_authenticator" />;
  }
  if (hasPasskey) {
    return <Message message="admin.settings.mfa.status_passkey" />;
  }
  return <Message message="admin.settings.mfa.status_disabled" />;
};

const MfaStatusSummary = ({ status }: { status: AdminMfaStatus }) => (
  <div className="grid gap-1">
    <p className="text-sm text-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
        <MfaStatusMessage status={status} />
      </Suspense>
    </p>
    {status.required ? (
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.settings.mfa.status_required" />
        </Suspense>
      </p>
    ) : null}
    {status.enabled || status.passkeys.length > 0 ? (
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <Message
            message="admin.settings.mfa.remaining_recovery_codes"
            values={{ count: status.remainingRecoveryCodes }}
          />
        </Suspense>
      </p>
    ) : null}
  </div>
);

/**
 * The operator's own second factors: the authenticator app, which is turned
 * on, has its recovery codes replaced, and is turned off, and the passkeys,
 * which are added, named, and removed one by one, and replace the recovery
 * codes when there is no authenticator app to. The recovery codes stand in
 * for both, so whichever of them issues a batch shows it in the one place.
 */
export const MfaSettingsCard = ({
  locale,
  status,
  tenantId,
  timeZone,
}: MfaSettingsCardProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
            <Message message="admin.settings.mfa.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.mfa.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>
    <MfaStatusSummary status={status} />

    <MfaSettingsOutcome.Root
      hasSecondFactor={status.enabled || status.passkeys.length > 0}
      recoveryCodes={<MfaRecoveryCodes />}
    >
      <div className="grid gap-3">
        <h3 className="text-sm font-medium text-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.settings.mfa.authenticator_title" />
          </Suspense>
        </h3>
        {status.enabled ? (
          <>
            <MfaRegenerateForm tenantId={tenantId} />
            <MfaDisableForm
              keepsPasskeys={status.passkeys.length > 0}
              tenantId={tenantId}
            />
          </>
        ) : (
          <MfaEnrollment.Root
            confirm={<MfaConfirmForm tenantId={tenantId} />}
            start={<MfaStartForm tenantId={tenantId} />}
          />
        )}
      </div>
      <PasskeySettings
        locale={locale}
        passkeys={status.passkeys}
        regeneratesRecoveryCodes={!status.enabled}
        tenantId={tenantId}
        timeZone={timeZone}
      />
    </MfaSettingsOutcome.Root>
  </ConsoleSection.Root>
);
