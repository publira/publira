"use client";

import * as Combobox from "@publira/ui-components/combobox";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useClientMessages } from "#components/client-message";
import type { TenantLegalPage } from "#lib/tenant-legal-pages-shared";

/** A published page the tenant can nominate. */
interface LegalPageOption {
  pageId: string;
  slug: string;
  title: string;
}

interface LegalPageSelection {
  pageId: string;
  setPageId: (pageId: string) => void;
}

const LegalPageSelectionContext = createContext<LegalPageSelection | null>(
  null
);

const useLegalPageSelection = () => {
  const selection = use(LegalPageSelectionContext);
  if (!selection) {
    throw new Error("Render this inside a LegalPagePicker.");
  }

  return selection;
};

/** Holds the page one role is nominating, `""` for none. */
const LegalPagePicker = ({
  children,
  initialPageId,
}: {
  children: ReactNode;
  initialPageId: string;
}) => {
  const [pageId, setPageId] = useState(initialPageId);
  const selection = useMemo(() => ({ pageId, setPageId }), [pageId]);

  return (
    <LegalPageSelectionContext value={selection}>
      {children}
    </LegalPageSelectionContext>
  );
};

/**
 * "None" first, then every published page. The nominated page is always
 * offered even when the list lacks it, so the saved value stays shown and
 * saving the other role does not drop it. `children` is the popup.
 */
const LegalPageCombobox = ({
  children,
  name,
  nominated,
  publishedPages,
}: {
  children: ReactNode;
  name: string;
  nominated: TenantLegalPage | undefined;
  publishedPages: LegalPageOption[];
}) => {
  const t = useClientMessages();
  const { pageId, setPageId } = useLegalPageSelection();

  const items = useMemo(() => {
    const options: Combobox.Item[] = [
      { label: t("admin.settings.legal_pages.none"), value: "" },
      ...publishedPages.map((page) => ({
        label: t("admin.settings.legal_pages.option", {
          slug: page.slug,
          title: page.title,
        }),
        value: page.pageId,
      })),
    ];
    if (
      nominated &&
      !publishedPages.some((page) => page.pageId === nominated.pageId)
    ) {
      const values = { slug: nominated.slug, title: nominated.title };
      options.push({
        label: nominated.published
          ? t("admin.settings.legal_pages.option", values)
          : t("admin.settings.legal_pages.option_unpublished", values),
        value: nominated.pageId,
      });
    }
    return options;
  }, [nominated, publishedPages, t]);

  return (
    <>
      <Combobox.Root items={items} onValueChange={setPageId} value={pageId}>
        <Combobox.Input
          placeholder={t("admin.settings.legal_pages.placeholder")}
        />
        {children}
      </Combobox.Root>
      <input name={name} type="hidden" value={pageId} />
    </>
  );
};

/** Renders its children while `pageId` is the one picked. */
const LegalPageWhileSelected = ({
  children,
  pageId,
}: {
  children: ReactNode;
  pageId: string;
}) => (useLegalPageSelection().pageId === pageId ? children : null);

export {
  LegalPagePicker as Root,
  LegalPageCombobox as Combobox,
  LegalPageWhileSelected as WhileSelected,
};
export type { LegalPageOption as Option };
