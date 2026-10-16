import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { PlusIcon } from "@publira/icons";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

interface TranslationTabsProps {
  /** Shown at the end of the row, for the control that acts on the selected translation. */
  children?: ReactNode;
  /** The URL of the screen that shows the record's translation in a locale. */
  hrefFor: (locale: Locale) => string;
  /** The languages the tenant's site offers, in the registry's order. */
  locales: readonly Locale[];
  selectedLocale: Locale;
  translatedLocales: readonly Locale[];
}

/**
 * One link per language the site offers, for a record written once per
 * language: a page, a series, an episode. The language is part of the URL, so
 * each translation opens in a form of its own and an unsaved edit never
 * carries over to another; a locale the record has no translation in is
 * marked as not added. A translation in a language the site no longer offers
 * has no link, and has one again once the language is switched back on.
 */
export const TranslationTabs = async ({
  children,
  hrefFor,
  locales,
  selectedLocale,
  translatedLocales,
}: TranslationTabsProps) => {
  const t = await getMessages();
  const translated = new Set(translatedLocales);

  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border">
      <nav
        aria-label={t("admin.translations.tabs_label")}
        className="flex flex-wrap items-center gap-1"
      >
        {locales.map((code) => {
          const hasTranslation = translated.has(code);

          return (
            <Link
              aria-current={code === selectedLocale ? "page" : undefined}
              className="-mb-px inline-flex items-center gap-1 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-state ease-state hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:border-primary aria-[current=page]:text-foreground"
              href={hrefFor(code)}
              key={code}
            >
              {hasTranslation ? null : (
                <PlusIcon aria-hidden="true" className="size-3.5" />
              )}
              {/* An autonym, read in the language it names. */}
              <span lang={code}>{getLocaleLabel(code)}</span>
              {hasTranslation ? null : (
                <span className="sr-only">
                  <Suspense fallback={null}>
                    <Message message="admin.translations.not_added" />
                  </Suspense>
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {children ? <div className="pb-2">{children}</div> : null}
    </div>
  );
};
