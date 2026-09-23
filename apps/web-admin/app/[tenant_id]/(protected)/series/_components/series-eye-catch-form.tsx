"use client";

import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ChangeEventHandler } from "react";

import { useClientMessages } from "#components/client-message";
import { EyeCatchImageField } from "#components/eye-catch/image-field";
import { spreadStartPageOf } from "#lib/reading-layout";
import type { ReadingLayout } from "#lib/reading-layout";
import type { SeriesCommentMode } from "#lib/series-comment-mode";
import { useTenantId } from "#lib/use-tenant-id";

import type { SeriesActionState, SeriesListItem } from "../series-types";

interface SeriesEyeCatchFormProps {
  initialSeries: SeriesListItem;
  /**
   * The mode the series states of its own, empty while it follows its
   * tenant's. This form edits the eye-catch alone, but the Action behind it is
   * `UpdateSeries`, which writes the whole listing row — so the mode rides
   * along untouched rather than being reset by an image upload.
   */
  commentMode: SeriesCommentMode;
  /** Carried untouched, for the reason {@link commentMode} is. */
  readingLayout: ReadingLayout;
  action: (
    prevState: SeriesActionState,
    formData: FormData
  ) => Promise<SeriesActionState>;
}

export const SeriesEyeCatchForm = ({
  initialSeries,
  commentMode,
  readingLayout,
  action,
}: SeriesEyeCatchFormProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [clearEyeCatchImage, setClearEyeCatchImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const [selectedVariantType, setSelectedVariantType] = useState<string | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveSeries = state?.ok ? state.series : initialSeries;
  const variants = effectiveSeries.eyeCatchImageVariants ?? [];
  const hasVariants = variants.length > 0;

  useEffect(
    () => () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    },
    [localPreviewUrl]
  );

  const handleVariantImageClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImageFileChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >((event) => {
    const file = event.currentTarget.files?.[0];
    if (file) {
      setLocalPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return URL.createObjectURL(file);
      });
      setClearEyeCatchImage(false);
    }
  }, []);

  const handleDeleteToggle = useCallback(() => {
    setClearEyeCatchImage((current) => !current);
  }, []);

  return (
    <form action={formAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={initialSeries.publicId} />
      <input name="title" type="hidden" value={initialSeries.title} />
      <input name="synopsis" type="hidden" value={initialSeries.synopsis} />
      <input
        name="reading_period_hours"
        type="hidden"
        value={String(initialSeries.readingPeriodHours)}
      />
      <input
        name="label_public_id"
        type="hidden"
        value={initialSeries.labelPublicId}
      />
      <input
        name="published_at"
        type="hidden"
        value={initialSeries.publishedAt}
      />
      <input
        name="current_eye_catch_image_updated_at"
        type="hidden"
        value={effectiveSeries.eyeCatchImageUpdatedAt}
      />
      <input name="status" type="hidden" value={initialSeries.status} />
      <input name="age_rating" type="hidden" value={initialSeries.ageRating} />
      <input name="comment_mode" type="hidden" value={commentMode} />
      <input
        name="reading_direction"
        type="hidden"
        value={readingLayout.readingDirection}
      />
      <input
        name="spread_start_page"
        type="hidden"
        value={String(spreadStartPageOf(readingLayout.spreadStartIndex))}
      />
      {initialSeries.scheduleWeekdays.map((weekday) => (
        <input
          key={weekday}
          name="schedule_weekdays"
          type="hidden"
          value={String(weekday)}
        />
      ))}
      {initialSeries.genrePublicIds.map((publicId) => (
        <input
          key={publicId}
          name="genre_public_ids"
          type="hidden"
          value={publicId}
        />
      ))}
      {initialSeries.tagNames.map((tagName) => (
        <input key={tagName} name="tag_names" type="hidden" value={tagName} />
      ))}
      {/* An update replaces every credit the series holds, so this tab carries
          them back exactly as it read them. A credit written before roles
          existed states none and makes the save report that instead — the
          basics tab is where a role is chosen for it, and dropping the row
          here would un-credit the person. */}
      <input
        name="creator_credits"
        type="hidden"
        value={JSON.stringify(initialSeries.creatorCredits)}
      />
      {initialSeries.isPublished ? (
        <input name="is_published" type="hidden" value="on" />
      ) : null}

      <EyeCatchImageField
        clearEyeCatchImage={clearEyeCatchImage}
        disabled={isPending}
        fileInputId="series_eye_catch_image"
        fileInputRef={fileInputRef}
        hasVariants={hasVariants}
        localPreviewUrl={localPreviewUrl}
        onDeleteToggle={handleDeleteToggle}
        onImageFileChange={handleImageFileChange}
        onVariantImageClick={handleVariantImageClick}
        onVariantTypeChange={setSelectedVariantType}
        selectedVariantType={selectedVariantType}
        variants={variants}
      />

      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}

      <div className="flex justify-end">
        <Button disabled={isPending} type="submit">
          {isPending
            ? t("admin.series.form.submitting")
            : t("admin.series.form.eye_catch_update")}
        </Button>
      </div>
    </form>
  );
};
