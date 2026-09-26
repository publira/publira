"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { Textarea } from "@publira/ui-components/textarea";
import type { ChangeEvent, ReactNode } from "react";
import { useActionState, useCallback, useId, useState } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage } from "#components/client-message";
import type { StorePaymentSettingsFieldErrors } from "#lib/store-payment-settings";
import {
  isAppPurchaseRouteValue,
  storeStatus,
} from "#lib/store-payment-settings-shared";
import type {
  StoreStatus,
  TenantStorePaymentSettings,
} from "#lib/store-payment-settings-shared";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantStorePaymentSettingsFormState } from "../payment-types";

const statusTone: Record<StoreStatus, BadgeTone> = {
  disabled: "muted",
  incomplete: "warning",
  ready: "success",
  unset: "muted",
};

const StoreStatusLabel = ({ status }: { status: StoreStatus }) => {
  switch (status) {
    case "disabled": {
      return (
        <ClientMessage message="admin.settings.store_payment.status.disabled" />
      );
    }
    case "incomplete": {
      return (
        <ClientMessage message="admin.settings.store_payment.status.incomplete" />
      );
    }
    case "ready": {
      return (
        <ClientMessage message="admin.settings.store_payment.status.ready" />
      );
    }
    default: {
      return (
        <ClientMessage message="admin.settings.store_payment.status.unset" />
      );
    }
  }
};

const StoreStatusDescription = ({ status }: { status: StoreStatus }) => {
  switch (status) {
    case "disabled": {
      return (
        <ClientMessage message="admin.settings.store_payment.status.disabled_description" />
      );
    }
    case "incomplete": {
      return (
        <ClientMessage message="admin.settings.store_payment.status.incomplete_description" />
      );
    }
    case "ready": {
      return (
        <ClientMessage message="admin.settings.store_payment.status.ready_description" />
      );
    }
    default: {
      return (
        <ClientMessage message="admin.settings.store_payment.status.unset_description" />
      );
    }
  }
};

const StoreStatusLine = ({ status }: { status: StoreStatus }) => (
  <div className="flex flex-wrap items-center gap-3">
    <StatusChip status={statusTone[status]}>
      <StoreStatusLabel status={status} />
    </StatusChip>
    <p className="text-sm text-muted-foreground">
      <StoreStatusDescription status={status} />
    </p>
  </div>
);

type StoreKeyMode = "clear" | "keep" | "replace";

interface StoreKeyFieldProps {
  accept: string;
  configured: boolean;
  description: ReactNode;
  disabled: boolean;
  error?: string;
  hint: string;
  label: ReactNode;
  name: string;
  required: boolean;
}

/**
 * A stored key shows as its hint and can be replaced or removed; a key being
 * entered is a file or pasted text. The mode travels with the form so the
 * Action can tell "left as it is" from "removed". The file and the text are
 * separate Fields because a Field hands its one id and name to every control
 * inside it.
 */
