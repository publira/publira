import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import type { PageFormState } from "../page-types";
import { MarkdownEditor } from "./markdown-editor";
import { PageSlugField } from "./page-slug-field";

interface PageFormProps {
  action: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
  /**
   * The tenant's default locale, which the page's first translation is created
   * in. Absent when it could not be read; the server decides it either way.
   */
  defaultLocale?: Locale;
  tenantId: string;
}

/**
 * Creates a page, which the Action then redirects to. Awaits the catalog for
 * its placeholders, which are attributes rather than nodes.
 */
export const PageForm = async ({
  action,
  defaultLocale,
  tenantId,
}: PageFormProps) => {
  const t = await getMessages();

  return (
    <ActionForm.Root action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />

      <ActionForm.Fieldset className="grid gap-4">
        <PageSlugField />

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.pages.form.title" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              name="title"
              placeholder={t("admin.pages.form.title_placeholder")}
              required
              type="text"
            />
            {defaultLocale ? (
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message
                    message="admin.pages.form.locale_description"
                    values={{ language: getLocaleLabel(defaultLocale) }}
                  />
                </Suspense>
              </Field.Description>
            ) : null}
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <div className="flex items-center gap-2">
            <Checkbox
              name="display_in_footer"
              uncheckedValue="false"
              value="true"
            />
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.pages.form.footer_visible" />
              </Suspense>
            </Field.Label>
          </div>
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message message="admin.pages.form.footer_description" />
            </Suspense>
          </Field.Description>
        </Field.Root>

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.pages.form.body" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <MarkdownEditor
              aria-label={t("admin.pages.form.body")}
              defaultValue=""
              name="content_markdown"
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.pages.form.body_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>
      </ActionForm.Fieldset>

      <div className="flex justify-end">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.pages.form.create" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.pages.form.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  );
};
