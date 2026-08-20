"use client";

import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
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
 * The click handler writes `<html lang>` because nothing else can: the
 * attribute is rendered statically (`app/layout.tsx` says why), the inline
 * script that corrects it runs only while a document is being parsed, and the
 * Action's re-render produces the same attribute value as before, so React
 * leaves the DOM alone. A DOM write driven by a user action belongs in the
 * handler — see the Effects rules in the repository AGENTS.md.
 */
export const LocaleForm = ({
  action,
  currentLocale,
  description,
  label,
  options,
}: LocaleFormProps) => {
  const handleSelect = useCallback(
    (locale: Locale) => () => {
      document.documentElement.lang = locale;
    },
    []
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={action}
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
                onClick={handleSelect(option.locale)}
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