const StoreKeyField = ({
  accept,
  configured,
  description,
  disabled,
  error,
  hint,
  label,
  name,
  required,
}: StoreKeyFieldProps) => {
  const controlId = useId();
  const textId = useId();
  const [mode, setMode] = useState<StoreKeyMode>(
    configured ? "keep" : "replace"
  );

  const handleReplace = useCallback(() => setMode("replace"), []);
  const handleClear = useCallback(() => setMode("clear"), []);
  const handleKeep = useCallback(() => setMode("keep"), []);

  const errorMessage = error ? (
    <FormMessage variant="destructive">{error}</FormMessage>
  ) : null;

  return (
    <>
      <input name={`${name}_mode`} type="hidden" value={mode} />
      <input
        name={`${name}_configured`}
        type="hidden"
        value={configured ? "1" : "0"}
      />
      {mode === "keep" ? (
        <Field>
          <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
          <FieldContent>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                disabled
                id={controlId}
                readOnly
                type="text"
                value={hint}
              />
              <Button
                disabled={disabled}
                onClick={handleReplace}
                type="button"
                variant="outline"
              >
                <ClientMessage message="admin.settings.store_payment.key_change" />
              </Button>
              <Button
                disabled={disabled}
                onClick={handleClear}
                type="button"
                variant="outline"
              >
                <ClientMessage message="admin.settings.store_payment.key_clear" />
              </Button>
            </div>
            {errorMessage}
            <FieldDescription>{description}</FieldDescription>
          </FieldContent>
        </Field>
      ) : null}
      {mode === "replace" ? (
        <>
          <Field>
            <FieldLabel htmlFor={controlId} required={required}>
              {label}
            </FieldLabel>
            <FieldContent>
              <Input
                accept={accept}
                disabled={disabled}
                id={controlId}
                name={`${name}_file`}
                type="file"
              />
              <FieldDescription>{description}</FieldDescription>
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel htmlFor={textId}>
              <ClientMessage message="admin.settings.store_payment.key_text" />
            </FieldLabel>
            <FieldContent>
              <Textarea
                autoComplete="off"
                className="text-xs"
                disabled={disabled}
                id={textId}
                name={name}
                rows={4}
                spellCheck={false}
              />
              {errorMessage}
              {configured ? (
                <div>
                  <Button
                    disabled={disabled}
                    onClick={handleKeep}
                    type="button"
                    variant="outline"
                  >
                    <ClientMessage message="admin.settings.store_payment.key_change_cancel" />
                  </Button>
                </div>
              ) : null}
            </FieldContent>
          </Field>
        </>
      ) : null}
      {mode === "clear" ? (
        <Field>
          <FieldLabel>{label}</FieldLabel>
          <FieldContent>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-foreground">
                <ClientMessage message="admin.settings.store_payment.key_cleared" />
              </p>
              <Button
                disabled={disabled}
                onClick={handleKeep}
                type="button"
                variant="outline"
              >
                <ClientMessage message="admin.settings.store_payment.key_clear_cancel" />
              </Button>
            </div>
            {errorMessage}
          </FieldContent>
        </Field>
      ) : null}
    </>
  );
};

/** A value this form shows but does not edit, such as the app a store sells in. */
const ReadOnlyField = ({
  description,
  label,
  value,
}: {
  description: ReactNode;
  label: ReactNode;
  value: string;
}) => {
  const id = useId();

  return (
    <Field>
      <FieldLabel htmlFor={value ? id : undefined}>{label}</FieldLabel>
      <FieldContent>
        {value ? (
          <Input disabled id={id} readOnly type="text" value={value} />
        ) : (
          <p className="text-sm text-muted-foreground">
            <ClientMessage message="admin.settings.store_payment.app_identity_unset" />
          </p>
        )}
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
    </Field>
  );
};

interface StorePaymentSettingsFieldsProps {
  disabled: boolean;
  fieldErrors?: StorePaymentSettingsFieldErrors;
  notificationUrl?: string;
  settings: TenantStorePaymentSettings;
}

/**
 * Seeded once per mount: the form keys these by the saved settings. The
 * switches, IDs, and route are held in state because React resets an
 * uncontrolled field once the Action settles, which would wipe what a refused
 * save is asking to fix.
 */
