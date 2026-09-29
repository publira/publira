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
import { RadioGroup } from "@publira/ui-components/radio-group";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { storeStatus } from "#lib/store-payment-settings-shared";
import type {
  StoreStatus,
  TenantStorePaymentSettings,
} from "#lib/store-payment-settings-shared";

import {
  CredentialsEnabled,
  CredentialsEnabledCheckbox,
  CredentialsEnabledLabel,
  SecretKey,
  SecretKeyFile,
  SecretKeyModeButton,
  SecretKeyText,
  SecretKeyWhile,
} from "../../_components/credential-controls";
import { updateTenantStorePaymentSettingsAction } from "../_lib/actions";

const statusTone: Record<StoreStatus, BadgeTone> = {
  disabled: "muted",
  incomplete: "warning",
  ready: "success",
  unset: "muted",
};

const StoreStatusLabel = ({ status }: { status: StoreStatus }) => {
  switch (status) {
    case "disabled": {
      return <Message message="admin.settings.store_payment.status.disabled" />;
    }
    case "incomplete": {
      return (
        <Message message="admin.settings.store_payment.status.incomplete" />
      );
    }
    case "ready": {
      return <Message message="admin.settings.store_payment.status.ready" />;
    }
    default: {
      return <Message message="admin.settings.store_payment.status.unset" />;
    }
  }
};

const StoreStatusDescription = ({ status }: { status: StoreStatus }) => {
  switch (status) {
    case "disabled": {
      return (
        <Message message="admin.settings.store_payment.status.disabled_description" />
      );
    }
    case "incomplete": {
      return (
        <Message message="admin.settings.store_payment.status.incomplete_description" />
      );
    }
    case "ready": {
      return (
        <Message message="admin.settings.store_payment.status.ready_description" />
      );
    }
    default: {
      return (
        <Message message="admin.settings.store_payment.status.unset_description" />
      );
    }
  }
};

const StoreStatusLine = ({ status }: { status: StoreStatus }) => (
  <div className="flex flex-wrap items-center gap-3">
    <StatusChip status={statusTone[status]}>
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <StoreStatusLabel status={status} />
      </Suspense>
    </StatusChip>
    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
        <StoreStatusDescription status={status} />
      </Suspense>
    </p>
  </div>
);

/** A value this form shows but does not edit, such as the app a store sells in. */
const ReadOnlyField = ({
  description,
  label,
  value,
}: {
  description: ReactNode;
  label: ReactNode;
  value: string;
}) => (
  <Field>
    <FieldLabel>{label}</FieldLabel>
    <FieldContent>
      {value ? (
        <Input disabled readOnly type="text" value={value} />
      ) : (
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <Message message="admin.settings.store_payment.app_identity_unset" />
          </Suspense>
        </p>
      )}
      <FieldDescription>{description}</FieldDescription>
    </FieldContent>
  </Field>
);

interface TenantStorePaymentSettingsFormProps {
  canEdit: boolean;
  /** The saved settings, absent when the read failed. */
  initialSettings?: TenantStorePaymentSettings;
  loadErrorMessage?: string;
  /**
   * Where App Store Server Notifications reach this tenant, absent while the
   * tenant has no domain.
   */
  notificationUrl?: string;
  tenantId: string;
}

