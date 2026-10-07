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
import { Identifier, IdentifierValue } from "@publira/ui-components/identifier";
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
import {
  ProviderChangeNotice,
  ProviderChoice,
  ProviderCredential,
  ProviderCredentialLabel,
  ProviderCredentialTextInput,
  ProviderEnabled,
  ProviderEnabledCheckbox,
  ProviderEnabledRequiredInput,
  ProviderEnabledRequiredLabel,
  ProviderPanel,
  ProviderSelect,
} from "#components/provider-credentials";
import {
  ProviderSecretControls,
  ProviderSecretDescription,
} from "#components/provider-secret-controls";
import {
  inboundEmailSettingsStatus,
  inboundEmailWebhookUrl,
  inboundReplyAddressPattern,
} from "#lib/inbound-email-settings-shared";
import type {
  InboundEmailProvider,
  InboundEmailSettingsStatus,
  TenantInboundEmailSettings,
} from "#lib/inbound-email-settings-shared";

import { updateTenantInboundEmailSettingsAction } from "../_lib/actions";
import {
  InboundEmailReplyAddressCopy,
  InboundEmailWebhookUrlCopy,
} from "./inbound-email-copy";

const statusTone: Record<InboundEmailSettingsStatus, BadgeTone> = {
  disabled: "muted",
  incomplete: "warning",
  ready: "success",
  unset: "muted",
};

const InboundEmailStatusLabel = ({
  status,
}: {
  status: InboundEmailSettingsStatus;
}) => {
  switch (status) {
    case "disabled": {
      return <Message message="admin.settings.inbound_email.status.disabled" />;
    }
    case "incomplete": {
      return (
        <Message message="admin.settings.inbound_email.status.incomplete" />
      );
    }
    case "ready": {
      return <Message message="admin.settings.inbound_email.status.ready" />;
    }
    default: {
      return <Message message="admin.settings.inbound_email.status.unset" />;
    }
  }
};

/**
 * Where readers' replies go in each state. Every state but ready says they go
 * to the staff member who answered, which is the default the section changes.
 */
const InboundEmailStatusDescription = ({
  status,
}: {
  status: InboundEmailSettingsStatus;
}) => {
  switch (status) {
    case "disabled": {
      return (
        <Message message="admin.settings.inbound_email.status.disabled_description" />
      );
    }
    case "incomplete": {
      return (
        <Message message="admin.settings.inbound_email.status.incomplete_description" />
      );
    }
    case "ready": {
      return (
        <Message message="admin.settings.inbound_email.status.ready_description" />
      );
    }
    default: {
      return (
        <Message message="admin.settings.inbound_email.status.unset_description" />
      );
    }
  }
};

/**
 * A credential's name in the console's own catalogs. A field no catalog names
 * yet shows the name the provider declares it under.
 */
const InboundEmailCredentialName = ({
  field,
  provider,
}: {
  field: string;
  provider: string;
}) => {
  switch (`${provider}.${field}`) {
    case "sendgrid.webhook_token": {
      return (
        <Message message="admin.settings.inbound_email.fields.sendgrid.webhook_token" />
      );
    }
    case "resend.api_key": {
      return (
        <Message message="admin.settings.inbound_email.fields.resend.api_key" />
      );
    }
    case "resend.webhook_secret": {
      return (
        <Message message="admin.settings.inbound_email.fields.resend.webhook_secret" />
      );
    }
    default: {
      return field;
    }
  }
};

/** Where a credential comes from: the provider's dashboard, or the tenant. */
const InboundEmailCredentialSource = ({
  field,
  provider,
}: {
  field: string;
  provider: string;
}) => {
  switch (`${provider}.${field}`) {
    case "sendgrid.webhook_token": {
      return (
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.settings.inbound_email.field_sources.sendgrid.webhook_token" />
          </Suspense>
        </FieldDescription>
      );
    }
    case "resend.api_key": {
      return (
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.settings.inbound_email.field_sources.resend.api_key" />
          </Suspense>
        </FieldDescription>
      );
    }
    case "resend.webhook_secret": {
      return (
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.settings.inbound_email.field_sources.resend.webhook_secret" />
          </Suspense>
        </FieldDescription>
      );
    }
    default: {
      return null;
    }
  }
};

/** Where the inbound domain's MX records point, for the provider. */
const InboundEmailDomainNote = ({ provider }: { provider: string }) => {
  switch (provider) {
    case "sendgrid": {
      return (
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.settings.inbound_email.domain_sendgrid_description" />
          </Suspense>
        </FieldDescription>
      );
    }
    case "resend": {
      return (
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.settings.inbound_email.domain_resend_description" />
          </Suspense>
        </FieldDescription>
      );
    }
    default: {
      return null;
    }
  }
};

/** How the provider is told to post received mail to the webhook URL. */
const InboundEmailWebhookNote = ({
  provider,
}: {
  provider: InboundEmailProvider;
}) => {
  switch (provider.id) {
    case "sendgrid": {
      return (
        <Message message="admin.settings.inbound_email.webhook_url_sendgrid_description" />
      );
    }
    case "resend": {
      return (
        <Message message="admin.settings.inbound_email.webhook_url_resend_description" />
      );
    }
    default: {
      return (
        <Message
          message="admin.settings.inbound_email.webhook_url_description"
          values={{ provider: provider.displayName }}
        />
      );
    }
  }
};