const StorePaymentSettingsFields = ({
  disabled,
  fieldErrors,
  notificationUrl,
  settings,
}: StorePaymentSettingsFieldsProps) => {
  const routeId = useId();
  const appStoreEnabledId = useId();
  const issuerIdId = useId();
  const keyIdId = useId();
  const googlePlayEnabledId = useId();
  const [route, setRoute] = useState(() => settings.appPurchaseRoute);
  const [appStoreEnabled, setAppStoreEnabled] = useState(
    () => settings.appStore.enabled
  );
  const [issuerId, setIssuerId] = useState(() => settings.appStore.issuerId);
  const [keyId, setKeyId] = useState(() => settings.appStore.keyId);
  const [googlePlayEnabled, setGooglePlayEnabled] = useState(
    () => settings.googlePlay.enabled
  );

  // The store route needs a store that is ready as saved; one being set up in
  // this same save becomes selectable once it is.
  const storeRouteAvailable =
    settings.appStore.ready ||
    settings.googlePlay.ready ||
    settings.appPurchaseRoute === "store";

  const handleRouteChange = useCallback((next: string) => {
    if (isAppPurchaseRouteValue(next)) {
      setRoute(next);
    }
  }, []);
  const handleAppStoreEnabledChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setAppStoreEnabled(event.target.checked);
    },
    []
  );
  const handleIssuerIdChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setIssuerId(event.target.value);
    },
    []
  );
  const handleKeyIdChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setKeyId(event.target.value);
    },
    []
  );
  const handleGooglePlayEnabledChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setGooglePlayEnabled(event.target.checked);
    },
    []
  );

  return (
    <>
      <Field>
        <FieldLabel htmlFor={routeId}>
          <ClientMessage message="admin.settings.store_payment.route" />
        </FieldLabel>
        <FieldContent>
          <RadioGroup
            disabled={disabled}
            id={routeId}
            items={[
              {
                description: (
                  <ClientMessage message="admin.settings.store_payment.routes.external_checkout_description" />
                ),
                label: (
                  <ClientMessage message="admin.settings.store_payment.routes.external_checkout" />
                ),
                value: "external_checkout",
              },
              {
                description: (
                  <>
                    <ClientMessage message="admin.settings.store_payment.routes.store_description" />
                    {storeRouteAvailable ? null : (
                      <>
                        {" "}
                        <ClientMessage message="admin.settings.store_payment.routes.store_unavailable" />
                      </>
                    )}
                  </>
                ),
                disabled: !storeRouteAvailable,
                label: (
                  <ClientMessage message="admin.settings.store_payment.routes.store" />
                ),
                value: "store",
              },
            ]}
            onValueChange={handleRouteChange}
            value={route}
          />
          <input name="app_purchase_route" type="hidden" value={route} />
          <FieldDescription>
            <ClientMessage message="admin.settings.store_payment.route_description" />
          </FieldDescription>
          {fieldErrors?.appPurchaseRoute ? (
            <FormMessage variant="destructive">
              {fieldErrors.appPurchaseRoute}
            </FormMessage>
          ) : null}
        </FieldContent>
      </Field>

      <fieldset className="grid gap-5">
        <legend className="mb-3 text-base font-semibold text-foreground">
          <ClientMessage message="admin.settings.store_payment.app_store.title" />
        </legend>
        <StoreStatusLine
          status={storeStatus({
            enabled: settings.appStore.enabled,
            keyConfigured: settings.appStore.privateKeyConfigured,
            ready: settings.appStore.ready,
          })}
        />
        <label
          className="inline-flex items-center gap-2 text-sm text-foreground"
          htmlFor={appStoreEnabledId}
        >
          <input
            checked={appStoreEnabled}
            disabled={disabled}
            id={appStoreEnabledId}
            name="app_store_enabled"
            onChange={handleAppStoreEnabledChange}
            type="checkbox"
          />
          <ClientMessage message="admin.settings.store_payment.app_store.enabled" />
        </label>
        <Field>
          <FieldLabel htmlFor={issuerIdId} required={appStoreEnabled}>
            <ClientMessage message="admin.settings.store_payment.app_store.issuer_id" />
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="off"
              disabled={disabled}
              id={issuerIdId}
              name="issuer_id"
              onChange={handleIssuerIdChange}
              placeholder="57246542-96fe-1a63-e053-0824d011072a"
              spellCheck={false}
              type="text"
              value={issuerId}
            />
            {fieldErrors?.issuerId ? (
              <FormMessage variant="destructive">
                {fieldErrors.issuerId}
              </FormMessage>
            ) : null}
            <FieldDescription>
              <ClientMessage message="admin.settings.store_payment.app_store.issuer_id_description" />
            </FieldDescription>
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel htmlFor={keyIdId} required={appStoreEnabled}>
            <ClientMessage message="admin.settings.store_payment.app_store.key_id" />
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="off"
              disabled={disabled}
              id={keyIdId}
              name="key_id"
              onChange={handleKeyIdChange}
              placeholder="2X9R4HXF34"
              spellCheck={false}
              type="text"
              value={keyId}
            />
            {fieldErrors?.keyId ? (
              <FormMessage variant="destructive">
                {fieldErrors.keyId}
              </FormMessage>
            ) : null}
          </FieldContent>
        </Field>
        <StoreKeyField
          accept=".p8"
          configured={settings.appStore.privateKeyConfigured}
          description={
            <ClientMessage message="admin.settings.store_payment.app_store.private_key_description" />
          }
          disabled={disabled}
          error={fieldErrors?.privateKey}
          hint={settings.appStore.privateKeyHint}
          label={
            <ClientMessage message="admin.settings.store_payment.app_store.private_key" />
          }
          name="private_key"
          required={appStoreEnabled}
        />
        <ReadOnlyField
          description={
            <ClientMessage message="admin.settings.store_payment.app_store.bundle_identifier_description" />
          }
          label={
            <ClientMessage message="admin.settings.store_payment.app_store.bundle_identifier" />
          }
          value={settings.appStore.bundleIdentifier}
        />
        {notificationUrl ? (
          <ReadOnlyField
            description={
              <ClientMessage message="admin.settings.store_payment.app_store.notification_url_description" />
            }
            label={
              <ClientMessage message="admin.settings.store_payment.app_store.notification_url" />
            }
            value={notificationUrl}
          />
        ) : null}
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="mb-3 text-base font-semibold text-foreground">
          <ClientMessage message="admin.settings.store_payment.google_play.title" />
        </legend>
        <StoreStatusLine
          status={storeStatus({
            enabled: settings.googlePlay.enabled,
            keyConfigured: settings.googlePlay.serviceAccountKeyConfigured,
            ready: settings.googlePlay.ready,
          })}
        />
        <label
          className="inline-flex items-center gap-2 text-sm text-foreground"
          htmlFor={googlePlayEnabledId}
        >
          <input
            checked={googlePlayEnabled}
            disabled={disabled}
            id={googlePlayEnabledId}
            name="google_play_enabled"
            onChange={handleGooglePlayEnabledChange}
            type="checkbox"
          />
          <ClientMessage message="admin.settings.store_payment.google_play.enabled" />
        </label>
        <StoreKeyField
          accept=".json,application/json"
          configured={settings.googlePlay.serviceAccountKeyConfigured}
          description={
            <ClientMessage message="admin.settings.store_payment.google_play.service_account_key_description" />
          }
          disabled={disabled}
          error={fieldErrors?.serviceAccountKey}
          hint={settings.googlePlay.serviceAccountKeyHint}
          label={
            <ClientMessage message="admin.settings.store_payment.google_play.service_account_key" />
          }
          name="service_account_key"
          required={googlePlayEnabled}
        />
        {settings.googlePlay.serviceAccountEmail ? (
          <ReadOnlyField
            description={
              <ClientMessage message="admin.settings.store_payment.google_play.service_account_email_description" />
            }
            label={
              <ClientMessage message="admin.settings.store_payment.google_play.service_account_email" />
            }
            value={settings.googlePlay.serviceAccountEmail}
          />
        ) : null}
        <ReadOnlyField
          description={
            <ClientMessage message="admin.settings.store_payment.google_play.package_name_description" />
          }
          label={
            <ClientMessage message="admin.settings.store_payment.google_play.package_name" />
          }
          value={settings.googlePlay.packageName}
        />
      </fieldset>
    </>
  );
};

