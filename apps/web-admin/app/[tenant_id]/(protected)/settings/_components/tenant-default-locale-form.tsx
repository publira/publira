"use client";

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
import { Select } from "@publira/ui-components/select";
import { isLocale } from "@publira/utils/i18n";
import type { Locale } from "@publira/utils/i18n";
import { useActionState, useState } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import type { TenantDefaultLocaleActionState } from "../settings-types";

export interface TenantDefaultLocaleFormOption {
  label: string;
  locale: Locale;
}

interface TenantDefaultLocaleFormProps {
  action: (
    prevState: TenantDefaultLocaleActionState,
    formData: FormData
  ) => Promise<TenantDefaultLocaleActionState>;
  canEdit: boolean;
  initialDefaultLocale: Locale;
  loadErrorMessage?: string;
  options: readonly TenantDefaultLocaleFormOption[];
}

export const TenantDefaultLocaleForm = ({
  action,
  canEdit,
  initialDefaultLocale,
  loadErrorMessage,
  options,
}: TenantDefaultLocaleFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [defaultLocale, setDefaultLocale] = useState(initialDefaultLocale);

  // A failed read hands the form `DEFAULT_LOCALE` as a stand-in, not the
  // stored value, so saving from that state would overwrite the real default
  // with the fallback. Editing stays closed until the read succeeds.
  const hasLoadError = Boolean(loadErrorMessage);
  const fieldsDisabled = !canEdit || hasLoadError;

  const items = options.map((option) => ({
    label: option.label,
    value: option.locale,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>既定言語</CardTitle>
        <CardDescription>
          管理者が表示言語を選んでいないときに、この管理画面で使う言語です。すでに選んだ表示言語は変わりません。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:max-w-lg">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="default_locale" type="hidden" value={defaultLocale} />

          <Field>
            <FieldLabel htmlFor="tenant_default_locale">既定言語</FieldLabel>
            <FieldContent>
              <Select
                disabled={fieldsDisabled}
                id="tenant_default_locale"
                items={items}
                onValueChange={(value) => {
                  if (isLocale(value)) {
                    setDefaultLocale(value);
                  }
                }}
                placeholder="言語を選択してください"
                value={defaultLocale}
              />
              <FieldDescription>
                日本語または英語を選べます。管理者が表示言語を選んでいないときの初期値であり、すでに
                Cookie で選んでいる表示言語は変わりません。
              </FieldDescription>
            </FieldContent>
          </Field>

          {canEdit ? null : (
            <FormMessage variant="destructive">
              この設定はテナント管理者のみ編集できます。現在は閲覧専用です。
            </FormMessage>
          )}

          {loadErrorMessage ? (
            <FormMessage variant="destructive">
              {loadErrorMessage}
              保存すると現在の設定を上書きしてしまうため、再読み込みしてから変更してください。
            </FormMessage>
          ) : null}

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={fieldsDisabled || isPending} type="submit">
              {isPending ? "保存中..." : "既定言語を保存"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
