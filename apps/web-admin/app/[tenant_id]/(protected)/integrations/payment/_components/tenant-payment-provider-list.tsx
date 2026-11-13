import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import * as Card from "@publira/ui-components/card";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import * as ProviderChoice from "#components/provider-choice";
import * as ProviderEnabled from "#components/provider-enabled";
import { SettledToast } from "#components/settled-toast";
import {
  paymentProviderCurrencies,
  paymentProviderStatus,
  subscriptionPlanProvider,
} from "#lib/payment-settings-shared";
import type {
  PaymentProvider,
  PaymentProviderStatus,
  TenantPaymentProviderSettings,
  TenantPaymentProviders,
} from "#lib/payment-settings-shared";

import {
  addTenantPaymentProviderAction,
  removeTenantPaymentProviderAction,
  saveTenantPaymentProviderAction,
} from "../_lib/actions";
import {
  PaymentCredentialFields,
  PaymentCurrencyField,
  PaymentEnabledField,
  PaymentWebhookUrlField,
} from "./payment-provider-fields";

const statusTone: Record<PaymentProviderStatus, BadgeTone> = {
  disabled: "muted",
  incomplete: "warning",
  ready: "success",
  removed: "muted",
};

const ProviderStatusLabel = ({ status }: { status: PaymentProviderStatus }) => {
  switch (status) {
    case "incomplete": {
      return <Message message="admin.settings.payment.status.incomplete" />;
    }

    case "ready": {
      return <Message message="admin.settings.payment.status.ready" />;
    }

    case "removed": {
      return <Message message="admin.settings.payment.status.removed" />;
    }

    default: {
      return <Message message="admin.settings.payment.status.disabled" />;
    }
  }
};

const ProviderStatusDescription = ({
  provider,
  status,
}: {
  provider: string;
  status: PaymentProviderStatus;
}) => {
  const values = { provider };

  switch (status) {
    case "incomplete": {
      return (
        <Message
          message="admin.settings.payment.provider_status.incomplete_description"
          values={values}
        />
      );
    }

    case "ready": {
      return (
        <Message
          message="admin.settings.payment.provider_status.ready_description"
          values={values}
        />
      );
    }

    case "removed": {
      return (
        <Message
          message="admin.settings.payment.provider_status.removed_description"
          values={values}
        />
      );
    }

    default: {
      return (
        <Message
          message="admin.settings.payment.provider_status.disabled_description"
          values={values}
        />
      );
    }
  }
};

/**
 * What a reader can buy through `provider`. Every provider sells episodes,
 * volumes, coins, and tips; subscription plans are sold through the first
 * ready provider that takes recurring payments, since a plan's price is a
 * price on that one provider's account.
 */
const ProviderSales = ({
  planProvider,
  provider,
}: {
  planProvider?: PaymentProvider;
  provider: PaymentProvider;
}) => {
  if (!provider.subscriptions) {
    return <Message message="admin.settings.payment.sells.without_plans" />;
  }

  if (planProvider && planProvider.id !== provider.id) {
    return (
      <Message
        message="admin.settings.payment.sells.plans_elsewhere"
        values={{ provider: planProvider.displayName }}
      />
    );
  }

  return <Message message="admin.settings.payment.sells.with_plans" />;
};

/**
 * The currency `provider` is saved with, among the ones it charges in beside
 * the other providers the tenant sells through, or why there is none.
 */
const ProviderCurrency = ({
  held,
  locale,
  provider,
  registered,
}: {
  held: TenantPaymentProviders;
  locale: Locale;
  provider: PaymentProvider;
  registered: readonly PaymentProvider[];
}) => {
  const currencies = paymentProviderCurrencies(provider, held, registered);

  if (currencies.length === 0) {
    return (
      <FormMessage variant="warning">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          {held.currencyLocked ? (
            <Message
              message="admin.settings.payment.currency_unavailable_locked"
              values={{
                currency: held.currency,
                provider: provider.displayName,
              }}
            />
          ) : (
            <Message
              message="admin.settings.payment.currency_unavailable"
              values={{ provider: provider.displayName }}
            />
          )}
        </Suspense>
      </FormMessage>
    );
  }

  return (
    <PaymentCurrencyField
      currencies={currencies}
      currency={held.currency}
      description={
        <Message message="admin.settings.payment.currency_shared_description" />
      }
      locale={locale}
      locked={held.currencyLocked}
    />
  );
};

