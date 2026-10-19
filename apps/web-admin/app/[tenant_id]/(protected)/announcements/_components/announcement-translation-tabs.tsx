"use client";

import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@publira/ui-components/tabs";
import { useState } from "react";
import type { InvalidEvent, ReactNode } from "react";

export interface AnnouncementTranslationPanel {
  locale: Locale;
  /** The title and body fields of that language. */
  fields: ReactNode;
}

interface AnnouncementTranslationTabsProps {
  /** The tab the form opens on: the tenant's default language. */
  defaultLocale: Locale;
  /** Names the row of tabs for assistive technology. */
  label: string;
  /** One per language the site offers, in the order the tabs are shown. */
  panels: readonly AnnouncementTranslationPanel[];
}

/**
 * One tab per language the site offers, inside the form that delivers the
 * announcement. Every language is sent in the same submission, so the panels
 * stay mounted while hidden: a tab switches what is shown, never what is
 * posted.
 */
export const AnnouncementTranslationTabs = ({
  defaultLocale,
  label,
  panels,
}: AnnouncementTranslationTabsProps) => {
  const [selectedLocale, setSelectedLocale] = useState<Locale>(defaultLocale);

  // A browser cannot point at a refused field in a hidden panel, so it would
  // block the submission without saying why. The report is held back, the
  // field's tab is opened, and the field is reported once it is on screen.
  const showRefusedField = (
    locale: Locale,
    event: InvalidEvent<HTMLDivElement>
  ) => {
    if (locale === selectedLocale) {
      return;
    }
    const field = event.target;
    if (
      !(
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement
      )
    ) {
      return;
    }
    event.preventDefault();
    setSelectedLocale(locale);
    requestAnimationFrame(() => {
      field.reportValidity();
    });
  };

  return (
    <Tabs
      onValueChange={(value: Locale) => {
        setSelectedLocale(value);
      }}
      value={selectedLocale}
    >
      <TabsList aria-label={label} className="flex-wrap">
        {panels.map(({ locale }) => (
          <TabsTab key={locale} value={locale}>
            {/* An autonym, read in the language it names. */}
            <span lang={locale}>{getLocaleLabel(locale)}</span>
          </TabsTab>
        ))}
      </TabsList>
      {panels.map(({ fields, locale }) => (
        <TabsPanel
          className="grid gap-5"
          keepMounted
          key={locale}
          lang={locale}
          onInvalidCapture={(event) => {
            showRefusedField(locale, event);
          }}
          value={locale}
        >
          {fields}
        </TabsPanel>
      ))}
    </Tabs>
  );
};
