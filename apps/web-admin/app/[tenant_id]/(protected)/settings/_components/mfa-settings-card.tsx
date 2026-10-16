import type { Locale } from "@publira/i18n";
import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { MfaCodeField } from "#components/mfa-code-field";
import {
  MfaEnrollment,
  MfaEnrollmentStarted,
} from "#components/mfa-enrollment";
import { MfaEnrollmentSecret } from "#components/mfa-enrollment-secret";
import { MfaRecoveryCodes } from "#components/mfa-recovery-codes";
import type { AdminMfaStatus } from "#lib/admin-mfa";

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
import { PasskeySettings } from "./passkey-settings";

interface MfaSettingsCardProps {
  /** For the dates a passkey was added and last used. */
  locale: Locale;
  status: AdminMfaStatus;
  tenantId: string;
  timeZone: string;
}

const MfaStartForm = ({ tenantId }: { tenantId: string }) => (
  <ActionForm
    action={startAccountMfaEnrollmentAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <MfaEnrollmentStarted />
    <div className="flex justify-end">
      <ActionFormSubmit>
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionFormIdle>
            <Message message="admin.settings.mfa.enable_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.auth.mfa.enroll_starting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);

const MfaConfirmForm = ({ tenantId }: { tenantId: string }) => (
  <ActionForm
    action={confirmAccountMfaEnrollmentAction}
    className="grid gap-4"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <ReportMfaSettingsChange />
    <MfaEnrollmentSecret />
    <MfaCodeField accepts="authenticator" />
    <div className="flex justify-end">
      <ActionFormSubmit>
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionFormIdle>
            <Message message="admin.auth.mfa.enroll_confirm_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.auth.mfa.enroll_confirm_submitting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);

const MfaRegenerateForm = ({ tenantId }: { tenantId: string }) => (
  <ActionForm
    action={regenerateAccountMfaRecoveryCodesAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <ReportMfaSettingsChange />
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
      <ActionFormSubmit variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionFormIdle>
            <Message message="admin.settings.mfa.regenerate_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.settings.mfa.regenerate_submitting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
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
  <ActionForm
    action={disableAccountMfaAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <ReportMfaSettingsChange />
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
      <ActionFormSubmit variant="destructive">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <ActionFormIdle>
            <Message message="admin.settings.mfa.disable_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.settings.mfa.disable_submitting" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
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
 * which are added, named, and removed one by one. The recovery codes stand in
 * for both, so whichever of them issues a batch shows it in the one place.
 */
export const MfaSettingsCard = ({
  locale,
  status,
  tenantId,
  timeZone,
}: MfaSettingsCardProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
            <Message message="admin.settings.mfa.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.mfa.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    <MfaStatusSummary status={status} />

    <MfaSettingsOutcome
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
          <MfaEnrollment
            confirm={<MfaConfirmForm tenantId={tenantId} />}
            start={<MfaStartForm tenantId={tenantId} />}
          />
        )}
      </div>
      <PasskeySettings
        locale={locale}
        passkeys={status.passkeys}
        tenantId={tenantId}
        timeZone={timeZone}
      />
    </MfaSettingsOutcome>
  </AdminSection>
);
