import {
  ActionForm,
  ActionFormFieldError,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
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
import { paymentSettingsStatus } from "#lib/payment-settings-shared";
import type {
  PaymentSettingsStatus,
  TenantPaymentSettings,
} from "#lib/payment-settings-shared";

import { updateTenantPaymentSettingsAction } from "../_lib/actions";
import {
  PaymentEnabled,
  PaymentEnabledCheckbox,
  PaymentEnabledLabel,
  PaymentSecret,
  PaymentSecretEditor,
  PaymentSecretLabel,
  PaymentSecretStored,
} from "./payment-settings-controls";

const statusTone: Record<PaymentSettingsStatus, BadgeTone> = {
  disabled: "muted",
  incomplete: "warning",
  ready: "success",
  unset: "muted",
};

const PaymentStatusLabel = ({ status }: { status: PaymentSettingsStatus }) => {
  switch (status) {
    case "disabled": {
      return <Message message="admin.settings.payment.status.disabled" />;
    }
    case "incomplete": {
      return <Message message="admin.settings.payment.status.incomplete" />;
    }
    case "ready": {
      return <Message message="admin.settings.payment.status.ready" />;
    }
    default: {
      return <Message message="admin.settings.payment.status.unset" />;
    }
  }
};

const PaymentStatusDescription = ({
  status,
}: {
  status: PaymentSettingsStatus;
}) => {
  switch (status) {
    case "disabled": {
      return (
        <Message message="admin.settings.payment.status.disabled_description" />
      );
    }
    case "incomplete": {
      return (
        <Message message="admin.settings.payment.status.incomplete_description" />
      );
    }
    case "ready": {
      return (
        <Message message="admin.settings.payment.status.ready_description" />
      );
    }
    default: {
      return (
        <Message message="admin.settings.payment.status.unset_description" />
      );
    }
  }
};

interface TenantPaymentSettingsFormProps {
  canEdit: boolean;
  initialSettings: TenantPaymentSettings;
  loadErrorMessage?: string;
  tenantId: string;
  webhookUrl?: string;
}

export const TenantPaymentSettingsForm = ({
  canEdit,
  initialSettings: settings,
  loadErrorMessage,
  tenantId,
  webhookUrl,
}: TenantPaymentSettingsFormProps) => {
  const status = paymentSettingsStatus(settings);
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.payment.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.payment.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantPaymentSettingsAction}
        className="grid gap-5 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input
          name="secret_key_configured"
          type="hidden"
          value={settings.secretKeyConfigured ? "1" : "0"}
        />
        <input
          name="webhook_secret_configured"
          type="hidden"
          value={settings.webhookSecretConfigured ? "1" : "0"}
        />

        {loadErrorMessage ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <StatusChip status={statusTone[status]}>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <PaymentStatusLabel status={status} />
              </Suspense>
            </StatusChip>
            <p className="text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <PaymentStatusDescription status={status} />
              </Suspense>
            </p>
          </div>
        )}

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.settings.payment.provider" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input disabled readOnly type="text" value="Stripe" />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                <Message message="admin.settings.payment.provider_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        {/* A save refreshes the settings; keying on them remounts the fields
            on what the API stored, behind the new hints. */}
        <ActionFormFieldset
          className="grid gap-5"
          disabled={fieldsDisabled}
          key={[
            settings.enabled,
            settings.ready,
            settings.secretKeyConfigured,
            settings.secretKeyHint,
            settings.webhookSecretConfigured,
            settings.webhookSecretHint,
          ].join(":")}
        >
          <PaymentEnabled initialEnabled={settings.enabled}>
            <Field>
              <PaymentEnabledLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="admin.settings.payment.enabled" />
                </Suspense>
              </PaymentEnabledLabel>
              <FieldContent>
                <PaymentEnabledCheckbox>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.settings.payment.enabled_checkbox" />
                  </Suspense>
                </PaymentEnabledCheckbox>
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.payment.enabled_description" />
                  </Suspense>
                </FieldDescription>
              </FieldContent>
            </Field>

            <PaymentSecret
              configured={settings.secretKeyConfigured}
              disabled={fieldsDisabled}
              hint={settings.secretKeyHint}
              name="secret_key"
            >
              <Field>
                <PaymentSecretLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.settings.payment.secret_key" />
                  </Suspense>
                </PaymentSecretLabel>
                <FieldContent>
                  <PaymentSecretStored>
                    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                      <Message message="admin.settings.payment.secret_change" />
                    </Suspense>
                  </PaymentSecretStored>
                  <PaymentSecretEditor>
                    <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                      <Message message="admin.settings.payment.secret_change_cancel" />
                    </Suspense>
                  </PaymentSecretEditor>
                  <ActionFormFieldError name="secretKey" />
                </FieldContent>
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.payment.secret_description" />
                  </Suspense>
                </FieldDescription>
              </Field>
            </PaymentSecret>

            <PaymentSecret
              configured={settings.webhookSecretConfigured}
              disabled={fieldsDisabled}
              hint={settings.webhookSecretHint}
              name="webhook_secret"
            >
              <Field>
                <PaymentSecretLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.settings.payment.webhook_secret" />
                  </Suspense>
                </PaymentSecretLabel>
                <FieldContent>
                  <PaymentSecretStored>
                    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                      <Message message="admin.settings.payment.secret_change" />
                    </Suspense>
                  </PaymentSecretStored>
                  <PaymentSecretEditor>
                    <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                      <Message message="admin.settings.payment.secret_change_cancel" />
                    </Suspense>
                  </PaymentSecretEditor>
                  <ActionFormFieldError name="webhookSecret" />
                </FieldContent>
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.payment.secret_description" />
                  </Suspense>
                </FieldDescription>
              </Field>
            </PaymentSecret>
          </PaymentEnabled>
        </ActionFormFieldset>

        {webhookUrl ? (
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.settings.payment.webhook_url" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input disabled readOnly type="text" value={webhookUrl} />
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.payment.webhook_url_description" />
                </Suspense>
              </FieldDescription>
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.payment.webhook_url_legacy_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>
        ) : null}

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.admin_only" />
            </Suspense>
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionFormIdle>
                <Message message="admin.settings.save" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.settings.saving" />
              </ActionFormPending>
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </AdminSection>
  );
};
