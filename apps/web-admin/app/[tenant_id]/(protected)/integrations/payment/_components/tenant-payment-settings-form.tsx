import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { currencyDisplayName } from "@publira/utils";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import {
  ProviderChangeNotice,
  ProviderChoice,
  ProviderCredential,
  ProviderCredentialLabel,
  ProviderCredentialTextInput,
  ProviderEnabled,
  ProviderEnabledCheckbox,
  ProviderPanel,
  ProviderSelect,
} from "#components/provider-credentials";
import {
  ProviderSecretControls,
  ProviderSecretDescription,
} from "#components/provider-secret-controls";
import { paymentSettingsStatus } from "#lib/payment-settings-shared";
import type {
  PaymentCredentialField,
  PaymentProvider,
  PaymentSettingsStatus,
  TenantPaymentSettings,
} from "#lib/payment-settings-shared";

import { updateTenantPaymentSettingsAction } from "../_lib/actions";

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

/**
 * A credential's name in the console's own catalogs. A field no catalog names
 * yet shows the name the provider declares it under.
 */
const PaymentCredentialName = ({
  field,
  provider,
}: {
  field: string;
  provider: string;
}) => {
  switch (`${provider}.${field}`) {
    case "stripe.secret_key": {
      return (
        <Message message="admin.settings.payment.fields.stripe.secret_key" />
      );
    }
    case "stripe.webhook_secret": {
      return (
        <Message message="admin.settings.payment.fields.stripe.webhook_secret" />
      );
    }
    case "payjp.secret_key": {
      return (
        <Message message="admin.settings.payment.fields.payjp.secret_key" />
      );
    }
    case "payjp.webhook_token": {
      return (
        <Message message="admin.settings.payment.fields.payjp.webhook_token" />
      );
    }
    default: {
      return field;
    }
  }
};

/** Where in the provider's own dashboard a credential is found. */
const PaymentCredentialSource = ({
  field,
  provider,
}: {
  field: string;
  provider: string;
}) => {
  switch (`${provider}.${field}`) {
    case "payjp.secret_key": {
      return (
        <Field.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.settings.payment.field_sources.payjp.secret_key" />
          </Suspense>
        </Field.Description>
      );
    }
    case "payjp.webhook_token": {
      return (
        <Field.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.settings.payment.field_sources.payjp.webhook_token" />
          </Suspense>
        </Field.Description>
      );
    }
    default: {
      return null;
    }
  }
};

/** What a provider's webhook URL block adds for that provider alone. */
const PaymentWebhookNote = ({ provider }: { provider: string }) => {
  if (provider !== "payjp") {
    return null;
  }
  return (
    <Field.Description>
      <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
        <Message message="admin.settings.payment.webhook_url_payjp_description" />
      </Suspense>
    </Field.Description>
  );
};

const PaymentCredentialDescription = ({
  field,
}: {
  field: PaymentCredentialField;
}) => {
  if (field.secret) {
    return <ProviderSecretDescription />;
  }
  if (field.public) {
    return (
      <Field.Description>
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.settings.payment.public_description" />
        </Suspense>
      </Field.Description>
    );
  }
  return null;
};

/**
 * The currency the tenant sells in, chosen among those `provider` charges in.
 * It starts on the saved currency where the provider charges in it, and on the
 * first it declares otherwise, which a save to a provider that cannot charge
 * in the saved one then asks for. Once a purchase locks it the select is
 * disabled, so the form posts no currency and the stored one is kept.
 */
