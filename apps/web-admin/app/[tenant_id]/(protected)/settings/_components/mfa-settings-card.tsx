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

interface MfaSettingsCardProps {
  status: AdminMfaStatus;
  tenantId: string;
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
    <MfaCodeField allowRecoveryCode={false} />
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
    <MfaCodeField allowRecoveryCode={false} />
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

const MfaDisableForm = ({ tenantId }: { tenantId: string }) => (
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
          <Message message="admin.settings.mfa.disable_description" />
        </Suspense>
      </p>
    </div>
    <MfaCodeField allowRecoveryCode />
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

const MfaStatusSummary = ({ status }: { status: AdminMfaStatus }) => (
  <div className="grid gap-1">
    <p className="text-sm text-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
        {status.enabled ? (
          <Message message="admin.settings.mfa.status_enabled" />
        ) : (
          <Message message="admin.settings.mfa.status_disabled" />
        )}
      </Suspense>
    </p>
    {status.required ? (
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.settings.mfa.status_required" />
        </Suspense>
      </p>
    ) : null}
    {status.enabled ? (
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <Message
            message="admin.settings.mfa.remaining_recovery_codes"
            values={{ count: String(status.remainingRecoveryCodes) }}
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
export const MfaSettingsCard = ({ status, tenantId }: MfaSettingsCardProps) => (
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

    <MfaSettingsOutcome recoveryCodes={<MfaRecoveryCodes />}>
      {status.enabled ? (
        <>
          <MfaRegenerateForm tenantId={tenantId} />
          <MfaDisableForm tenantId={tenantId} />
        </>
      ) : (
        <MfaEnrollment
          confirm={<MfaConfirmForm tenantId={tenantId} />}
          start={<MfaStartForm tenantId={tenantId} />}
        />
      )}
    </MfaSettingsOutcome>
  </AdminSection>
);
