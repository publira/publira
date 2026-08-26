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

export interface PlatformDefaultLocaleFormCopy {
  description: string;
  fieldDescription: string;
  label: string;
  placeholder: string;
  reloadWarning: string;
  saveLabel: string;
  savingLabel: string;
  title: string;
}

interface PlatformDefaultLocaleFormProps {
  action: (
    prevState: PlatformDefaultLocaleActionState,
    formData: FormData
  ) => Promise<PlatformDefaultLocaleActionState>;
  copy: PlatformDefaultLocaleFormCopy;
  initialDefaultLocale: Locale;
  loadErrorMessage?: string;
  options: readonly PlatformDefaultLocaleFormOption[];
}

export const PlatformDefaultLocaleForm = ({
  action,
  copy,
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
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:max-w-lg">
          <input name="default_locale" type="hidden" value={defaultLocale} />

          <Field>
            <FieldLabel htmlFor="default_locale">{copy.label}</FieldLabel>
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
                placeholder={copy.placeholder}
                value={defaultLocale}
              />
              <FieldDescription>{copy.fieldDescription}</FieldDescription>
            </FieldContent>
          </Field>

          {loadErrorMessage ? (
            <FormMessage variant="destructive">
              {loadErrorMessage}
              {copy.reloadWarning}
            </FormMessage>
          ) : null}

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={hasLoadError || isPending} type="submit">
              {isPending ? copy.savingLabel : copy.saveLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