export const TenantStorePaymentSettingsForm = ({
  canEdit,
  initialSettings: settings,
  loadErrorMessage,
  notificationUrl,
  tenantId,
}: TenantStorePaymentSettingsFormProps) => {
  // A failed read leaves nothing to seed the fields with, and a save from that
  // state would write over what is stored.
  const fieldsDisabled = !canEdit || settings === undefined;
  // The store route needs a store that is ready as saved; one being set up in
  // this same save becomes selectable once it is.
  const storeRouteAvailable =
    settings !== undefined &&
    (settings.appStore.ready ||
      settings.googlePlay.ready ||
      settings.appPurchaseRoute === "store");

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.store_payment.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.store_payment.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantStorePaymentSettingsAction}
        className="grid gap-8 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        {settings === undefined ? null : (
          // A save refreshes the settings; keying on them remounts the fields
          // on what the API stored instead of changing a mounted default.
          <ActionFormFieldset
            className="grid gap-8"
            disabled={fieldsDisabled}
            key={JSON.stringify(settings)}
          >
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="admin.settings.store_payment.route" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <RadioGroup
                  defaultValue={settings.appPurchaseRoute}
                  items={[
                    {
                      description: (
                        <Suspense
                          fallback={<SkeletonLine className="h-3 w-64" />}
                        >
                          <Message message="admin.settings.store_payment.routes.external_checkout_description" />
                        </Suspense>
                      ),
                      label: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.store_payment.routes.external_checkout" />
                        </Suspense>
                      ),
                      value: "external_checkout",
                    },
                    {
                      description: (
                        <Suspense
                          fallback={<SkeletonLine className="h-3 w-64" />}
                        >
                          <Message message="admin.settings.store_payment.routes.store_description" />
                          {storeRouteAvailable ? null : (
                            <>
                              {" "}
                              <Message message="admin.settings.store_payment.routes.store_unavailable" />
                            </>
                          )}
                        </Suspense>
                      ),
                      disabled: !storeRouteAvailable,
                      label: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.store_payment.routes.store" />
                        </Suspense>
                      ),
                      value: "store",
                    },
                  ]}
                  name="app_purchase_route"
                />
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.store_payment.route_description" />
                  </Suspense>
                </FieldDescription>
                <ActionFormFieldError name="appPurchaseRoute" />
              </FieldContent>
            </Field>

            <CredentialsEnabled initialEnabled={settings.appStore.enabled}>
              <fieldset className="grid gap-5">
                <legend className="mb-3 text-base font-semibold text-foreground">
                  <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
                    <Message message="admin.settings.store_payment.app_store.title" />
                  </Suspense>
                </legend>
                <StoreStatusLine
                  status={storeStatus({
                    enabled: settings.appStore.enabled,
                    keyConfigured: settings.appStore.privateKeyConfigured,
                    ready: settings.appStore.ready,
                  })}
                />
                <CredentialsEnabledCheckbox name="app_store_enabled">
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.settings.store_payment.app_store.enabled" />
                  </Suspense>
                </CredentialsEnabledCheckbox>
                <Field>
                  <CredentialsEnabledLabel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      <Message message="admin.settings.store_payment.app_store.issuer_id" />
                    </Suspense>
                  </CredentialsEnabledLabel>
                  <FieldContent>
                    <Input
                      autoComplete="off"
                      defaultValue={settings.appStore.issuerId}
                      name="issuer_id"
                      placeholder="57246542-96fe-1a63-e053-0824d011072a"
                      spellCheck={false}
                      type="text"
                    />
                    <ActionFormFieldError name="issuerId" />
                    <FieldDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.store_payment.app_store.issuer_id_description" />
                      </Suspense>
                    </FieldDescription>
                  </FieldContent>
                </Field>
                <Field>
                  <CredentialsEnabledLabel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                      <Message message="admin.settings.store_payment.app_store.key_id" />
                    </Suspense>
                  </CredentialsEnabledLabel>
                  <FieldContent>
                    <Input
                      autoComplete="off"
                      defaultValue={settings.appStore.keyId}
                      name="key_id"
                      placeholder="2X9R4HXF34"
                      spellCheck={false}
                      type="text"
                    />
                    <ActionFormFieldError name="keyId" />
                  </FieldContent>
                </Field>
                <SecretKey
                  accept=".p8"
                  configured={settings.appStore.privateKeyConfigured}
                  name="private_key"
                >
                  <SecretKeyWhile mode="keep">
                    <Field>
                      <FieldLabel>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.store_payment.app_store.private_key" />
                        </Suspense>
                      </FieldLabel>
                      <FieldContent>
                        <div className="flex flex-wrap items-center gap-3">
                          <Input
                            disabled
                            readOnly
                            type="text"
                            value={settings.appStore.privateKeyHint}
                          />
                          <SecretKeyModeButton mode="replace">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-16" />}
                            >
                              <Message message="admin.settings.store_payment.key_change" />
                            </Suspense>
                          </SecretKeyModeButton>
                          <SecretKeyModeButton mode="clear">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-16" />}
                            >
                              <Message message="admin.settings.store_payment.key_clear" />
                            </Suspense>
                          </SecretKeyModeButton>
                        </div>
                        <ActionFormFieldError name="privateKey" />
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.store_payment.app_store.private_key_description" />
                          </Suspense>
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </SecretKeyWhile>
                  <SecretKeyWhile mode="replace">
                    <Field>
                      <CredentialsEnabledLabel>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.store_payment.app_store.private_key" />
                        </Suspense>
                      </CredentialsEnabledLabel>
                      <FieldContent>
                        <SecretKeyFile />
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.store_payment.app_store.private_key_description" />
                          </Suspense>
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                    <Field>
                      <FieldLabel>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-32" />}
                        >
                          <Message message="admin.settings.store_payment.key_text" />
                        </Suspense>
                      </FieldLabel>
                      <FieldContent>
                        <SecretKeyText />
                        <ActionFormFieldError name="privateKey" />
                        {settings.appStore.privateKeyConfigured ? (
                          <div>
                            <SecretKeyModeButton mode="keep">
                              <Suspense
                                fallback={<SkeletonLine className="h-4 w-24" />}
                              >
                                <Message message="admin.settings.store_payment.key_change_cancel" />
                              </Suspense>
                            </SecretKeyModeButton>
                          </div>
                        ) : null}
                      </FieldContent>
                    </Field>
                  </SecretKeyWhile>
                  <SecretKeyWhile mode="clear">
                    <Field>
                      <FieldLabel>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.store_payment.app_store.private_key" />
                        </Suspense>
                      </FieldLabel>
                      <FieldContent>
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-sm text-foreground">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-48" />}
                            >
                              <Message message="admin.settings.store_payment.key_cleared" />
                            </Suspense>
                          </p>
                          <SecretKeyModeButton mode="keep">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-24" />}
                            >
                              <Message message="admin.settings.store_payment.key_clear_cancel" />
                            </Suspense>
                          </SecretKeyModeButton>
                        </div>
                        <ActionFormFieldError name="privateKey" />
                      </FieldContent>
                    </Field>
                  </SecretKeyWhile>
                </SecretKey>
                <ReadOnlyField
                  description={
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.settings.store_payment.app_store.bundle_identifier_description" />
                    </Suspense>
                  }
                  label={
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      <Message message="admin.settings.store_payment.app_store.bundle_identifier" />
                    </Suspense>
                  }
                  value={settings.appStore.bundleIdentifier}
                />
                {notificationUrl ? (
                  <ReadOnlyField
                    description={
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.store_payment.app_store.notification_url_description" />
                      </Suspense>
                    }
                    label={
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-56" />}
                      >
                        <Message message="admin.settings.store_payment.app_store.notification_url" />
                      </Suspense>
                    }
                    value={notificationUrl}
                  />
                ) : null}
              </fieldset>
            </CredentialsEnabled>

            <CredentialsEnabled initialEnabled={settings.googlePlay.enabled}>
              <fieldset className="grid gap-5">
                <legend className="mb-3 text-base font-semibold text-foreground">
                  <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
                    <Message message="admin.settings.store_payment.google_play.title" />
                  </Suspense>
                </legend>
                <StoreStatusLine
                  status={storeStatus({
                    enabled: settings.googlePlay.enabled,
                    keyConfigured:
                      settings.googlePlay.serviceAccountKeyConfigured,
                    ready: settings.googlePlay.ready,
                  })}
                />
                <CredentialsEnabledCheckbox name="google_play_enabled">
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.settings.store_payment.google_play.enabled" />
                  </Suspense>
                </CredentialsEnabledCheckbox>
                <SecretKey
                  accept=".json,application/json"
                  configured={settings.googlePlay.serviceAccountKeyConfigured}
                  name="service_account_key"
                >
                  <SecretKeyWhile mode="keep">
                    <Field>
                      <FieldLabel>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-40" />}
                        >
                          <Message message="admin.settings.store_payment.google_play.service_account_key" />
                        </Suspense>
                      </FieldLabel>
                      <FieldContent>
                        <div className="flex flex-wrap items-center gap-3">
                          <Input
                            disabled
                            readOnly
                            type="text"
                            value={settings.googlePlay.serviceAccountKeyHint}
                          />
                          <SecretKeyModeButton mode="replace">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-16" />}
                            >
                              <Message message="admin.settings.store_payment.key_change" />
                            </Suspense>
                          </SecretKeyModeButton>
                          <SecretKeyModeButton mode="clear">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-16" />}
                            >
                              <Message message="admin.settings.store_payment.key_clear" />
                            </Suspense>
                          </SecretKeyModeButton>
                        </div>
                        <ActionFormFieldError name="serviceAccountKey" />
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.store_payment.google_play.service_account_key_description" />
                          </Suspense>
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </SecretKeyWhile>
                  <SecretKeyWhile mode="replace">
                    <Field>
                      <CredentialsEnabledLabel>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-40" />}
                        >
                          <Message message="admin.settings.store_payment.google_play.service_account_key" />
                        </Suspense>
                      </CredentialsEnabledLabel>
                      <FieldContent>
                        <SecretKeyFile />
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.store_payment.google_play.service_account_key_description" />
                          </Suspense>
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                    <Field>
                      <FieldLabel>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-32" />}
                        >
                          <Message message="admin.settings.store_payment.key_text" />
                        </Suspense>
                      </FieldLabel>
                      <FieldContent>
                        <SecretKeyText />
                        <ActionFormFieldError name="serviceAccountKey" />
                        {settings.googlePlay.serviceAccountKeyConfigured ? (
                          <div>
                            <SecretKeyModeButton mode="keep">
                              <Suspense
                                fallback={<SkeletonLine className="h-4 w-24" />}
                              >
                                <Message message="admin.settings.store_payment.key_change_cancel" />
                              </Suspense>
                            </SecretKeyModeButton>
                          </div>
                        ) : null}
                      </FieldContent>
                    </Field>
                  </SecretKeyWhile>
                  <SecretKeyWhile mode="clear">
                    <Field>
                      <FieldLabel>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-40" />}
                        >
                          <Message message="admin.settings.store_payment.google_play.service_account_key" />
                        </Suspense>
                      </FieldLabel>
                      <FieldContent>
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-sm text-foreground">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-48" />}
                            >
                              <Message message="admin.settings.store_payment.key_cleared" />
                            </Suspense>
                          </p>
                          <SecretKeyModeButton mode="keep">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-24" />}
                            >
                              <Message message="admin.settings.store_payment.key_clear_cancel" />
                            </Suspense>
                          </SecretKeyModeButton>
                        </div>
                        <ActionFormFieldError name="serviceAccountKey" />
                      </FieldContent>
                    </Field>
                  </SecretKeyWhile>
                </SecretKey>
                {settings.googlePlay.serviceAccountEmail ? (
                  <ReadOnlyField
                    description={
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.store_payment.google_play.service_account_email_description" />
                      </Suspense>
                    }
                    label={
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <Message message="admin.settings.store_payment.google_play.service_account_email" />
                      </Suspense>
                    }
                    value={settings.googlePlay.serviceAccountEmail}
                  />
                ) : null}
                <ReadOnlyField
                  description={
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.settings.store_payment.google_play.package_name_description" />
                    </Suspense>
                  }
                  label={
                    <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                      <Message message="admin.settings.store_payment.google_play.package_name" />
                    </Suspense>
                  }
                  value={settings.googlePlay.packageName}
                />
              </fieldset>
            </CredentialsEnabled>
          </ActionFormFieldset>
        )}

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
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <ActionFormIdle>
                <Message message="admin.settings.store_payment.submit" />
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
