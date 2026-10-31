import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Combobox from "@publira/ui-components/combobox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { TenantLegalPages } from "#lib/tenant-legal-pages-shared";

import { updateTenantLegalPagesAction } from "../_lib/actions";
import * as LegalPage from "./tenant-legal-page-picker";

interface TenantLegalPagesFormProps {
  canEdit: boolean;
  /** The saved nominations, absent when the read failed. */
  initialPages?: TenantLegalPages;
  loadErrorMessage?: string;
  /** Every published page of the tenant. */
  publishedPages: LegalPage.Option[];
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
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.settings.legal_pages.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.legal_pages.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateTenantLegalPagesAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionForm.Fieldset className="grid gap-4" disabled={fieldsDisabled}>
          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.settings.legal_pages.terms" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <LegalPage.Root initialPageId={termsPage?.pageId ?? ""}>
                <LegalPage.Combobox
                  name="terms_page_id"
                  nominated={termsPage}
                  publishedPages={publishedPages}
                >
                  <Combobox.Popup>
                    <Combobox.Empty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.settings.legal_pages.empty" />
                      </Suspense>
                    </Combobox.Empty>
                    <Combobox.Items />
                  </Combobox.Popup>
                </LegalPage.Combobox>
                {termsPage && !termsPage.published ? (
                  <LegalPage.WhileSelected pageId={termsPage.pageId}>
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
                  </LegalPage.WhileSelected>
                ) : null}
              </LegalPage.Root>
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.legal_pages.terms_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.settings.legal_pages.privacy" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <LegalPage.Root initialPageId={privacyPage?.pageId ?? ""}>
                <LegalPage.Combobox
                  name="privacy_page_id"
                  nominated={privacyPage}
                  publishedPages={publishedPages}
                >
                  <Combobox.Popup>
                    <Combobox.Empty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.settings.legal_pages.empty" />
                      </Suspense>
                    </Combobox.Empty>
                    <Combobox.Items />
                  </Combobox.Popup>
                </LegalPage.Combobox>
                {privacyPage && !privacyPage.published ? (
                  <LegalPage.WhileSelected pageId={privacyPage.pageId}>
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
                  </LegalPage.WhileSelected>
                ) : null}
              </LegalPage.Root>
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.legal_pages.privacy_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>
        </ActionForm.Fieldset>

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
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.legal_pages.submit" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.saving" />
              </ActionForm.Pending>
            </Suspense>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