interface TenantStorePaymentSettingsFormProps {
  action: (
    prevState: TenantStorePaymentSettingsFormState,
    formData: FormData
  ) => Promise<TenantStorePaymentSettingsFormState>;
  canEdit: boolean;
  /** The saved settings, absent when the read failed. */
  initialSettings?: TenantStorePaymentSettings;
  loadErrorMessage?: string;
  /**
   * Where App Store Server Notifications reach this tenant, absent while the
   * tenant has no domain.
   */
  notificationUrl?: string;
}

export const TenantStorePaymentSettingsForm = ({
  action,
  canEdit,
  initialSettings,
  loadErrorMessage,
  notificationUrl,
}: TenantStorePaymentSettingsFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const settings = state?.ok ? state.settings : initialSettings;

  // A failed read leaves nothing to seed the fields with, and a save from that
  // state would write over what is stored.
  const fieldsDisabled = !canEdit || settings === undefined || isPending;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.settings.store_payment.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.store_payment.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-8 sm:max-w-3xl">
        <input name="tenant_id" type="hidden" value={tenantId} />

        {settings === undefined ? null : (
          <StorePaymentSettingsFields
            disabled={fieldsDisabled}
            fieldErrors={state?.ok ? undefined : state?.fieldErrors}
            key={JSON.stringify(settings)}
            notificationUrl={notificationUrl}
            settings={settings}
          />
        )}

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <ClientMessage message="admin.settings.admin_only" />
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
        ) : null}

        {state ? (
          <FormMessage variant={state.ok ? "success" : "destructive"}>
            {state.message}
          </FormMessage>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button disabled={fieldsDisabled} type="submit">
            <ActionFormIdle>
              <ClientMessage message="admin.settings.store_payment.submit" />
            </ActionFormIdle>
            <ActionFormPending>
              <ClientMessage message="admin.settings.saving" />
            </ActionFormPending>
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
