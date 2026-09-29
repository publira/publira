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
  PaymentCredentialField,
  PaymentCredentialFieldState,
  PaymentProvider,
  PaymentSettingsStatus,
  TenantPaymentSettings,
} from "#lib/payment-settings-shared";

import { updateTenantPaymentSettingsAction } from "../_lib/actions";
import {
  PaymentCredential,
  PaymentCredentialHint,
  PaymentCredentialLabel,
  PaymentCredentialModeButton,
  PaymentCredentialSecretInput,
  PaymentCredentialTextInput,
  PaymentCredentialWhile,
  PaymentEnabled,
  PaymentEnabledCheckbox,
  PaymentProviderChangeNotice,
  PaymentProviderChoice,
  PaymentProviderPanel,
  PaymentProviderSelect,
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
    default: {
      return field;
    }
  }
};

/** What a provider's webhook URL block adds for that provider alone. */
const PaymentWebhookNote = ({ provider }: { provider: string }) => {
  switch (provider) {
    case "stripe": {
      return (
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.settings.payment.webhook_url_legacy_description" />
          </Suspense>
        </FieldDescription>
      );
    }
    default: {
      return null;
    }
  }
};

const PaymentCredentialDescription = ({
  field,
}: {
  field: PaymentCredentialField;
}) => {
  if (field.secret) {
    return (
      <FieldDescription>
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.settings.payment.secret_description" />
        </Suspense>
      </FieldDescription>
    );
  }
  if (field.public) {
    return (
      <FieldDescription>
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.settings.payment.public_description" />
        </Suspense>
      </FieldDescription>
    );
  }
  return null;
};

/** A write-only secret: a stored one shows only its hint until replaced. */
const PaymentSecretControls = ({
  field,
  state,
}: {
  field: PaymentCredentialField;
  state?: PaymentCredentialFieldState;
}) => (
  <>
    <PaymentCredentialWhile mode="keep">
      <div className="flex flex-wrap items-center gap-3">
        <PaymentCredentialHint />
        <PaymentCredentialModeButton mode="replace">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.settings.payment.secret_change" />
          </Suspense>
        </PaymentCredentialModeButton>
        {field.required ? null : (
          <PaymentCredentialModeButton mode="clear">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.settings.payment.secret_remove" />
            </Suspense>
          </PaymentCredentialModeButton>
        )}
      </div>
    </PaymentCredentialWhile>
    <PaymentCredentialWhile mode="replace">
      <div className="flex flex-wrap items-center gap-3">
        <PaymentCredentialSecretInput />
        {state?.configured ? (
          <PaymentCredentialModeButton mode="keep">
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.settings.payment.secret_change_cancel" />
            </Suspense>
          </PaymentCredentialModeButton>
        ) : null}
      </div>
    </PaymentCredentialWhile>
    <PaymentCredentialWhile mode="clear">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.settings.payment.secret_removed" />
          </Suspense>
        </p>
        <PaymentCredentialModeButton mode="keep">
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.settings.payment.secret_remove_cancel" />
          </Suspense>
        </PaymentCredentialModeButton>
      </div>
    </PaymentCredentialWhile>
  </>
);

interface TenantPaymentSettingsFormProps {
  canEdit: boolean;
  initialSettings: TenantPaymentSettings;
  loadErrorMessage?: string;
  providers: PaymentProvider[];
  tenantId: string;
  /** The storefront origin, when the tenant's domain is known. */
  webhookOrigin?: string;
}

export const TenantPaymentSettingsForm = ({
  canEdit,
  initialSettings: settings,
  loadErrorMessage,
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
      <ActionForm
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
        <ActionFormFieldset
          className="grid gap-5"
          disabled={fieldsDisabled}
          key={[
            settings.provider,
            settings.enabled,
            settings.ready,
            ...settings.fields.map(
              (field) => `${field.name}=${field.configured}:${field.hint}`
            ),
          ].join(":")}
        >
          <PaymentProviderChoice
            credentialsProvider={credentialsProvider}
            initialProvider={initialProvider}
          >
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.payment.provider" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <PaymentProviderSelect providers={providers} />
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                    <Message message="admin.settings.payment.provider_description" />
                  </Suspense>
                </FieldDescription>
                <PaymentProviderChangeNotice>
                  <FormMessage variant="warning">
                    <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                      <Message
                        message="admin.settings.payment.provider_change_warning"
                        values={{ provider: credentialsProviderName }}
                      />
                    </Suspense>
                  </FormMessage>
                </PaymentProviderChangeNotice>
              </FieldContent>
            </Field>

            <PaymentEnabled initialEnabled={settings.enabled}>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.settings.payment.enabled" />
                  </Suspense>
                </FieldLabel>
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

              {providers.map((provider) => (
                <PaymentProviderPanel key={provider.id} provider={provider.id}>
                  {provider.fields.map((field) => {
                    const state = stateOf(provider.id, field.name);
                    return (
                      <PaymentCredential
                        configured={Boolean(state?.configured)}
                        disabled={fieldsDisabled}
                        hint={state?.hint ?? ""}
                        key={field.name}
                        name={field.name}
                        required={field.required}
                      >
                        <Field>
                          <PaymentCredentialLabel>
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-32" />}
                            >
                              <PaymentCredentialName
                                field={field.name}
                                provider={provider.id}
                              />
                            </Suspense>
                          </PaymentCredentialLabel>
                          <FieldContent>
                            {field.secret ? (
                              <PaymentSecretControls
                                field={field}
                                state={state}
                              />
                            ) : (
                              <PaymentCredentialTextInput />
                            )}
                            <ActionFormFieldError
                              name={`credential_${field.name}`}
                            />
                          </FieldContent>
                          <PaymentCredentialDescription field={field} />
                        </Field>
                      </PaymentCredential>
                    );
                  })}
                </PaymentProviderPanel>
              ))}
            </PaymentEnabled>

            {webhookOrigin
              ? providers.map((provider) => (
                  <PaymentProviderPanel
                    key={provider.id}
                    provider={provider.id}
                  >
                    <Field>
                      <FieldLabel>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-24" />}
                        >
                          <Message message="admin.settings.payment.webhook_url" />
                        </Suspense>
                      </FieldLabel>
                      <FieldContent>
                        <Input
                          disabled
                          readOnly
                          type="text"
                          value={`${webhookOrigin}${provider.webhookPath}`}
                        />
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message
                              message="admin.settings.payment.webhook_url_description"
                              values={{ provider: provider.displayName }}
                            />
                          </Suspense>
                        </FieldDescription>
                        <PaymentWebhookNote provider={provider.id} />
                      </FieldContent>
                    </Field>
                  </PaymentProviderPanel>
                ))
              : null}
          </PaymentProviderChoice>
        </ActionFormFieldset>

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
