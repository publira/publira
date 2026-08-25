"use client";

import { StatusChip } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { ChangeEvent } from "react";
import { useActionState, useCallback, useId, useState } from "react";

import {
  paymentSettingsStatus,
  paymentSettingsStatusCopy,
} from "#lib/payment-settings-shared";
import type { TenantPaymentSettings } from "#lib/payment-settings-shared";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantPaymentSettingsFormState } from "../settings-types";

const statusTone: Record<
  ReturnType<typeof paymentSettingsStatus>,
  BadgeTone
> = {
  disabled: "muted",
  incomplete: "warning",
  ready: "success",
  unset: "muted",
};

interface TenantPaymentSettingsFormProps {
  action: (
    prevState: TenantPaymentSettingsFormState,
    formData: FormData
  ) => Promise<TenantPaymentSettingsFormState>;
  canEdit: boolean;
  initialSettings: TenantPaymentSettings;
  loadErrorMessage?: string;
  webhookUrl?: string;
}

interface PaymentSecretFieldProps {
  canEdit: boolean;
  configured: boolean;
  error?: string;
  hint: string;
  label: string;
  name: string;
  required: boolean;
}

const PaymentSecretField = ({
  canEdit,
  configured,
  error,
  hint,
  label,
  name,
  required,
}: PaymentSecretFieldProps) => {
  const inputId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const showInput = !configured || isEditing;

  const handleStartEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  return (
    <Field>
      <FieldLabel htmlFor={inputId} required={canEdit && required && showInput}>
        {label}
      </FieldLabel>
      <FieldContent>
        {showInput ? (
          <div className="flex flex-wrap items-center gap-3" key="secret-edit">
            <Input
              autoComplete="off"
              disabled={!canEdit}
              id={inputId}
              name={name}
              required={canEdit && required}
              type="password"
            />
            {configured ? (
              <Button
                disabled={!canEdit}
                onClick={handleCancelEdit}
                type="button"
                variant="outline"
              >
                変更を取り消す
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3" key="secret-hint">
            <Input disabled id={inputId} readOnly type="text" value={hint} />
            <Button
              disabled={!canEdit}
              onClick={handleStartEdit}
              type="button"
              variant="outline"
            >
              変更する
            </Button>
          </div>
        )}
        {error ? (
          <FormMessage variant="destructive">{error}</FormMessage>
        ) : null}
      </FieldContent>
      <FieldDescription>
        入力した値は保存後に表示しません。登録済みの値は先頭と末尾だけがマスキングされます。
      </FieldDescription>
    </Field>
  );
};

interface PaymentSettingsFieldsProps {
  canEdit: boolean;
  isSaving: boolean;
  loadErrorMessage?: string;
  saveFormAction: (formData: FormData) => void;
  saveState: TenantPaymentSettingsFormState;
  settings: TenantPaymentSettings;
  webhookUrl?: string;
}

const PaymentSettingsFields = ({
  canEdit,
  isSaving,
  loadErrorMessage,
  saveFormAction,
  saveState,
  settings,
  webhookUrl,
}: PaymentSettingsFieldsProps) => {
  const tenantId = useTenantId();
  const enabledId = useId();
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const enabled = enabledOverride ?? settings.enabled;
  const status = paymentSettingsStatus(settings);
  const statusCopy = paymentSettingsStatusCopy[status];
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);
  const fieldErrors =
    saveState && !saveState.ok ? saveState.fieldErrors : undefined;
  const secretKeyRequired = enabled && !settings.secretKeyConfigured;
  const webhookSecretRequired = enabled && !settings.webhookSecretConfigured;

  const handleEnabledChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setEnabledOverride(event.target.checked);
    },
    []
  );

  return (
    <form action={saveFormAction} className="grid gap-5 sm:max-w-3xl">
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
            {statusCopy.label}
          </StatusChip>
          <p className="text-sm text-muted-foreground">
            {statusCopy.description}
          </p>
        </div>
      )}

      <Field>
        <FieldLabel>決済プロバイダ</FieldLabel>
        <FieldContent>
          <Input disabled readOnly type="text" value="Stripe" />
          <FieldDescription>
            現在選択できるプロバイダは Stripe のみです。
          </FieldDescription>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor={enabledId}>Stripe 決済を有効にする</FieldLabel>
        <FieldContent>
          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              checked={enabled}
              disabled={fieldsDisabled}
              id={enabledId}
              name="enabled"
              onChange={handleEnabledChange}
              type="checkbox"
            />
            有効化
          </label>
          <FieldDescription>
            OFF の場合、有料エピソードの Checkout と Webhook
            はこのテナントでは動きません。
          </FieldDescription>
        </FieldContent>
      </Field>

      <PaymentSecretField
        canEdit={!fieldsDisabled}
        configured={settings.secretKeyConfigured}
        error={fieldErrors?.secretKey}
        hint={settings.secretKeyHint}
        label="シークレットキー"
        name="secret_key"
        required={secretKeyRequired}
      />

      <PaymentSecretField
        canEdit={!fieldsDisabled}
        configured={settings.webhookSecretConfigured}
        error={fieldErrors?.webhookSecret}
        hint={settings.webhookSecretHint}
        label="Webhook 署名シークレット"
        name="webhook_secret"
        required={webhookSecretRequired}
      />

      {webhookUrl ? (
        <Field>
          <FieldLabel>Webhook URL</FieldLabel>
          <FieldContent>
            <Input disabled readOnly type="text" value={webhookUrl} />
            <FieldDescription>
              Stripe ダッシュボードにこの URL
              を登録してください。署名シークレットは上の欄で保存します。
            </FieldDescription>
          </FieldContent>
        </Field>
      ) : null}

      {canEdit ? null : (
        <FormMessage variant="destructive">
          この設定はテナント管理者のみ編集できます。現在は閲覧専用です。
        </FormMessage>
      )}

      {loadErrorMessage ? (
        <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
      ) : null}

      {saveState ? (
        <FormMessage variant={saveState.ok ? "success" : "destructive"}>
          {saveState.message}
        </FormMessage>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button disabled={fieldsDisabled || isSaving} type="submit">
          {isSaving ? "保存中..." : "保存"}
        </Button>
      </div>
    </form>
  );
};

export const TenantPaymentSettingsForm = ({
  action,
  canEdit,
  initialSettings,
  loadErrorMessage,
  webhookUrl,
}: TenantPaymentSettingsFormProps) => {
  const [saveState, saveFormAction, isSaving] = useActionState(action, null);
  const settings = saveState?.ok ? saveState.settings : initialSettings;

  return (
    <Card>
      <CardHeader>
        <CardTitle>決済設定</CardTitle>
        <CardDescription>
          このテナントの Stripe
          シークレットを登録・更新・無効化します。秘密情報は書き込み専用で、再表示時は状態とマスキングだけが見えます。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PaymentSettingsFields
          canEdit={canEdit}
          isSaving={isSaving}
          key={[
            settings.enabled,
            settings.ready,
            settings.secretKeyConfigured,
            settings.secretKeyHint,
            settings.webhookSecretConfigured,
            settings.webhookSecretHint,
          ].join(":")}
          loadErrorMessage={loadErrorMessage}
          saveFormAction={saveFormAction}
          saveState={saveState}
          settings={settings}
          webhookUrl={webhookUrl}
        />
      </CardContent>
    </Card>
  );
};
