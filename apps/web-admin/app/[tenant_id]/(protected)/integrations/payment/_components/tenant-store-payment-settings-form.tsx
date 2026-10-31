import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import * as CredentialsEnabled from "#components/credentials-enabled";
import { Message } from "#components/message";
import * as SecretKey from "#components/secret-key";
import { storeStatus } from "#lib/store-payment-settings-shared";
import type {
  StoreStatus,
  TenantStorePaymentSettings,
} from "#lib/store-payment-settings-shared";

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

/**
 * A value this form shows but does not edit, such as the app a store sells in,
 * or a note that it is not set. The caller places it in a `Field` and writes
 * the label and the description there.
 */
const ReadOnlyValue = ({ value }: { value: string }) =>
  value ? (
    <Input disabled readOnly type="text" value={value} />
  ) : (
    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
        <Message message="admin.settings.store_payment.app_identity_unset" />
      </Suspense>
    </p>
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
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.store_payment.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.store_payment.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateTenantStorePaymentSettingsAction}
        className="grid gap-8 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        {settings === undefined ? null : (
          // A save refreshes the settings; keying on them remounts the fields
          // on what the API stored instead of changing a mounted default.
          <ActionForm.Fieldset
            className="grid gap-8"
            disabled={fieldsDisabled}
            key={JSON.stringify(settings)}
          >
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="admin.settings.store_payment.route" />
                </Suspense>
              </Field.Label>
              <Field.Content>
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
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.store_payment.route_description" />
                  </Suspense>
                </Field.Description>
                <ActionForm.FieldError name="appPurchaseRoute" />
              </Field.Content>
            </Field.Root>

            <CredentialsEnabled.Root initialEnabled={settings.appStore.enabled}>
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
                <CredentialsEnabled.Checkbox name="app_store_enabled">
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.settings.store_payment.app_store.enabled" />
                  </Suspense>
                </CredentialsEnabled.Checkbox>
                <Field.Root>
                  <CredentialsEnabled.Label>
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      <Message message="admin.settings.store_payment.app_store.issuer_id" />
                    </Suspense>
                  </CredentialsEnabled.Label>
                  <Field.Content>
                    <Input
                      autoComplete="off"
                      defaultValue={settings.appStore.issuerId}
                      name="issuer_id"
                      placeholder="57246542-96fe-1a63-e053-0824d011072a"
                      spellCheck={false}
                      type="text"
                    />
                    <ActionForm.FieldError name="issuerId" />
                    <Field.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.store_payment.app_store.issuer_id_description" />
                      </Suspense>
                    </Field.Description>
                  </Field.Content>
                </Field.Root>
                <Field.Root>
                  <CredentialsEnabled.Label>
                    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                      <Message message="admin.settings.store_payment.app_store.key_id" />
                    </Suspense>
                  </CredentialsEnabled.Label>
                  <Field.Content>
                    <Input
                      autoComplete="off"
                      defaultValue={settings.appStore.keyId}
                      name="key_id"
                      placeholder="2X9R4HXF34"
                      spellCheck={false}
                      type="text"
                    />
                    <ActionForm.FieldError name="keyId" />
                  </Field.Content>
                </Field.Root>
                <SecretKey.Root
                  accept=".p8"
                  configured={settings.appStore.privateKeyConfigured}
                  name="private_key"
                >
                  <SecretKey.While mode="keep">
                    <Field.Root>
                      <Field.Label>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.store_payment.app_store.private_key" />
                        </Suspense>
                      </Field.Label>
                      <Field.Content>
                        <div className="flex flex-wrap items-center gap-3">
                          <Input
                            disabled
                            readOnly
                            type="text"
                            value={settings.appStore.privateKeyHint}
                          />
                          <SecretKey.ModeButton mode="replace">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-16" />}
                            >
                              <Message message="admin.settings.store_payment.key_change" />
                            </Suspense>
                          </SecretKey.ModeButton>
                          <SecretKey.ModeButton mode="clear">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-16" />}
                            >
                              <Message message="admin.settings.store_payment.key_clear" />
                            </Suspense>
                          </SecretKey.ModeButton>
                        </div>
                        <ActionForm.FieldError name="privateKey" />
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.store_payment.app_store.private_key_description" />
                          </Suspense>
                        </Field.Description>
                      </Field.Content>
                    </Field.Root>
                  </SecretKey.While>
                  <SecretKey.While mode="replace">
                    <Field.Root>
                      <CredentialsEnabled.Label>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.store_payment.app_store.private_key" />
                        </Suspense>
                      </CredentialsEnabled.Label>
                      <Field.Content>
                        <SecretKey.File />
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.store_payment.app_store.private_key_description" />
                          </Suspense>
                        </Field.Description>
                      </Field.Content>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-32" />}
                        >
                          <Message message="admin.settings.store_payment.key_text" />
                        </Suspense>
                      </Field.Label>
                      <Field.Content>
                        <SecretKey.Text />
                        <ActionForm.FieldError name="privateKey" />
                        {settings.appStore.privateKeyConfigured ? (
                          <div>
                            <SecretKey.ModeButton mode="keep">
                              <Suspense
                                fallback={<SkeletonLine className="h-4 w-24" />}
                              >
                                <Message message="admin.settings.store_payment.key_change_cancel" />
                              </Suspense>
                            </SecretKey.ModeButton>
                          </div>
                        ) : null}
                      </Field.Content>
                    </Field.Root>
                  </SecretKey.While>
                  <SecretKey.While mode="clear">
                    <Field.Root>
                      <Field.Label>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.store_payment.app_store.private_key" />
                        </Suspense>
                      </Field.Label>
                      <Field.Content>
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-sm text-foreground">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-48" />}
                            >
                              <Message message="admin.settings.store_payment.key_cleared" />
                            </Suspense>
                          </p>
                          <SecretKey.ModeButton mode="keep">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-24" />}
                            >
                              <Message message="admin.settings.store_payment.key_clear_cancel" />
                            </Suspense>
                          </SecretKey.ModeButton>
                        </div>
                        <ActionForm.FieldError name="privateKey" />
                      </Field.Content>
                    </Field.Root>
                  </SecretKey.While>
                </SecretKey.Root>
                <Field.Root>
                  <Field.Label>
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      <Message message="admin.settings.store_payment.app_store.bundle_identifier" />
                    </Suspense>
                  </Field.Label>
                  <Field.Content>
                    <ReadOnlyValue value={settings.appStore.bundleIdentifier} />
                    <Field.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.store_payment.app_store.bundle_identifier_description" />
                      </Suspense>
                    </Field.Description>
                  </Field.Content>
                </Field.Root>
                {notificationUrl ? (
                  <Field.Root>
                    <Field.Label>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-56" />}
                      >
                        <Message message="admin.settings.store_payment.app_store.notification_url" />
                      </Suspense>
                    </Field.Label>
                    <Field.Content>
                      <ReadOnlyValue value={notificationUrl} />
                      <Field.Description>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.store_payment.app_store.notification_url_description" />
                        </Suspense>
                      </Field.Description>
                    </Field.Content>
                  </Field.Root>
                ) : null}
              </fieldset>
            </CredentialsEnabled.Root>

            <CredentialsEnabled.Root
              initialEnabled={settings.googlePlay.enabled}
            >
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
                <CredentialsEnabled.Checkbox name="google_play_enabled">
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.settings.store_payment.google_play.enabled" />
                  </Suspense>
                </CredentialsEnabled.Checkbox>
                <SecretKey.Root
                  accept=".json,application/json"
                  configured={settings.googlePlay.serviceAccountKeyConfigured}
                  name="service_account_key"
                >
                  <SecretKey.While mode="keep">
                    <Field.Root>
                      <Field.Label>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-40" />}
                        >
                          <Message message="admin.settings.store_payment.google_play.service_account_key" />
                        </Suspense>
                      </Field.Label>
                      <Field.Content>
                        <div className="flex flex-wrap items-center gap-3">
                          <Input
                            disabled
                            readOnly
                            type="text"
                            value={settings.googlePlay.serviceAccountKeyHint}
                          />
                          <SecretKey.ModeButton mode="replace">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-16" />}
                            >
                              <Message message="admin.settings.store_payment.key_change" />
                            </Suspense>
                          </SecretKey.ModeButton>
                          <SecretKey.ModeButton mode="clear">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-16" />}
                            >
                              <Message message="admin.settings.store_payment.key_clear" />
                            </Suspense>
                          </SecretKey.ModeButton>
                        </div>
                        <ActionForm.FieldError name="serviceAccountKey" />
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.store_payment.google_play.service_account_key_description" />
                          </Suspense>
                        </Field.Description>
                      </Field.Content>
                    </Field.Root>
                  </SecretKey.While>
                  <SecretKey.While mode="replace">
                    <Field.Root>
                      <CredentialsEnabled.Label>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-40" />}
                        >
                          <Message message="admin.settings.store_payment.google_play.service_account_key" />
                        </Suspense>
                      </CredentialsEnabled.Label>
                      <Field.Content>
                        <SecretKey.File />
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.store_payment.google_play.service_account_key_description" />
                          </Suspense>
                        </Field.Description>
                      </Field.Content>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-32" />}
                        >
                          <Message message="admin.settings.store_payment.key_text" />
                        </Suspense>
                      </Field.Label>
                      <Field.Content>
                        <SecretKey.Text />
                        <ActionForm.FieldError name="serviceAccountKey" />
                        {settings.googlePlay.serviceAccountKeyConfigured ? (
                          <div>
                            <SecretKey.ModeButton mode="keep">
                              <Suspense
                                fallback={<SkeletonLine className="h-4 w-24" />}
                              >
                                <Message message="admin.settings.store_payment.key_change_cancel" />
                              </Suspense>
                            </SecretKey.ModeButton>
                          </div>
                        ) : null}
                      </Field.Content>
                    </Field.Root>
                  </SecretKey.While>
                  <SecretKey.While mode="clear">
                    <Field.Root>
                      <Field.Label>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-40" />}
                        >
                          <Message message="admin.settings.store_payment.google_play.service_account_key" />
                        </Suspense>
                      </Field.Label>
                      <Field.Content>
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-sm text-foreground">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-48" />}
                            >
                              <Message message="admin.settings.store_payment.key_cleared" />
                            </Suspense>
                          </p>
                          <SecretKey.ModeButton mode="keep">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-24" />}
                            >
                              <Message message="admin.settings.store_payment.key_clear_cancel" />
                            </Suspense>
                          </SecretKey.ModeButton>
                        </div>
                        <ActionForm.FieldError name="serviceAccountKey" />
                      </Field.Content>
                    </Field.Root>
                  </SecretKey.While>
                </SecretKey.Root>
                {settings.googlePlay.serviceAccountEmail ? (
                  <Field.Root>
                    <Field.Label>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <Message message="admin.settings.store_payment.google_play.service_account_email" />
                      </Suspense>
                    </Field.Label>
                    <Field.Content>
                      <ReadOnlyValue
                        value={settings.googlePlay.serviceAccountEmail}
                      />
                      <Field.Description>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.store_payment.google_play.service_account_email_description" />
                        </Suspense>
                      </Field.Description>
                    </Field.Content>
                  </Field.Root>
                ) : null}
                <Field.Root>
                  <Field.Label>
                    <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                      <Message message="admin.settings.store_payment.google_play.package_name" />
                    </Suspense>
                  </Field.Label>
                  <Field.Content>
                    <ReadOnlyValue value={settings.googlePlay.packageName} />
                    <Field.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.store_payment.google_play.package_name_description" />
                      </Suspense>
                    </Field.Description>
                  </Field.Content>
                </Field.Root>
              </fieldset>
            </CredentialsEnabled.Root>
          </ActionForm.Fieldset>
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
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.store_payment.submit" />
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
