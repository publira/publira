import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

interface SeriesTranslationDeleteButtonProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
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
    <ActionForm.Root action={action} className="grid gap-1" id={formId}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
      <input
        name="translation_locale"
        type="hidden"
        value={translationLocale}
      />
      <ConfirmDialog.Root>
        <ConfirmDialog.Trigger
          render={<Button size="sm" type="button" variant="destructive" />}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <ActionForm.Idle>
              <Message message="admin.series.translations.delete_action" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.series.translations.deleting" />
            </ActionForm.Pending>
          </Suspense>
        </ConfirmDialog.Trigger>
        <ConfirmDialog.Content>
          <ConfirmDialog.Header>
            <ConfirmDialog.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message
                  message="admin.series.translations.delete_confirm_title"
                  values={{ language }}
                />
              </Suspense>
            </ConfirmDialog.Title>
            <ConfirmDialog.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message
                  message="admin.series.translations.delete_confirm_description"
                  values={{ language }}
                />
              </Suspense>
            </ConfirmDialog.Description>
          </ConfirmDialog.Header>
          <ConfirmDialog.Footer>
            <ConfirmDialog.Cancel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.common.cancel" />
              </Suspense>
            </ConfirmDialog.Cancel>
            <ConfirmDialog.Action form={formId}>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.series.translations.delete_confirm_action" />
              </Suspense>
            </ConfirmDialog.Action>
          </ConfirmDialog.Footer>
        </ConfirmDialog.Content>
      </ConfirmDialog.Root>
    </ActionForm.Root>
  );
};
