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

import type { PlatformDefaultLocaleActionState } from "../../_lib/actions";

export interface PlatformDefaultLocaleFormOption {
  label: string;
  locale: Locale;
}

interface PlatformDefaultLocaleFormProps {
  action: (
    prevState: PlatformDefaultLocaleActionState,
    formData: FormData
  ) => Promise<PlatformDefaultLocaleActionState>;
  initialDefaultLocale: Locale;
  loadErrorMessage?: string;
  options: readonly PlatformDefaultLocaleFormOption[];
}

export const PlatformDefaultLocaleForm = ({
  action,
  initialDefaultLocale,
  loadErrorMessage,
  options,
}: PlatformDefaultLocaleFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);
  const [defaultLocale, setDefaultLocale] = useState(initialDefaultLocale);

  // A failed read hands the form `DEFAULT_LOCALE` as a stand-in, not the
  // stored value, so saving from that state would overwrite the real default
  // with the fallback. Editing stays closed until the read succeeds.
  const hasLoadError = Boolean(loadErrorMessage);

  const items = options.map((option) => ({
    label: option.label,
    value: option.locale,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>既定言語</CardTitle>
        <CardDescription>
          新規に作成するテナントの初期言語であり、表示言語を選んでいないときにこのプラットフォーム管理画面を表示する言語にもなります。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:max-w-lg">
          <input name="default_locale" type="hidden" value={defaultLocale} />

          <Field>
            <FieldLabel htmlFor="default_locale">既定言語</FieldLabel>
            <FieldContent>
              <Select
                disabled={hasLoadError}
                id="default_locale"
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
                日本語または英語を選べます。変更しても作成済みテナントの既定言語は変わりません。各テナントの既定言語はテナント管理画面から変更します。
                上の「表示言語」で言語を選んでいる場合、この画面の表示はそちらが優先されます。
              </FieldDescription>
            </FieldContent>
          </Field>

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
            <Button disabled={hasLoadError || isPending} type="submit">
              {isPending ? "保存中..." : "既定言語を保存"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
