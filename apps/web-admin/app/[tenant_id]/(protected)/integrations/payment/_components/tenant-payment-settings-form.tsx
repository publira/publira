import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import * as ProviderChoice from "#components/provider-choice";
import * as ProviderEnabled from "#components/provider-enabled";
import { paymentSettingsStatus } from "#lib/payment-settings-shared";
import type {
  PaymentProvider,
  PaymentSettingsStatus,
  TenantPaymentSettings,
} from "#lib/payment-settings-shared";

import { updateTenantPaymentSettingsAction } from "../_lib/actions";
import {
  PaymentCredentialFields,
  PaymentCurrencyField,
  PaymentEnabledField,
  PaymentWebhookUrlField,
} from "./payment-provider-fields";

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
  /** The operator's locale, which the currencies are named in. */
  locale: Locale;
  providers: PaymentProvider[];
  tenantId: string;
  /** The storefront origin, when the tenant's domain is known. */
  webhookOrigin?: string;
}

/**
 * The one provider a server of the release before holds for the tenant, which
 * answers `ListTenantPaymentProviders` with `unimplemented`. Choosing another
 * provider there takes the stored one's place and deletes its credentials.
 */
export const TenantPaymentSettingsForm = ({
  canEdit,
  initialSettings: settings,
  loadErrorMessage,
  locale,
  providers,
  tenantId,
  webhookOrigin,
}: TenantPaymentSettingsFormProps) => {
  const status = paymentSettingsStatus(settings);
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);

  const initialProvider =
    providers.find((provider) => provider.id === settings.provider)?.id ??
    providers[0]?.id ??
    "";

  const credentialsProvider = settings.fields.some((field) => field.configured)
    ? settings.provider
    : "";

  const credentialsProviderName =
    providers.find((provider) => provider.id === credentialsProvider)
      ?.displayName ?? credentialsProvider;

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.payment.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.payment.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateTenantPaymentSettingsAction}
        className="grid gap-5 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

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

        {/* A save refreshes the settings; keying on them remounts the fields
            on what the API stored, behind the new hints. */}
        <ActionForm.Fieldset
          className="grid gap-5"
          disabled={fieldsDisabled}
          key={[
            settings.provider,
            settings.currency,
            settings.currencyLocked,
            settings.enabled,
            settings.ready,
            ...settings.fields.map(
              (field) => `${field.name}=${field.configured}:${field.hint}`
            ),
          ].join(":")}
        >
          <ProviderChoice.Root
            credentialsProvider={credentialsProvider}
            initialProvider={initialProvider}
          >
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.payment.provider" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <ProviderChoice.Select providers={providers} />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                    <Message message="admin.settings.payment.provider_description" />
                  </Suspense>
                </Field.Description>
                <ProviderChoice.ChangeNotice>
                  <FormMessage variant="warning">
                    <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                      <Message
                        message="admin.settings.payment.provider_change_warning"
                        values={{ provider: credentialsProviderName }}
                      />
                    </Suspense>
                  </FormMessage>
                </ProviderChoice.ChangeNotice>
              </Field.Content>
            </Field.Root>

            {providers.map((provider) => (
              <ProviderChoice.Panel key={provider.id} provider={provider.id}>
                <PaymentCurrencyField
                  currencies={provider.currencies}
                  currency={settings.currency}
                  description={
                    <Message message="admin.settings.payment.currency_description" />
                  }
                  locale={locale}
                  locked={settings.currencyLocked}
                />
              </ProviderChoice.Panel>
            ))}

            <ProviderEnabled.Root initialEnabled={settings.enabled}>
              <PaymentEnabledField
                description={
                  <Message message="admin.settings.payment.enabled_description" />
                }
              />

              {providers.map((provider) => (
                <ProviderChoice.Panel key={provider.id} provider={provider.id}>
                  <PaymentCredentialFields
                    disabled={fieldsDisabled}
                    provider={provider}
                    stored={
                      provider.id === settings.provider ? settings.fields : []
                    }
                  />
                </ProviderChoice.Panel>
              ))}
            </ProviderEnabled.Root>

            {webhookOrigin
              ? providers.map((provider) => (
                  <ProviderChoice.Panel
                    key={provider.id}
                    provider={provider.id}
                  >
                    <PaymentWebhookUrlField
                      provider={provider}
                      webhookOrigin={webhookOrigin}
                    />
                  </ProviderChoice.Panel>
                ))
              : null}
          </ProviderChoice.Root>
        </ActionForm.Fieldset>

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
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.save" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.saving" />
              </ActionForm.Pending>
            </Suspense>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
