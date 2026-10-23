"use client";

import { getLocaleLabel, getLocales, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";
import { useId, useState } from "react";

import { useClientMessages } from "#components/client-message";

/**
 * The new tenant's default language and the languages its site offers, chosen
 * together because the default is always one of them: its box is ticked and
 * cannot be cleared, and choosing a new default ticks the new one's. The set
 * starts as the default alone, which is what the API stores for a request that
 * names none.
 *
 * Every offered language goes out as a `tenant_supported_locales` entry, the
 * default included. A disabled checkbox submits nothing, so the default's
 * entry is a hidden input beside its box.
 */
export const TenantLocalesPicker = ({
  initialDefaultLocale,
}: {
  initialDefaultLocale: Locale;
}) => {
  const t = useClientMessages();
  const supportedDescriptionId = useId();
  const [defaultLocale, setDefaultLocale] = useState(initialDefaultLocale);
  const [offered, setOffered] = useState<ReadonlySet<Locale>>(
    () => new Set([initialDefaultLocale])
  );

  const chooseDefault = (value: string) => {
    const code = parseLocale(value);
    if (!code) {
      return;
    }
    setDefaultLocale(code);
    setOffered((current) => new Set(current).add(code));
  };

  const setOfferedLocale = (code: Locale, checked: boolean) => {
    setOffered((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(code);
      } else {
        next.delete(code);
      }
      return next;
    });
  };

  return (
    <>
      <Field.Root>
        <Field.Label required>
          {t("platform.tenants.default_locale")}
        </Field.Label>
        <Field.Content>
          <Select
            items={getLocales().map((value) => ({
              label: getLocaleLabel(value),
              value,
            }))}
            name="tenant_default_locale"
            onValueChange={chooseDefault}
            placeholder={t("platform.tenants.default_locale_placeholder")}
            value={defaultLocale}
          />
          <Field.Description>
            {t("platform.tenants.default_locale_help")}
          </Field.Description>
        </Field.Content>
      </Field.Root>

      <fieldset aria-describedby={supportedDescriptionId} className="min-w-0">
        <legend className="mb-2 text-sm font-medium text-foreground">
          {t("platform.tenants.supported_locales")}
        </legend>
        <ul className="grid gap-2">
          {getLocales().map((code) => {
            const isDefault = code === defaultLocale;

            return (
              <li key={code}>
                <Field.Root>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isDefault || offered.has(code)}
                      disabled={isDefault}
                      name="tenant_supported_locales"
                      onCheckedChange={(checked) => {
                        setOfferedLocale(code, checked);
                      }}
                      value={code}
                    />
                    {isDefault ? (
                      <input
                        name="tenant_supported_locales"
                        type="hidden"
                        value={code}
                      />
                    ) : null}
                    <Field.Label>
                      <span lang={code}>{getLocaleLabel(code)}</span>
                    </Field.Label>
                  </div>
                </Field.Root>
              </li>
            );
          })}
        </ul>
        <p
          className="mt-2 text-xs text-muted-foreground"
          id={supportedDescriptionId}
        >
          {t("platform.tenants.supported_locales_help")}
        </p>
      </fieldset>
    </>
  );
};