interface TenantInboundEmailSettingsFormProps {
  canEdit: boolean;
  initialSettings: TenantInboundEmailSettings;
  loadErrorMessage?: string;
  providers: InboundEmailProvider[];
  tenantId: string;
  /** The storefront origin, when the tenant's domain is known. */
  webhookOrigin?: string;
}

export const TenantInboundEmailSettingsForm = ({
  canEdit,
  initialSettings: settings,
  loadErrorMessage,
  providers,
  tenantId,
  webhookOrigin,
}: TenantInboundEmailSettingsFormProps) => {
  const status = inboundEmailSettingsStatus(settings);
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
  const replyAddress = settings.domain
    ? inboundReplyAddressPattern(settings.domain)
    : undefined;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="admin.settings.inbound_email.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.inbound_email.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantInboundEmailSettingsAction}
        className="grid gap-5 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        {loadErrorMessage ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <StatusChip status={statusTone[status]}>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <InboundEmailStatusLabel status={status} />
              </Suspense>
            </StatusChip>
            <p className="text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <InboundEmailStatusDescription status={status} />
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
            settings.domain,
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
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.inbound_email.provider" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <ProviderSelect providers={providers} />
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                    <Message message="admin.settings.inbound_email.provider_description" />
                  </Suspense>
                </FieldDescription>
                <ProviderChangeNotice>
                  <FormMessage variant="warning">
                    <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                      <Message
                        message="admin.settings.inbound_email.provider_change_warning"
                        values={{ provider: credentialsProviderName }}
                      />
                    </Suspense>
                  </FormMessage>
                </ProviderChangeNotice>
              </FieldContent>
            </Field>

            <ProviderEnabled initialEnabled={settings.enabled}>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.settings.inbound_email.enabled" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <ProviderEnabledCheckbox>
                    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                      <Message message="admin.settings.inbound_email.enabled_checkbox" />
                    </Suspense>
                  </ProviderEnabledCheckbox>
                  <FieldDescription>
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.settings.inbound_email.enabled_description" />
                    </Suspense>
                  </FieldDescription>
                </FieldContent>
              </Field>

              <Field>
                <ProviderEnabledRequiredLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="admin.settings.inbound_email.domain" />
                  </Suspense>
                </ProviderEnabledRequiredLabel>
                <FieldContent>
                  <ProviderEnabledRequiredInput
                    autoComplete="off"
                    defaultValue={settings.domain}
                    name="domain"
                    placeholder="reply.example.com"
                    spellCheck={false}
                    type="text"
                  />
                  <ActionFormFieldError name="domain" />
                </FieldContent>
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.inbound_email.domain_description" />
                  </Suspense>
                </FieldDescription>
                {providers.map((provider) => (
                  <ProviderPanel key={provider.id} provider={provider.id}>
                    <InboundEmailDomainNote provider={provider.id} />
                  </ProviderPanel>
                ))}
              </Field>

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
                        <Field>
                          <ProviderCredentialLabel>
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-32" />}
                            >
                              <InboundEmailCredentialName
                                field={field.name}
                                provider={provider.id}
                              />
                            </Suspense>
                          </ProviderCredentialLabel>
                          <FieldContent>
                            {field.secret ? (
                              <ProviderSecretControls
                                configured={Boolean(state?.configured)}
                                required={field.required}
                              />
                            ) : (
                              <ProviderCredentialTextInput />
                            )}
                            <ActionFormFieldError
                              name={`credential_${field.name}`}
                            />
                          </FieldContent>
                          <InboundEmailCredentialSource
                            field={field.name}
                            provider={provider.id}
                          />
                          {field.secret ? <ProviderSecretDescription /> : null}
                        </Field>
                      </ProviderCredential>
                    );
                  })}
                </ProviderPanel>
              ))}
            </ProviderEnabled>

            {/* The URL is shown before the settings are ready: Resend's
                signing secret, one of the fields that makes them ready, only
                exists once the URL is registered there. */}
            {webhookOrigin
              ? providers.map((provider) => {
                  const webhookUrl = inboundEmailWebhookUrl(
                    webhookOrigin,
                    provider
                  );
                  return (
                    <ProviderPanel key={provider.id} provider={provider.id}>
                      <Field>
                        <FieldLabel>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-24" />}
                          >
                            <Message message="admin.settings.inbound_email.webhook_url" />
                          </Suspense>
                        </FieldLabel>
                        <FieldContent>
                          <Identifier>
                            <IdentifierValue>{webhookUrl}</IdentifierValue>
                            <InboundEmailWebhookUrlCopy value={webhookUrl} />
                          </Identifier>
                          <FieldDescription>
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-3/4" />}
                            >
                              <InboundEmailWebhookNote provider={provider} />
                            </Suspense>
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    </ProviderPanel>
                  );
                })
              : null}

            {replyAddress ? (
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="admin.settings.inbound_email.reply_address" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <Identifier>
                    <IdentifierValue>{replyAddress}</IdentifierValue>
                    <InboundEmailReplyAddressCopy value={replyAddress} />
                  </Identifier>
                  <FieldDescription>
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.settings.inbound_email.reply_address_description" />
                    </Suspense>
                  </FieldDescription>
                </FieldContent>
              </Field>
            ) : null}
          </ProviderChoice>
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
