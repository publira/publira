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
import { storeStatus } from "#lib/store-payment-settings-shared";
import type { StoreStatus } from "#lib/store-payment-settings-shared";
import type { TenantSignInSettings } from "#lib/tenant-sign-in-settings";

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
import { updateTenantSignInSettingsAction } from "../_lib/actions";

const statusTone: Record<StoreStatus, BadgeTone> = {
  disabled: "muted",
  incomplete: "warning",
  ready: "success",
  unset: "muted",
};

const ProviderStatusLabel = ({ status }: { status: StoreStatus }) => {
  switch (status) {
    case "disabled": {
      return <Message message="admin.settings.sign_in.status.disabled" />;
    }
    case "incomplete": {
      return <Message message="admin.settings.sign_in.status.incomplete" />;
    }
    case "ready": {
      return <Message message="admin.settings.sign_in.status.ready" />;
    }
    default: {
      return <Message message="admin.settings.sign_in.status.unset" />;
    }
  }
};

const ProviderStatusDescription = ({ status }: { status: StoreStatus }) => {
  switch (status) {
    case "disabled": {
      return (
        <Message message="admin.settings.sign_in.status.disabled_description" />
      );
    }
    case "incomplete": {
      return (
        <Message message="admin.settings.sign_in.status.incomplete_description" />
      );
    }
    case "ready": {
      return (
        <Message message="admin.settings.sign_in.status.ready_description" />
      );
    }
    default: {
      return (
        <Message message="admin.settings.sign_in.status.unset_description" />
      );
    }
  }
};

const ProviderStatusLine = ({ status }: { status: StoreStatus }) => (
  <div className="flex flex-wrap items-center gap-3">
    <StatusChip status={statusTone[status]}>
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <ProviderStatusLabel status={status} />
      </Suspense>
    </StatusChip>
    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
        <ProviderStatusDescription status={status} />
      </Suspense>
    </p>
  </div>
);

