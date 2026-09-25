"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import type { QrCodePath } from "@publira/ui-components/qr-code";
import { useActionState } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage, useClientMessages } from "#components/client-message";
import { MfaCodeField } from "#components/mfa-code-field";
import { MfaEnrollmentSecret } from "#components/mfa-enrollment-secret";
import { MfaRecoveryCodes } from "#components/mfa-recovery-codes";
import type { AdminMfaStatus } from "#lib/admin-mfa";
import type {
  MfaEnrollmentConfirmState,
  MfaEnrollmentStartState,
  MfaRecoveryCodesState,
} from "#lib/mfa-action-state";
import { useTenantId } from "#lib/use-tenant-id";

import {
  confirmAccountMfaEnrollmentAction,
  disableAccountMfaAction,
  regenerateAccountMfaRecoveryCodesAction,
  startAccountMfaEnrollmentAction,
} from "../_lib/mfa-actions";

interface MfaSettingsCardProps {
  status: AdminMfaStatus;
}

interface MfaFormProps {
  action: (formData: FormData) => void;
  isPending: boolean;
  tenantId: string;
}

const MfaStartForm = ({
  action,
  isPending,
  state,
  tenantId,
}: MfaFormProps & { state: MfaEnrollmentStartState }) => (
  <form action={action} className="grid gap-3">
    <input name="tenant_id" type="hidden" value={tenantId} />
    {state && !state.ok ? (
      <FormMessage variant="destructive">{state.message}</FormMessage>
    ) : null}
    <div className="flex justify-end">
      <Button disabled={isPending} type="submit">
        <ActionFormIdle>
          <ClientMessage message="admin.settings.mfa.enable_submit" />
        </ActionFormIdle>
        <ActionFormPending>
          <ClientMessage message="admin.auth.mfa.enroll_starting" />
        </ActionFormPending>
      </Button>
    </div>
  </form>
);

const MfaConfirmForm = ({
  action,
  isPending,
  qr,
  secret,
  state,
  tenantId,
}: MfaFormProps & {
  qr: QrCodePath;
  secret: string;
  state: MfaEnrollmentConfirmState;
}) => (
  <form action={action} className="grid gap-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <MfaEnrollmentSecret qr={qr} secret={secret} />
    <MfaCodeField allowRecoveryCode={false} disabled={isPending} />
    {state && !state.ok ? (
      <FormMessage variant="destructive">{state.message}</FormMessage>
    ) : null}
    <div className="flex justify-end">
      <Button disabled={isPending} type="submit">
        <ActionFormIdle>
          <ClientMessage message="admin.auth.mfa.enroll_confirm_submit" />
        </ActionFormIdle>
        <ActionFormPending>
          <ClientMessage message="admin.auth.mfa.enroll_confirm_submitting" />
        </ActionFormPending>
      </Button>
    </div>
  </form>
);

const MfaRegenerateForm = ({
  action,
  isPending,
  state,
  tenantId,
}: MfaFormProps & { state: MfaRecoveryCodesState }) => {
  const t = useClientMessages();

  return (
    <form action={action} className="grid gap-3">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">
          {t("admin.settings.mfa.regenerate_title")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("admin.settings.mfa.regenerate_description")}
        </p>
      </div>
      <MfaCodeField allowRecoveryCode={false} disabled={isPending} />
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={isPending} type="submit" variant="outline">
          <ActionFormIdle>
            <ClientMessage message="admin.settings.mfa.regenerate_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <ClientMessage message="admin.settings.mfa.regenerate_submitting" />
          </ActionFormPending>
        </Button>
      </div>
    </form>
  );
};

const MfaDisableForm = ({
  action,
  isPending,
  state,
  tenantId,
}: MfaFormProps & { state: FormActionState }) => {
  const t = useClientMessages();

  return (
    <form action={action} className="grid gap-3">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">
          {t("admin.settings.mfa.disable_title")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("admin.settings.mfa.disable_description")}
        </p>
      </div>
      <MfaCodeField allowRecoveryCode disabled={isPending} />
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={isPending} type="submit" variant="destructive">
          <ActionFormIdle>
            <ClientMessage message="admin.settings.mfa.disable_submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <ClientMessage message="admin.settings.mfa.disable_submitting" />
          </ActionFormPending>
        </Button>
      </div>
    </form>
  );
};

