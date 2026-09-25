"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage, useClientMessages } from "#components/client-message";
import type {
  TenantLegalPage,
  TenantLegalPages,
} from "#lib/tenant-legal-pages-shared";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantLegalPagesActionState } from "../settings-types";

/** A published page the tenant can nominate. */
export interface LegalPageOption {
  pageId: string;
  slug: string;
  title: string;
}

interface TenantLegalPagesFormProps {
  action: (
    prevState: TenantLegalPagesActionState,
    formData: FormData
  ) => Promise<TenantLegalPagesActionState>;
  canEdit: boolean;
  /** The saved nominations, absent when the read failed. */
  initialPages?: TenantLegalPages;
  loadErrorMessage?: string;
  /** Every published page of the tenant. */
  publishedPages: LegalPageOption[];
  pagesErrorMessage?: string;
}

/**
 * "None" first, then every published page. The nominated page is always
 * offered even when the list lacks it — marked when it has been unpublished —
 * so the saved value stays shown and saving the other role does not drop it.
 */
const useLegalPageItems = (
  publishedPages: LegalPageOption[],
  nominated: TenantLegalPage | undefined
): ComboboxItem[] => {
  const t = useClientMessages();

  return useMemo(() => {
    const items: ComboboxItem[] = [
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
      items.push({
        label: nominated.published
          ? t("admin.settings.legal_pages.option", values)
          : t("admin.settings.legal_pages.option_unpublished", values),
        value: nominated.pageId,
      });
    }
    return items;
  }, [nominated, publishedPages, t]);
};

const LegalPageField = ({
  description,
  disabled,
  label,
  name,
  nominated,
  onValueChange,
  publishedPages,
  value,
}: {
  description: ReactNode;
  disabled: boolean;
  label: ReactNode;
  name: string;
  nominated: TenantLegalPage | undefined;
  onValueChange: (next: string) => void;
  publishedPages: LegalPageOption[];
  value: string;
}) => {
  const t = useClientMessages();
  // Combobox renders its own input rather than a Field control, so the label
  // needs an id to point at.
  const comboboxId = useId();
  const items = useLegalPageItems(publishedPages, nominated);
  const unpublished =
    nominated !== undefined &&
    !nominated.published &&
    value === nominated.pageId;

  return (
    <Field>
      <FieldLabel htmlFor={comboboxId}>{label}</FieldLabel>
      <FieldContent>
        <Combobox
          disabled={disabled}
          id={comboboxId}
          items={items}
          onValueChange={onValueChange}
          value={value}
        >
          <ComboboxInput
            placeholder={t("admin.settings.legal_pages.placeholder")}
          />
          <ComboboxPopup>
            <ComboboxEmpty>
              <ClientMessage message="admin.settings.legal_pages.empty" />
            </ComboboxEmpty>
            <ComboboxItems />
          </ComboboxPopup>
        </Combobox>
        <input name={name} type="hidden" value={value} />
        {unpublished ? (
          <FormMessage variant="destructive">
            <ClientMessage
              message="admin.settings.legal_pages.unpublished"
              values={{ title: nominated.title }}
            />
          </FormMessage>
        ) : null}
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
    </Field>
  );
};

export const TenantLegalPagesForm = ({
  action,
  canEdit,
  initialPages,
  loadErrorMessage,
  pagesErrorMessage,
  publishedPages,
}: TenantLegalPagesFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [termsPageId, setTermsPageId] = useState(
    initialPages?.termsPage?.pageId ?? ""
  );
  const [privacyPageId, setPrivacyPageId] = useState(
    initialPages?.privacyPage?.pageId ?? ""
  );

  // Without the saved nominations a save would clear them, and without the
  // page list the pickers could offer nothing but "None".
  const fieldsDisabled =
    !canEdit || Boolean(loadErrorMessage) || Boolean(pagesErrorMessage);
  const controlsDisabled = fieldsDisabled || isPending;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.settings.legal_pages.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.legal_pages.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4 sm:max-w-lg">
        <input name="tenant_id" type="hidden" value={tenantId} />

        <LegalPageField
          description={
            <ClientMessage message="admin.settings.legal_pages.terms_description" />
          }
          disabled={controlsDisabled}
          label={<ClientMessage message="admin.settings.legal_pages.terms" />}
          name="terms_page_id"
          nominated={initialPages?.termsPage}
          onValueChange={setTermsPageId}
          publishedPages={publishedPages}
          value={termsPageId}
        />

        <LegalPageField
          description={
            <ClientMessage message="admin.settings.legal_pages.privacy_description" />
          }
          disabled={controlsDisabled}
          label={<ClientMessage message="admin.settings.legal_pages.privacy" />}
          name="privacy_page_id"
          nominated={initialPages?.privacyPage}
          onValueChange={setPrivacyPageId}
          publishedPages={publishedPages}
          value={privacyPageId}
        />

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <ClientMessage message="admin.settings.admin_only" />
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">
            <span className="block">{loadErrorMessage}</span>
            <span className="block">
              <ClientMessage message="admin.settings.legal_pages.load_error_hint" />
            </span>
          </FormMessage>
        ) : null}

        {pagesErrorMessage ? (
          <FormMessage variant="destructive">{pagesErrorMessage}</FormMessage>
        ) : null}

        {state ? (
          <FormMessage variant={state.ok ? "success" : "destructive"}>
            {state.message}
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button disabled={controlsDisabled} type="submit">
            <ActionFormIdle>
              <ClientMessage message="admin.settings.legal_pages.submit" />
            </ActionFormIdle>
            <ActionFormPending>
              <ClientMessage message="admin.settings.saving" />
            </ActionFormPending>
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
