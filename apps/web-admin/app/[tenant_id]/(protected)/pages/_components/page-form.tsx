import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import type { PageFormState } from "../page-types";
import { PageSlugField } from "./page-slug-field";

interface PageFormProps {
  action: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
  tenantId: string;
}

/**
 * Creates a page, which the Action then redirects to. Awaits the catalog for
 * its placeholders, which are attributes rather than nodes.
 */
export const PageForm = async ({ action, tenantId }: PageFormProps) => {
  const t = await getMessages();

  return (
    <ActionForm action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />

      <ActionFormFieldset className="grid gap-4">
        <PageSlugField />

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.pages.form.title" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              name="title"
              placeholder={t("admin.pages.form.title_placeholder")}
              required
              type="text"
            />
          </FieldContent>
        </Field>

        <Field>
          <div className="flex items-center gap-2">
            <Checkbox
              name="display_in_footer"
              uncheckedValue="false"
              value="true"
            />
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.pages.form.footer_visible" />
              </Suspense>
            </FieldLabel>
          </div>
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message message="admin.pages.form.footer_description" />
            </Suspense>
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.pages.form.body" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Textarea
              name="content_markdown"
              placeholder={t("admin.pages.form.body_placeholder")}
              rows={16}
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.pages.form.body_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>
      </ActionFormFieldset>

      <div className="flex justify-end">
        <ActionFormSubmit>
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.pages.form.create" />
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.pages.form.submitting" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  );
};