interface TenantSignInSettingsFormProps {
  canEdit: boolean;
  /** The saved settings, absent when the read failed. */
  initialSettings?: TenantSignInSettings;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantSignInSettingsForm = ({
  canEdit,
  initialSettings: settings,
  loadErrorMessage,
  tenantId,
}: TenantSignInSettingsFormProps) => {
  // A failed read leaves nothing to seed the fields with, and a save from that
  // state would write over what is stored.
  const fieldsDisabled = !canEdit || settings === undefined;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.sign_in.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.sign_in.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantSignInSettingsAction}
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
            <CredentialsEnabled initialEnabled={settings.apple.enabled}>
              <fieldset className="grid gap-5">
                <legend className="mb-3 text-base font-semibold text-foreground">
                  <Suspense fallback={<SkeletonLine className="h-5 w-16" />}>
                    <Message message="admin.settings.sign_in.apple.title" />
                  </Suspense>
                </legend>
                <ProviderStatusLine
                  status={storeStatus({
                    enabled: settings.apple.enabled,
                    keyConfigured: settings.apple.privateKeyConfigured,
                    ready: settings.apple.ready,
                  })}
                />
                <CredentialsEnabledCheckbox name="apple_enabled">
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.settings.sign_in.apple.enabled" />
                  </Suspense>
                </CredentialsEnabledCheckbox>
                <Field>
                  <FieldLabel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                      <Message message="admin.settings.sign_in.apple.services_id" />
                    </Suspense>
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      autoCapitalize="off"
                      autoComplete="off"
                      defaultValue={settings.apple.servicesId}
                      name="apple_services_id"
                      placeholder="com.example.web"
                      spellCheck={false}
                      type="text"
                    />
                    <ActionFormFieldError name="servicesId" />
                    <FieldDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.sign_in.apple.services_id_description" />
                      </Suspense>
                    </FieldDescription>
                  </FieldContent>
                </Field>
                <Field>
                  <CredentialsEnabledLabel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      <Message message="admin.settings.sign_in.apple.team_id" />
                    </Suspense>
                  </CredentialsEnabledLabel>
                  <FieldContent>
                    <Input
                      autoCapitalize="characters"
                      autoComplete="off"
                      defaultValue={settings.apple.teamId}
                      maxLength={10}
                      name="apple_team_id"
                      placeholder="ABCDE12345"
                      spellCheck={false}
                      type="text"
                    />
                    <ActionFormFieldError name="teamId" />
                    <FieldDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.sign_in.apple.team_id_description" />
                      </Suspense>
                    </FieldDescription>
                  </FieldContent>
                </Field>
                <Field>
                  <CredentialsEnabledLabel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                      <Message message="admin.settings.sign_in.apple.key_id" />
                    </Suspense>
                  </CredentialsEnabledLabel>
                  <FieldContent>
                    <Input
                      autoCapitalize="characters"
                      autoComplete="off"
                      defaultValue={settings.apple.keyId}
                      maxLength={10}
                      name="apple_key_id"
                      placeholder="2X9R4HXF34"
                      spellCheck={false}
                      type="text"
                    />
                    <ActionFormFieldError name="keyId" />
                    <FieldDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.sign_in.apple.key_id_description" />
                      </Suspense>
                    </FieldDescription>
                  </FieldContent>
                </Field>
                <SecretKey
                  accept=".p8"
                  configured={settings.apple.privateKeyConfigured}
                  name="apple_private_key"
                >
                  <SecretKeyWhile mode="keep">
                    <Field>
                      <FieldLabel>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.sign_in.apple.private_key" />
                        </Suspense>
                      </FieldLabel>
                      <FieldContent>
                        <div className="flex flex-wrap items-center gap-3">
                          <Input
                            disabled
                            readOnly
                            type="text"
                            value={settings.apple.privateKeyHint}
                          />
                          <SecretKeyModeButton mode="replace">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-16" />}
                            >
                              <Message message="admin.settings.sign_in.key_change" />
                            </Suspense>
                          </SecretKeyModeButton>
                          <SecretKeyModeButton mode="clear">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-16" />}
                            >
                              <Message message="admin.settings.sign_in.key_clear" />
                            </Suspense>
                          </SecretKeyModeButton>
                        </div>
                        <ActionFormFieldError name="privateKey" />
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.sign_in.apple.private_key_description" />
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
                          <Message message="admin.settings.sign_in.apple.private_key" />
                        </Suspense>
                      </CredentialsEnabledLabel>
                      <FieldContent>
                        <SecretKeyFile />
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.sign_in.apple.private_key_description" />
                          </Suspense>
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                    <Field>
                      <FieldLabel>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-32" />}
                        >
                          <Message message="admin.settings.sign_in.key_text" />
                        </Suspense>
                      </FieldLabel>
                      <FieldContent>
                        <SecretKeyText />
                        <ActionFormFieldError name="privateKey" />
                        {settings.apple.privateKeyConfigured ? (
                          <div>
                            <SecretKeyModeButton mode="keep">
                              <Suspense
                                fallback={<SkeletonLine className="h-4 w-24" />}
                              >
                                <Message message="admin.settings.sign_in.key_change_cancel" />
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
                          <Message message="admin.settings.sign_in.apple.private_key" />
                        </Suspense>
                      </FieldLabel>
                      <FieldContent>
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-sm text-foreground">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-48" />}
                            >
                              <Message message="admin.settings.sign_in.key_cleared" />
                            </Suspense>
                          </p>
                          <SecretKeyModeButton mode="keep">
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-24" />}
                            >
                              <Message message="admin.settings.sign_in.key_clear_cancel" />
                            </Suspense>
                          </SecretKeyModeButton>
                        </div>
                        <ActionFormFieldError name="privateKey" />
                      </FieldContent>
                    </Field>
                  </SecretKeyWhile>
                </SecretKey>
                <Field>
                  <FieldLabel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                      <Message message="admin.settings.sign_in.apple.bundle_identifier" />
                    </Suspense>
                  </FieldLabel>
                  <FieldContent>
                    {settings.apple.bundleIdentifier ? (
                      <Input
                        disabled
                        readOnly
                        type="text"
                        value={settings.apple.bundleIdentifier}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-48" />}
                        >
                          <Message message="admin.settings.sign_in.not_set" />
                        </Suspense>
                      </p>
                    )}
                    <FieldDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.sign_in.apple.bundle_identifier_description" />
                      </Suspense>
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </fieldset>
            </CredentialsEnabled>

            <CredentialsEnabled initialEnabled={settings.google.enabled}>
              <fieldset className="grid gap-5">
                <legend className="mb-3 text-base font-semibold text-foreground">
                  <Suspense fallback={<SkeletonLine className="h-5 w-16" />}>
                    <Message message="admin.settings.sign_in.google.title" />
                  </Suspense>
                </legend>
                <ProviderStatusLine
                  status={storeStatus({
                    enabled: settings.google.enabled,
                    keyConfigured: Boolean(
                      settings.google.webClientId || settings.google.iosClientId
                    ),
                    ready: settings.google.ready,
                  })}
                />
                <CredentialsEnabledCheckbox name="google_enabled">
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.settings.sign_in.google.enabled" />
                  </Suspense>
                </CredentialsEnabledCheckbox>
                <Field>
                  <FieldLabel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                      <Message message="admin.settings.sign_in.google.web_client_id" />
                    </Suspense>
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      autoCapitalize="off"
                      autoComplete="off"
                      defaultValue={settings.google.webClientId}
                      name="google_web_client_id"
                      placeholder="123456789012-abc123.apps.googleusercontent.com"
                      spellCheck={false}
                      type="text"
                    />
                    <ActionFormFieldError name="webClientId" />
                    <FieldDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.sign_in.google.web_client_id_description" />
                      </Suspense>
                    </FieldDescription>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                      <Message message="admin.settings.sign_in.google.ios_client_id" />
                    </Suspense>
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      autoCapitalize="off"
                      autoComplete="off"
                      defaultValue={settings.google.iosClientId}
                      name="google_ios_client_id"
                      placeholder="123456789012-def456.apps.googleusercontent.com"
                      spellCheck={false}
                      type="text"
                    />
                    <ActionFormFieldError name="iosClientId" />
                    <FieldDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.sign_in.google.ios_client_id_description" />
                      </Suspense>
                    </FieldDescription>
                  </FieldContent>
                </Field>
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
                <Message message="admin.settings.sign_in.submit" />
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
