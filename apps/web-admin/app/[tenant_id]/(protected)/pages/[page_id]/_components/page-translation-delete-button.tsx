import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@publira/ui-components/dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import type { PageFormState } from "../../page-types";

interface PageTranslationDeleteButtonProps {
  action: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
  pageId: string;
  tenantId: string;
  translationLocale: Locale;
}

/**
 * Deletes the translation on screen, with its versions, once staff confirm it.
 * Success leaves for the page's default translation, which raises the toast.
 */
export const PageTranslationDeleteButton = ({
  action,
  pageId,
  tenantId,
  translationLocale,
}: PageTranslationDeleteButtonProps) => {
  const formId = `delete-page-translation-${translationLocale}`;
  const language = getLocaleLabel(translationLocale);

  return (
    <ActionForm action={action} className="grid gap-1" id={formId}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="page_id" type="hidden" value={pageId} />
      <input
        name="translation_locale"
        type="hidden"
        value={translationLocale}
      />
      <ConfirmDialog>
        <ConfirmDialogTrigger
          render={<Button size="sm" type="button" variant="destructive" />}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <ActionFormIdle>
              <Message message="admin.pages.translations.delete_action" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.pages.translations.deleting" />
            </ActionFormPending>
          </Suspense>
        </ConfirmDialogTrigger>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message
                  message="admin.pages.translations.delete_confirm_title"
                  values={{ language }}
                />
              </Suspense>
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message
                  message="admin.pages.translations.delete_confirm_description"
                  values={{ language }}
                />
              </Suspense>
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.common.cancel" />
              </Suspense>
            </ConfirmDialogCancel>
            <ConfirmDialogAction form={formId}>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.pages.translations.delete_confirm_action" />
              </Suspense>
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </ActionForm>
  );
};
