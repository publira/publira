import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

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
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message
                message="admin.pages.translations.add_title"
                values={{ language }}
              />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <Message
                message="admin.pages.translations.add_description"
                values={{ language }}
              />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>

      <ActionForm.Root action={action} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="page_id" type="hidden" value={pageId} />
        <input
          name="translation_locale"
          type="hidden"
          value={translationLocale}
        />

        <ActionForm.Fieldset className="grid gap-4">
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.pages.workspace.title" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input name="title" required type="text" />
            </Field.Content>
          </Field.Root>
        </ActionForm.Fieldset>

        <div className="flex justify-end">
          <ActionForm.Submit>
            <ActionForm.Idle>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.pages.translations.add_action" />
              </Suspense>
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.pages.translations.adding" />
              </Suspense>
            </ActionForm.Pending>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
