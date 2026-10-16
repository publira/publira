import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
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

interface SeriesTranslationDeleteButtonProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  seriesPublicId: string;
  tenantId: string;
  translationLocale: Locale;
}

/**
 * Deletes the title and synopsis on screen once staff confirm it. Success
 * leaves for the series' default translation, which raises the toast.
 */
export const SeriesTranslationDeleteButton = ({
  action,
  seriesPublicId,
  tenantId,
  translationLocale,
}: SeriesTranslationDeleteButtonProps) => {
  const formId = `delete-series-translation-${translationLocale}`;
  const language = getLocaleLabel(translationLocale);

  return (
    <ActionForm action={action} className="grid gap-1" id={formId}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
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
              <Message message="admin.series.translations.delete_action" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.series.translations.deleting" />
            </ActionFormPending>
          </Suspense>
        </ConfirmDialogTrigger>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message
                  message="admin.series.translations.delete_confirm_title"
                  values={{ language }}
                />
              </Suspense>
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message
                  message="admin.series.translations.delete_confirm_description"
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
                <Message message="admin.series.translations.delete_confirm_action" />
              </Suspense>
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </ActionForm>
  );
};
