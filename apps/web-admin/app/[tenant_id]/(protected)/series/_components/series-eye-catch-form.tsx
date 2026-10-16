import type { Locale } from "@publira/i18n";
import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { EyeCatchFormField } from "#components/eye-catch/form-field";
import { Message } from "#components/message";

import type { SeriesActionState, SeriesListItem } from "../series-types";

interface SeriesEyeCatchFormProps {
  action: (
    prevState: SeriesActionState,
    formData: FormData
  ) => Promise<SeriesActionState>;
  series: SeriesListItem;
  tenantId: string;
  /**
   * The language `series.title` is written in. An update writes a title, so
   * this tab sends one back in the language it was read in: without it, the
   * API files the title under the tenant's default language and adds a
   * translation there when the series has none in it.
   */
  translationLocale?: Locale;
}

export const SeriesEyeCatchForm = ({
  action,
  series,
  tenantId,
  translationLocale,
}: SeriesEyeCatchFormProps) => (
  <ActionForm action={action} className="grid gap-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="series_id" type="hidden" value={series.id} />
    <input name="title" type="hidden" value={series.title} />
    {translationLocale ? (
      <input
        name="translation_locale"
        type="hidden"
        value={translationLocale}
      />
    ) : null}
    <input name="label_id" type="hidden" value={series.labelId} />
    <input name="published_at" type="hidden" value={series.publishedAt} />
    {series.genreIds.map((id) => (
      <input key={id} name="genre_ids" type="hidden" value={id} />
    ))}
    {series.tagNames.map((tagName) => (
      <input key={tagName} name="tag_names" type="hidden" value={tagName} />
    ))}
    {/* An update replaces every credit the series holds, so this tab carries
        them back exactly as it read them. A credit written before roles
        existed states none and makes the save report that instead — the
        basics tab is where a role is chosen for it, and dropping the row here
        would un-credit the person. */}
    <input
      name="creator_credits"
      type="hidden"
      value={JSON.stringify(series.creatorCredits)}
    />
    {series.isPublished ? (
      <input name="is_published" type="hidden" value="on" />
    ) : null}

    {/* A save refreshes the page with the eye-catch it stored, and the new
        timestamp remounts the field so the picked file and the delete toggle
        do not outlive the save they were sent with. */}
    <EyeCatchFormField
      eyeCatchImageUpdatedAt={series.eyeCatchImageUpdatedAt}
      key={series.eyeCatchImageUpdatedAt}
      variants={series.eyeCatchImageVariants}
    />

    <div className="flex justify-end">
      <ActionFormSubmit>
        <ActionFormIdle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.series.form.eye_catch_update" />
          </Suspense>
        </ActionFormIdle>
        <ActionFormPending>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.series.form.submitting" />
          </Suspense>
        </ActionFormPending>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);
