import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { CATALOG_NAME_MAX_LENGTH } from "#lib/catalog-name";
import type { TenantLocales } from "#lib/tenant-locales";

import {
  DEFAULT_LOCALE_FIELD,
  nameField,
  savedNameField,
} from "../_lib/genre-name-fields";
import type { GenreListItem } from "../genre-types";

interface GenreNameFieldsProps {
  namePlaceholder: string;
  /**
   * The languages the site offers, or `null` when they cannot be read: a field
   * for a language the site does not offer would only save into a refusal, so
   * the form then names the genre in the default language alone.
   */
  tenantLocales: TenantLocales | null;
  /** The genre a form edits; absent on the form that creates one. */
  genre?: Pick<GenreListItem, "name" | "translations">;
}

/**
 * The saved name a field starts from, posted back beside it so the Action
 * writes only the names that changed. The `key` puts the name a save came
 * back with into the field it leaves behind.
 */
const NameInput = ({
  name,
  placeholder,
  required,
  savedName,
  translationLocale,
}: {
  name: string;
  placeholder?: string;
  required: boolean;
  savedName: string;
  translationLocale?: Locale;
}) => (
  <>
    <Input
      className="sm:max-w-sm"
      defaultValue={savedName}
      key={savedName}
      lang={translationLocale}
      maxLength={CATALOG_NAME_MAX_LENGTH}
      name={name}
      placeholder={placeholder}
      required={required}
      type="text"
    />
    {savedName ? (
      <input
        name={savedNameField(translationLocale)}
        type="hidden"
        value={savedName}
      />
    ) : null}
  </>
);

/**
 * A genre's name, one field per language the site offers. The default
 * language's comes first and is required; the others may be left empty, and
 * emptying one removes that name.
 */
export const GenreNameFields = ({
  genre,
  namePlaceholder,
  tenantLocales,
}: GenreNameFieldsProps) => {
  if (!tenantLocales) {
    return (
      <Field.Root>
        <Field.Label required>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.genres.form.name" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <NameInput
            name={nameField()}
            placeholder={namePlaceholder}
            required
            savedName={genre?.name ?? ""}
          />
        </Field.Content>
      </Field.Root>
    );
  }

  const { defaultLocale, supportedLocales } = tenantLocales;

  const savedNames = new Map(
    (genre?.translations ?? []).map(({ locale, name }) => [locale, name])
  );

  return (
    <fieldset className="grid min-w-0 gap-4">
      <legend className="mb-2 text-sm font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="admin.genres.form.name" />
        </Suspense>
      </legend>
      <input name={DEFAULT_LOCALE_FIELD} type="hidden" value={defaultLocale} />
      {[
        defaultLocale,
        ...supportedLocales.filter((code) => code !== defaultLocale),
      ].map((code) => {
        const isDefault = code === defaultLocale;

        return (
          <Field.Root key={code}>
            <Field.Label required={isDefault}>
              {/* An autonym, read in the language it names. */}
              <span lang={code}>{getLocaleLabel(code)}</span>
            </Field.Label>
            <Field.Content>
              <NameInput
                name={nameField(code)}
                placeholder={isDefault ? namePlaceholder : undefined}
                required={isDefault}
                savedName={savedNames.get(code) ?? ""}
                translationLocale={code}
              />
            </Field.Content>
          </Field.Root>
        );
      })}
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-3/4" />}>
          <Message
            message="admin.genres.form.names_description"
            values={{ language: getLocaleLabel(defaultLocale) }}
          />
        </Suspense>
      </p>
    </fieldset>
  );
};
