"use client";

import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { isLocale } from "@publira/utils/i18n";
import type { Locale } from "@publira/utils/i18n";
import { useCallback } from "react";

import { LOCALE_FIELD_NAME } from "#lib/locale-shared";

export interface LocaleFormOption {
  label: string;
  locale: Locale;
}

interface LocaleFormProps {
  action: (formData: FormData) => Promise<void>;
  currentLocale: Locale;
  description: string;
  label: string;
  options: readonly LocaleFormOption[];
}

/**
 * One submit button per locale, so the choice travels as that button's own
 * `name` / `value` and the switch needs no state of its own.
 *
 * `<html lang>` is written here because nothing else can: the attribute is
 * rendered statically (`app/[tenant_id]/layout.tsx` says why), the inline
 * script that corrects it runs only while a document is being parsed, and the
 * Action's re-render produces the same attribute value as before, so React
 * leaves the DOM alone.
 *
 * The write happens **after** the Action resolves. Doing it in the click
 * handler would run before the submit, so a rejected Action would leave the
 * document claiming a language that neither the cookie nor the copy on screen
 * agrees with.
 */
export const LocaleForm = ({
  action,
  currentLocale,
  description,
  label,
  options,
}: LocaleFormProps) => {
  const submit = useCallback(
    async (formData: FormData) => {
      await action(formData);

      const chosen = formData.get(LOCALE_FIELD_NAME);
      if (isLocale(chosen)) {
        document.documentElement.lang = chosen;
      }
    },
    [action]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={submit}
          aria-label={label}
          className="flex flex-wrap gap-2"
        >
          {options.map((option) => {
            const isCurrent = option.locale === currentLocale;

            return (
              <Button
                aria-current={isCurrent ? "true" : undefined}
                key={option.locale}
                name={LOCALE_FIELD_NAME}
                type="submit"
                value={option.locale}
                variant={isCurrent ? "default" : "outline"}
              >
                {option.label}
              </Button>
            );
          })}
        </form>
      </CardContent>
    </Card>
  );
};