const MfaSetupSection = ({
  confirmAction,
  confirmState,
  isConfirming,
  isStarting,
  startAction,
  startState,
  tenantId,
}: {
  confirmAction: (formData: FormData) => void;
  confirmState: MfaEnrollmentConfirmState;
  isConfirming: boolean;
  isStarting: boolean;
  startAction: (formData: FormData) => void;
  startState: MfaEnrollmentStartState;
  tenantId: string;
}) => {
  if (startState?.ok) {
    return (
      <MfaConfirmForm
        action={confirmAction}
        isPending={isConfirming}
        qr={startState.qr}
        secret={startState.secret}
        state={confirmState}
        tenantId={tenantId}
      />
    );
  }

  return (
    <MfaStartForm
      action={startAction}
      isPending={isStarting}
      state={startState}
      tenantId={tenantId}
    />
  );
};

const MfaStatusSummary = ({ status }: MfaSettingsCardProps) => {
  const t = useClientMessages();

  return (
    <div className="grid gap-1">
      <p className="text-sm text-foreground">
        {t(
          status.enabled
            ? "admin.settings.mfa.status_enabled"
            : "admin.settings.mfa.status_disabled"
        )}
      </p>
      {status.required ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.settings.mfa.status_required")}
        </p>
      ) : null}
      {status.enabled ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.settings.mfa.remaining_recovery_codes", {
            count: String(status.remainingRecoveryCodes),
          })}
        </p>
      ) : null}
    </div>
  );
};

const MfaNotices = ({
  confirmState,
  disableState,
  regenerateState,
}: {
  confirmState: MfaEnrollmentConfirmState;
  disableState: FormActionState;
  regenerateState: MfaRecoveryCodesState;
}) => {
  const t = useClientMessages();

  return (
    <>
      {confirmState?.ok ? (
        <FormMessage variant="success">
          {t("admin.settings.mfa.enabled_done")}
        </FormMessage>
      ) : null}
      {regenerateState?.ok ? (
        <FormMessage variant="success">{regenerateState.message}</FormMessage>
      ) : null}
      {disableState?.ok ? (
        <FormMessage variant="success">{disableState.message}</FormMessage>
      ) : null}
    </>
  );
};

/**
 * The batch shown on screen: a regeneration can only follow an enrollment, so
 * the newer one wins.
 */
const issuedRecoveryCodes = (
  confirmState: MfaEnrollmentConfirmState,
  regenerateState: MfaRecoveryCodesState
): string[] | null => {
  if (regenerateState?.ok) {
    return regenerateState.recoveryCodes;
  }
  if (confirmState?.ok) {
    return confirmState.recoveryCodes;
  }
  return null;
};

/**
 * The operator's own second factor: turn it on, replace the recovery codes, or
 * turn it off.
 *
 * All four Action states live here rather than in the forms below, because the
 * batch of recovery codes a step produces has to survive the status change
 * that same step causes. A form that owned its own state would be unmounted by
 * the switch from "off" to "on", taking the only copy of those codes with it.
 */
export const MfaSettingsCard = ({ status }: MfaSettingsCardProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();

  const [startState, startAction, isStarting] = useActionState(
    startAccountMfaEnrollmentAction,
    null
  );
  const [confirmState, confirmAction, isConfirming] = useActionState(
    confirmAccountMfaEnrollmentAction,
    null
  );
  const [regenerateState, regenerateAction, isRegenerating] = useActionState(
    regenerateAccountMfaRecoveryCodesAction,
    null
  );
  const [disableState, disableAction, isDisabling] = useActionState(
    disableAccountMfaAction,
    null
  );

  const issuedCodes = issuedRecoveryCodes(confirmState, regenerateState);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>{t("admin.settings.mfa.title")}</AdminSectionTitle>
          <AdminSectionDescription>
            {t("admin.settings.mfa.description")}
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <MfaStatusSummary status={status} />

      <MfaNotices
        confirmState={confirmState}
        disableState={disableState}
        regenerateState={regenerateState}
      />

      {issuedCodes ? <MfaRecoveryCodes codes={issuedCodes} /> : null}

      {status.enabled ? (
        <>
          <MfaRegenerateForm
            action={regenerateAction}
            isPending={isRegenerating}
            state={regenerateState}
            tenantId={tenantId}
          />
          <MfaDisableForm
            action={disableAction}
            isPending={isDisabling}
            state={disableState}
            tenantId={tenantId}
          />
        </>
      ) : (
        <MfaSetupSection
          confirmAction={confirmAction}
          confirmState={confirmState}
          isConfirming={isConfirming}
          isStarting={isStarting}
          startAction={startAction}
          startState={startState}
          tenantId={tenantId}
        />
      )}
    </AdminSection>
  );
};
