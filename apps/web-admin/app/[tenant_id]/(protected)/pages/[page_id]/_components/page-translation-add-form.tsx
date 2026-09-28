import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
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

import type { PageFormState } from "../../page-types";

interface PageTranslationAddFormProps {
  action: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
  pageId: string;
  tenantId: string;
  translationLocale: Locale;
}

/**
 * Adds the page's translation in a locale it has none in. The title is all a
 * translation needs to exist; its body is written and published afterwards, in
 * the workspace the Action redirects to.
 */
export const PageTranslationAddForm = ({
  action,
  pageId,
  tenantId,
  translationLocale,
}: PageTranslationAddFormProps) => {
  const language = getLocaleLabel(translationLocale);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message
                message="admin.pages.translations.add_title"
                values={{ language }}
              />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <Message
                message="admin.pages.translations.add_description"
                values={{ language }}
              />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>

      <ActionForm action={action} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="page_id" type="hidden" value={pageId} />
        <input
          name="translation_locale"
          type="hidden"
          value={translationLocale}
        />

        <ActionFormFieldset className="grid gap-4">
          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.pages.workspace.title" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input name="title" required type="text" />
            </FieldContent>
          </Field>
        </ActionFormFieldset>

        <div className="flex justify-end">
          <ActionFormSubmit>
            <ActionFormIdle>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.pages.translations.add_action" />
              </Suspense>
            </ActionFormIdle>
            <ActionFormPending>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.pages.translations.adding" />
              </Suspense>
            </ActionFormPending>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </AdminSection>
  );
};
