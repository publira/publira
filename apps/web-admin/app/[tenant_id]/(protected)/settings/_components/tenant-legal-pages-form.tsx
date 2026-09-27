import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  ComboboxEmpty,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import type { TenantLegalPages } from "#lib/tenant-legal-pages-shared";

import { updateTenantLegalPagesAction } from "../_lib/actions";
import {
  LegalPageCombobox,
  LegalPagePicker,
  LegalPageWhileSelected,
} from "./tenant-legal-page-picker";
import type { LegalPageOption } from "./tenant-legal-page-picker";

interface TenantLegalPagesFormProps {
  canEdit: boolean;
  /** The saved nominations, absent when the read failed. */
  initialPages?: TenantLegalPages;
  loadErrorMessage?: string;
  /** Every published page of the tenant. */
  publishedPages: LegalPageOption[];
  pagesErrorMessage?: string;
  tenantId: string;
}

export const TenantLegalPagesForm = ({
  canEdit,
  initialPages,
  loadErrorMessage,
  pagesErrorMessage,
  publishedPages,
  tenantId,
}: TenantLegalPagesFormProps) => {
  const termsPage = initialPages?.termsPage;
  const privacyPage = initialPages?.privacyPage;
  // Without the saved nominations a save would clear them, and without the
  // page list the pickers could offer nothing but "None".
  const fieldsDisabled =
    !canEdit || Boolean(loadErrorMessage) || Boolean(pagesErrorMessage);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.settings.legal_pages.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.legal_pages.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantLegalPagesAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionFormFieldset className="grid gap-4" disabled={fieldsDisabled}>
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.settings.legal_pages.terms" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <LegalPagePicker initialPageId={termsPage?.pageId ?? ""}>
                <LegalPageCombobox
                  name="terms_page_id"
                  nominated={termsPage}
                  publishedPages={publishedPages}
                >
                  <ComboboxPopup>
                    <ComboboxEmpty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.settings.legal_pages.empty" />
                      </Suspense>
                    </ComboboxEmpty>
                    <ComboboxItems />
                  </ComboboxPopup>
                </LegalPageCombobox>
                {termsPage && !termsPage.published ? (
                  <LegalPageWhileSelected pageId={termsPage.pageId}>
                    <FormMessage variant="destructive">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message
                          message="admin.settings.legal_pages.unpublished"
                          values={{ title: termsPage.title }}
                        />
                      </Suspense>
                    </FormMessage>
                  </LegalPageWhileSelected>
                ) : null}
              </LegalPagePicker>
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.legal_pages.terms_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.settings.legal_pages.privacy" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <LegalPagePicker initialPageId={privacyPage?.pageId ?? ""}>
                <LegalPageCombobox
                  name="privacy_page_id"
                  nominated={privacyPage}
                  publishedPages={publishedPages}
                >
                  <ComboboxPopup>
                    <ComboboxEmpty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.settings.legal_pages.empty" />
                      </Suspense>
                    </ComboboxEmpty>
                    <ComboboxItems />
                  </ComboboxPopup>
                </LegalPageCombobox>
                {privacyPage && !privacyPage.published ? (
                  <LegalPageWhileSelected pageId={privacyPage.pageId}>
                    <FormMessage variant="destructive">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message
                          message="admin.settings.legal_pages.unpublished"
                          values={{ title: privacyPage.title }}
                        />
                      </Suspense>
                    </FormMessage>
                  </LegalPageWhileSelected>
                ) : null}
              </LegalPagePicker>
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.legal_pages.privacy_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>
        </ActionFormFieldset>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.admin_only" />
            </Suspense>
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">
            <span className="block">{loadErrorMessage}</span>
            <span className="block">
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.settings.legal_pages.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        {pagesErrorMessage ? (
          <FormMessage variant="destructive">{pagesErrorMessage}</FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <ActionFormIdle>
                <Message message="admin.settings.legal_pages.submit" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.settings.saving" />
              </ActionFormPending>
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </AdminSection>
  );
};