/**
 * Removes a provider the tenant holds, or deletes one it removed before. A
 * form of its own, so that a removal posts none of the credentials typed into
 * the card beside it.
 */
const RemoveProviderForm = ({
  disabled,
  provider,
  retired,
  tenantId,
}: {
  disabled: boolean;
  provider: PaymentProvider;
  retired: boolean;
  tenantId: string;
}) => {
  const formId = `remove-payment-provider-${provider.id}`;
  const values = { provider: provider.displayName };

  return (
    <ActionForm.Root
      action={removeTenantPaymentProviderAction}
      className="grid justify-items-end gap-2"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="provider" type="hidden" value={provider.id} />
      {retired ? <input name="retired" type="hidden" value="1" /> : null}
      <SettledToast />
      <ActionForm.Fieldset disabled={disabled}>
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={<Button size="sm" type="button" variant="outline" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              {retired ? (
                <Message message="admin.settings.payment.delete" />
              ) : (
                <Message message="admin.settings.payment.remove" />
              )}
            </Suspense>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  {retired ? (
                    <Message
                      message="admin.settings.payment.delete_title"
                      values={values}
                    />
                  ) : (
                    <Message
                      message="admin.settings.payment.remove_title"
                      values={values}
                    />
                  )}
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  {retired ? (
                    <Message
                      message="admin.settings.payment.delete_description"
                      values={values}
                    />
                  ) : (
                    <Message
                      message="admin.settings.payment.remove_description"
                      values={values}
                    />
                  )}
                </Suspense>
              </ConfirmDialog.Description>
            </ConfirmDialog.Header>
            <ConfirmDialog.Footer>
              <ConfirmDialog.Cancel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.common.cancel" />
                </Suspense>
              </ConfirmDialog.Cancel>
              <ConfirmDialog.Action form={formId}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  {retired ? (
                    <Message message="admin.settings.payment.delete" />
                  ) : (
                    <Message message="admin.settings.payment.remove" />
                  )}
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};

interface ProviderCardProps {
  canEdit: boolean;
  disabled: boolean;
  held: TenantPaymentProviders;
  locale: Locale;
  planProvider?: PaymentProvider;
  provider: PaymentProvider;
  registered: readonly PaymentProvider[];
  settings: TenantPaymentProviderSettings;
  tenantId: string;
  webhookOrigin?: string;
}

/** One provider the tenant holds: where it stands, what it sells, its form. */
const ProviderCard = ({
  canEdit,
  disabled,
  held,
  locale,
  planProvider,
  provider,
  registered,
  settings,
  tenantId,
  webhookOrigin,
}: ProviderCardProps) => {
  const status = paymentProviderStatus(settings);
  const titleId = `payment-provider-${provider.id}`;

  return (
    <section aria-labelledby={titleId}>
      <Card.Root>
        <Card.Header className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="grid gap-2">
            <h3
              className="text-lg leading-tight font-medium text-foreground"
              id={titleId}
            >
              {provider.displayName}
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip status={statusTone[status]}>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <ProviderStatusLabel status={status} />
                </Suspense>
              </StatusChip>
              <p className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <ProviderStatusDescription
                    provider={provider.displayName}
                    status={status}
                  />
                </Suspense>
              </p>
            </div>
            {settings.retired ? null : (
              <p className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <ProviderSales
                    planProvider={planProvider}
                    provider={provider}
                  />
                </Suspense>
              </p>
            )}
          </div>
          {canEdit ? (
            <RemoveProviderForm
              disabled={disabled}
              provider={provider}
              retired={settings.retired}
              tenantId={tenantId}
            />
          ) : null}
        </Card.Header>
        <Card.Content>
          <ActionForm.Root
            action={saveTenantPaymentProviderAction}
            className="grid gap-5"
          >
            <input name="tenant_id" type="hidden" value={tenantId} />
            <input name="provider" type="hidden" value={provider.id} />

            {/* A save refreshes the providers; keying on what is stored
                remounts the fields on it, behind the new hints. */}
            <ActionForm.Fieldset
              className="grid gap-5"
              disabled={disabled}
              key={[
                held.currency,
                held.currencyLocked,
                settings.enabled,
                settings.ready,
                settings.retired,
                ...settings.fields.map(
                  (field) => `${field.name}=${field.configured}:${field.hint}`
                ),
              ].join(":")}
            >
              <ProviderCurrency
                held={held}
                locale={locale}
                provider={provider}
                registered={registered}
              />
              <ProviderEnabled.Root initialEnabled={settings.enabled}>
                <PaymentEnabledField
                  description={
                    <Message message="admin.settings.payment.enabled_provider_description" />
                  }
                />
                <PaymentCredentialFields
                  disabled={disabled}
                  provider={provider}
                  stored={settings.fields}
                />
              </ProviderEnabled.Root>
              {webhookOrigin ? (
                <PaymentWebhookUrlField
                  provider={provider}
                  webhookOrigin={webhookOrigin}
                />
              ) : null}
            </ActionForm.Fieldset>

            <div className="flex flex-wrap gap-3">
              <ActionForm.Submit disabled={disabled}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <ActionForm.Idle>
                    {settings.retired ? (
                      <Message message="admin.settings.payment.restore" />
                    ) : (
                      <Message message="admin.settings.save" />
                    )}
                  </ActionForm.Idle>
                  <ActionForm.Pending>
                    <Message message="admin.settings.saving" />
                  </ActionForm.Pending>
                </Suspense>
              </ActionForm.Submit>
            </div>
          </ActionForm.Root>
        </Card.Content>
      </Card.Root>
    </section>
  );
};

interface AddProviderFormProps {
  addable: readonly PaymentProvider[];
  disabled: boolean;
  held: TenantPaymentProviders;
  locale: Locale;
  registered: readonly PaymentProvider[];
  tenantId: string;
  webhookOrigin?: string;
}

/** Adds one of the providers the tenant does not hold beside the others. */
const AddProviderForm = ({
  addable,
  disabled,
  held,
  locale,
  registered,
  tenantId,
  webhookOrigin,
}: AddProviderFormProps) => (
  <section aria-labelledby="add-payment-provider" className="grid gap-4">
    <div className="grid gap-1">
      <h3
        className="text-lg leading-tight font-medium text-foreground"
        id="add-payment-provider"
      >
        <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
          <Message message="admin.settings.payment.add_title" />
        </Suspense>
      </h3>
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
          <Message message="admin.settings.payment.add_description" />
        </Suspense>
      </p>
    </div>
    <ActionForm.Root
      action={addTenantPaymentProviderAction}
      className="grid gap-5"
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <SettledToast />

      {/* An addition takes the provider out of the select; keying on the
          ones left starts the form over on the first of them. */}
      <ActionForm.Fieldset
        className="grid gap-5"
        disabled={disabled}
        key={addable.map((provider) => provider.id).join(":")}
      >
        <ProviderChoice.Root
          credentialsProvider=""
          initialProvider={addable[0]?.id ?? ""}
        >
          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.settings.payment.provider" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <ProviderChoice.Select providers={addable} />
            </Field.Content>
          </Field.Root>

          {addable.map((provider) => (
            <ProviderChoice.Panel key={provider.id} provider={provider.id}>
              <ProviderCurrency
                held={held}
                locale={locale}
                provider={provider}
                registered={registered}
              />
            </ProviderChoice.Panel>
          ))}

          <ProviderEnabled.Root initialEnabled={false}>
            <PaymentEnabledField
              description={
                <Message message="admin.settings.payment.enabled_provider_description" />
              }
            />
            {addable.map((provider) => (
              <ProviderChoice.Panel key={provider.id} provider={provider.id}>
                <PaymentCredentialFields
                  disabled={disabled}
                  provider={provider}
                  stored={[]}
                />
              </ProviderChoice.Panel>
            ))}
          </ProviderEnabled.Root>

          {webhookOrigin
            ? addable.map((provider) => (
                <ProviderChoice.Panel key={provider.id} provider={provider.id}>
                  <PaymentWebhookUrlField
                    provider={provider}
                    webhookOrigin={webhookOrigin}
                  />
                </ProviderChoice.Panel>
              ))
            : null}
        </ProviderChoice.Root>
      </ActionForm.Fieldset>

      <div className="flex flex-wrap gap-3">
        <ActionForm.Submit disabled={disabled}>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <ActionForm.Idle>
              <Message message="admin.settings.payment.add_submit" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.settings.payment.adding" />
            </ActionForm.Pending>
          </Suspense>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </section>
);

interface TenantPaymentProviderListProps {
  canEdit: boolean;
  held: TenantPaymentProviders;
  loadErrorMessage?: string;
  /** The operator's locale, which the currencies are named in. */
  locale: Locale;
  /** Every provider the server registers. */
  providers: PaymentProvider[];
  tenantId: string;
  /** The storefront origin, when the tenant's domain is known. */
  webhookOrigin?: string;
}

/**
 * Every payment provider the tenant holds, a card each, and the form that adds
 * one it does not. A provider this build no longer registers has no fields to
 * show, so it has no card either.
 */
export const TenantPaymentProviderList = ({
  canEdit,
  held,
  loadErrorMessage,
  locale,
  providers,
  tenantId,
  webhookOrigin,
}: TenantPaymentProviderListProps) => {
  const disabled = !canEdit || Boolean(loadErrorMessage);

  const cards = held.providers.flatMap((settings) => {
    const provider = providers.find(
      (candidate) => candidate.id === settings.provider
    );

    return provider ? [{ provider, settings }] : [];
  });

  const addable = providers.filter(
    (provider) =>
      !held.providers.some((settings) => settings.provider === provider.id)
  );

  const planProviderId = subscriptionPlanProvider(held, providers);

  const planProvider = providers.find(
    (provider) => provider.id === planProviderId
  );

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
              <Message message="admin.settings.payment.providers_description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>

      {canEdit ? null : (
        <FormMessage variant="destructive">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.settings.admin_only" />
          </Suspense>
        </FormMessage>
      )}

      {loadErrorMessage ? (
        <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
      ) : (
        <div className="grid gap-6 sm:max-w-3xl">
          {cards.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip status="muted">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.settings.payment.status.unset" />
                </Suspense>
              </StatusChip>
              <p className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.settings.payment.providers_unset" />
                </Suspense>
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {cards.map(({ provider, settings }) => (
                <ProviderCard
                  canEdit={canEdit}
                  disabled={disabled}
                  held={held}
                  key={provider.id}
                  locale={locale}
                  planProvider={planProvider}
                  provider={provider}
                  registered={providers}
                  settings={settings}
                  tenantId={tenantId}
                  webhookOrigin={webhookOrigin}
                />
              ))}
            </div>
          )}
          {addable.length > 0 ? (
            <AddProviderForm
              addable={addable}
              disabled={disabled}
              held={held}
              locale={locale}
              registered={providers}
              tenantId={tenantId}
              webhookOrigin={webhookOrigin}
            />
          ) : null}
        </div>
      )}
    </ConsoleSection.Root>
  );
};
