import { getLocaleLabel, getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { PlusIcon } from "@publira/icons";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import { pageEditPath } from "../page-types";

interface PageTranslationTabsProps {
  /** Shown at the end of the row, for the control that acts on the selected translation. */
  children?: ReactNode;
  pageId: string;
  selectedLocale: Locale;
  translatedLocales: readonly Locale[];
}

/**
 * One link per supported locale. Each translation has its own title, history,
 * and published version, so a locale is a screen of its own rather than a panel
 * of this one; a locale the page has no translation in opens the form that adds
 * it.
 */
export const PageTranslationTabs = async ({
  children,
  pageId,
  selectedLocale,
  translatedLocales,
}: PageTranslationTabsProps) => {
  const t = await getMessages();
  const translated = new Set(translatedLocales);

  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border">
      <nav
        aria-label={t("admin.pages.translations.tabs_label")}
        className="flex flex-wrap items-center gap-1"
      >
        {getLocales().map((code) => {
          const hasTranslation = translated.has(code);

          return (
            <Link
              aria-current={code === selectedLocale ? "page" : undefined}
              className="-mb-px inline-flex items-center gap-1 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-state ease-state hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:border-primary aria-[current=page]:text-foreground"
              href={pageEditPath(pageId, code)}
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
                    <Message message="admin.pages.translations.not_added" />
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