const PaymentCurrencyField = ({
  locale,
  provider,
  settings,
}: {
  locale: Locale;
  provider: PaymentProvider;
  settings: TenantPaymentSettings;
}) => (
  <Field.Root>
    <Field.Label>
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="admin.settings.payment.currency" />
      </Suspense>
    </Field.Label>
    <Field.Content>
      <Select
        defaultValue={
          provider.currencies.includes(settings.currency)
            ? settings.currency
            : provider.currencies[0]
        }
        disabled={settings.currencyLocked}
        items={provider.currencies.map((currency) => ({
          label: `${currencyDisplayName(currency, { locale })} (${currency})`,
          value: currency,
        }))}
        name="currency"
      />
      <ActionForm.FieldError name="currency" />
      <Field.Description>
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          {settings.currencyLocked ? (
            <Message message="admin.settings.payment.currency_locked" />
          ) : (
            <Message message="admin.settings.payment.currency_description" />
          )}
        </Suspense>
      </Field.Description>
    </Field.Content>
  </Field.Root>
);

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
  const stateOf = (provider: string, field: string) =>
    provider === settings.provider
      ? settings.fields.find((state) => state.name === field)
      : undefined;

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
          <ProviderChoice
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
                <ProviderSelect providers={providers} />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                    <Message message="admin.settings.payment.provider_description" />
                  </Suspense>
                </Field.Description>
                <ProviderChangeNotice>
                  <FormMessage variant="warning">
                    <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                      <Message
                        message="admin.settings.payment.provider_change_warning"
                        values={{ provider: credentialsProviderName }}
                      />
                    </Suspense>
                  </FormMessage>
                </ProviderChangeNotice>
              </Field.Content>
            </Field.Root>

            {providers.map((provider) => (
              <ProviderPanel key={provider.id} provider={provider.id}>
                <PaymentCurrencyField
                  locale={locale}
                  provider={provider}
                  settings={settings}
                />
              </ProviderPanel>
            ))}

            <ProviderEnabled initialEnabled={settings.enabled}>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.settings.payment.enabled" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <ProviderEnabledCheckbox>
                    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                      <Message message="admin.settings.payment.enabled_checkbox" />
                    </Suspense>
                  </ProviderEnabledCheckbox>
                  <Field.Description>
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.settings.payment.enabled_description" />
                    </Suspense>
                  </Field.Description>
                </Field.Content>
              </Field.Root>

              {providers.map((provider) => (
                <ProviderPanel key={provider.id} provider={provider.id}>
                  {provider.fields.map((field) => {
                    const state = stateOf(provider.id, field.name);
                    return (
                      <ProviderCredential
                        configured={Boolean(state?.configured)}
                        disabled={fieldsDisabled}
                        hint={state?.hint ?? ""}
                        key={field.name}
                        name={field.name}
                        required={field.required}
                      >
                        <Field.Root>
                          <ProviderCredentialLabel>
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-32" />}
                            >
                              <PaymentCredentialName
                                field={field.name}
                                provider={provider.id}
                              />
                            </Suspense>
                          </ProviderCredentialLabel>
                          <Field.Content>
                            {field.secret ? (
                              <ProviderSecretControls
                                configured={Boolean(state?.configured)}
                                required={field.required}
                              />
                            ) : (
                              <ProviderCredentialTextInput />
                            )}
                            <ActionForm.FieldError
                              name={`credential_${field.name}`}
                            />
                          </Field.Content>
                          <PaymentCredentialSource
                            field={field.name}
                            provider={provider.id}
                          />
                          <PaymentCredentialDescription field={field} />
                        </Field.Root>
                      </ProviderCredential>
                    );
                  })}
                </ProviderPanel>
              ))}
            </ProviderEnabled>

            {webhookOrigin
              ? providers.map((provider) => (
                  <ProviderPanel key={provider.id} provider={provider.id}>
                    <Field.Root>
                      <Field.Label>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-24" />}
                        >
                          <Message message="admin.settings.payment.webhook_url" />
                        </Suspense>
                      </Field.Label>
                      <Field.Content>
                        <Input
                          disabled
                          readOnly
                          type="text"
                          value={`${webhookOrigin}${provider.webhookPath}`}
                        />
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message
                              message="admin.settings.payment.webhook_url_description"
                              values={{ provider: provider.displayName }}
                            />
                          </Suspense>
                        </Field.Description>
                        <PaymentWebhookNote provider={provider.id} />
                      </Field.Content>
                    </Field.Root>
                  </ProviderPanel>
                ))
              : null}
          </ProviderChoice>
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
    </AdminSection>
  );
};
