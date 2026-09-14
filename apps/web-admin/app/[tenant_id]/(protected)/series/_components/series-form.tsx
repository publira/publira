"use client";

import { toIntlLocale } from "@publira/i18n";
import { Button } from "@publira/ui-components/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
  MultiCombobox,
  MultiComboboxChip,
  MultiComboboxChipRemove,
  MultiComboboxChips,
  MultiComboboxInput,
  MultiComboboxInputGroup,
} from "@publira/ui-components/combobox";
import type {
  ComboboxItem,
  MultiComboboxItem,
} from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { toDateTimeLocalValue } from "@publira/utils";
import Image from "next/image";
import {
  Suspense,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import type { ChangeEventHandler } from "react";

import {
  AdminLocaleContext,
  useAdminMessages,
} from "#components/admin-locale-context";
import { ClientMessage } from "#components/client-message";
import { fillInstantFromDateTimeLocal } from "#lib/datetime-local-form";
import {
  DEFAULT_SERIES_AGE_RATING,
  DEFAULT_SERIES_STATUS,
} from "#lib/series-classification";
import type { SeriesCommentMode } from "#lib/series-comment-mode";
import type { TenantCommentMode } from "#lib/tenant-comment-settings-shared";
import { useTenantId } from "#lib/use-tenant-id";

import type { SeriesActionState, SeriesListItem } from "../series-types";
import {
  SeriesAgeRatingField,
  SeriesGenreField,
  SeriesScheduleField,
  SeriesStatusField,
  SeriesTagField,
} from "./series-classification-fields";
import type { GenreOption } from "./series-classification-fields";
import { SeriesCommentModeField } from "./series-comment-mode-field";

interface CreatorOption {
  publicId: string;
  name: string;
}

interface LabelOption {
  publicId: string;
  name: string;
}

interface SeriesFormProps {
  mode: "create" | "update";
  action: (
    prevState: SeriesActionState,
    formData: FormData
  ) => Promise<SeriesActionState>;
  defaultReadingPeriodHours: number;
  creators: CreatorOption[];
  labels: LabelOption[];
  genres: GenreOption[];
  tagSuggestions: string[];
  creatorsErrorMessage?: string;
  labelsErrorMessage?: string;
  genresErrorMessage?: string;
  tagSuggestionsErrorMessage?: string;
  initialSeries?: SeriesListItem;
  /**
   * The mode the series states of its own, empty while it follows its
   * tenant's. It comes in beside {@link SeriesFormProps.initialSeries} because
   * the API answers it beside the series: the storefront reads the same
   * `Series` message, and there the useful answer is the tenant and the series
   * resolved together.
   */
  initialCommentMode?: SeriesCommentMode;
  /** What the tenant publishes comments under, for the option that follows it. */
  tenantCommentMode?: TenantCommentMode;
  timeZone: string;
}

const SeriesFormSubmitLabel = ({
  isPending,
  isUpdate,
}: {
  isPending: boolean;
  isUpdate: boolean;
}) => {
  if (isPending) {
    return <ClientMessage message="admin.series.form.submitting" />;
  }

  return isUpdate ? (
    <ClientMessage message="admin.series.form.update" />
  ) : (
    <ClientMessage message="admin.series.form.create" />
  );
};

interface CreatorFieldProps {
  creatorItems: MultiComboboxItem[];
  creatorsErrorMessage?: string;
  selectedCreatorPublicIds: string[];
  onChange: (nextValue: string[]) => void;
}

const CreatorField = ({
  creatorItems,
  creatorsErrorMessage,
  selectedCreatorPublicIds,
  onChange,
}: CreatorFieldProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useAdminMessages();
  // MultiCombobox renders its own input instead of a Field control, so the
  // label needs an id to point at.
  const comboboxId = useId();

  return (
    <Field>
      <FieldLabel htmlFor={comboboxId}>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <ClientMessage message="admin.series.form.creators" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        {creatorsErrorMessage ? (
          <FormMessage variant="destructive">
            {creatorsErrorMessage}
          </FormMessage>
        ) : null}

        {creatorItems.length === 0 ? (
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.series.form.creators_empty" />
            </Suspense>
          </FieldDescription>
        ) : (
          <MultiCombobox
            id={comboboxId}
            items={creatorItems}
            onValueChange={onChange}
            value={selectedCreatorPublicIds}
          >
            <MultiComboboxInputGroup>
              <MultiComboboxChips>
                {(selected) => (
                  <>
                    {selected.map((item) => (
                      <MultiComboboxChip item={item} key={item.value}>
                        {item.label}
                        <MultiComboboxChipRemove
                          aria-label={t("admin.series.form.creators_remove")}
                        />
                      </MultiComboboxChip>
                    ))}
                    <MultiComboboxInput
                      placeholder={
                        selected.length > 0
                          ? ""
                          : t("admin.series.form.creators_search")
                      }
                    />
                  </>
                )}
              </MultiComboboxChips>
            </MultiComboboxInputGroup>
            <ComboboxPopup>
              <ComboboxEmpty>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <ClientMessage message="admin.series.form.creators_no_match" />
                </Suspense>
              </ComboboxEmpty>
              <ComboboxItems />
            </ComboboxPopup>
          </MultiCombobox>
        )}

        {selectedCreatorPublicIds.map((publicId) => (
          <input
            key={publicId}
            name="creator_public_ids"
            type="hidden"
            value={publicId}
          />
        ))}

        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <ClientMessage message="admin.series.form.creators_description" />
          </Suspense>
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};

interface LabelFieldProps {
  labelItems: ComboboxItem[];
  labelsErrorMessage?: string;
  selectedLabelPublicId: string;
  useLabelFallbackInput: boolean;
  onComboboxChange: (nextValue: string) => void;
  onFallbackChange: ChangeEventHandler<HTMLInputElement>;
}

const LabelField = ({
  labelItems,
  labelsErrorMessage,
  selectedLabelPublicId,
  useLabelFallbackInput,
  onComboboxChange,
  onFallbackChange,
}: LabelFieldProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useAdminMessages();
  // Combobox renders its own input instead of a Field control, so the label
  // needs an id to point at. The fallback Input is a Field control and wires
  // itself up.
  const comboboxId = useId();

  return (
    <Field>
      <FieldLabel
        htmlFor={useLabelFallbackInput ? undefined : comboboxId}
        required
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <ClientMessage message="admin.series.form.label" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        {labelsErrorMessage ? (
          <FormMessage variant="destructive">{labelsErrorMessage}</FormMessage>
        ) : null}

        {useLabelFallbackInput ? (
          <>
            <Input
              name="label_public_id"
              onChange={onFallbackChange}
              placeholder={t("admin.series.form.label_fallback_placeholder")}
              required
              type="text"
              value={selectedLabelPublicId}
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.series.form.label_fallback_description" />
              </Suspense>
            </FieldDescription>
          </>
        ) : (
          <>
            <Combobox
              id={comboboxId}
              items={labelItems}
              onValueChange={onComboboxChange}
              value={selectedLabelPublicId}
            >
              <ComboboxInput
                placeholder={t("admin.series.form.label_placeholder")}
              />
              <ComboboxPopup>
                <ComboboxEmpty>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <ClientMessage message="admin.series.form.label_empty" />
                  </Suspense>
                </ComboboxEmpty>
                <ComboboxItems />
              </ComboboxPopup>
            </Combobox>

            <input
              name="label_public_id"
              type="hidden"
              value={selectedLabelPublicId}
            />

            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.series.form.label_description" />
              </Suspense>
            </FieldDescription>
          </>
        )}
      </FieldContent>
    </Field>
  );
};

interface EyeCatchImageFieldProps {
  clearEyeCatchImage: boolean;
  onImageFileChange: ChangeEventHandler<HTMLInputElement>;
  previewImageUrl: string;
}

const EyeCatchImageField = ({
  clearEyeCatchImage,
  onImageFileChange,
  previewImageUrl,
}: EyeCatchImageFieldProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useAdminMessages();
  const hasPreviewImage = previewImageUrl.length > 0;

  return (
    <Field>
      <FieldLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <ClientMessage message="admin.series.form.eye_catch" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <div className="grid gap-4 border border-border bg-muted/20 p-4">
          <div className="border border-border bg-background p-3">
            <p className="mb-2 text-sm font-medium">
              <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                <ClientMessage message="admin.series.form.eye_catch_preview" />
              </Suspense>
            </p>
            <div className="relative aspect-[3/4] max-w-52 overflow-hidden rounded-surface border border-border bg-muted/50">
              {hasPreviewImage ? (
                <Image
                  alt={t("admin.series.form.eye_catch_preview_alt")}
                  className="h-full w-full object-cover"
                  fill
                  sizes="(max-width: 768px) 100vw, 240px"
                  src={previewImageUrl}
                  unoptimized
                />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <ClientMessage message="admin.series.form.eye_catch_preview_empty" />
                  </Suspense>
                </div>
              )}
            </div>
          </div>
        </div>

        <Input
          accept="image/jpeg,image/png,image/webp"
          name="eye_catch_image"
          onChange={onImageFileChange}
          type="file"
        />
        <input
          name="clear_eye_catch_image"
          type="hidden"
          value={clearEyeCatchImage ? "1" : "0"}
        />
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <ClientMessage message="admin.series.form.eye_catch_description" />
          </Suspense>
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};

const useSeriesFormState = ({
  initialCommentMode,
  initialSeries,
}: Pick<SeriesFormProps, "initialCommentMode" | "initialSeries">) => {
  // Seeded once per mount: the edit route keys this form by the series' public
  // id, so switching to another series remounts it with that series' creators
  // and label.
  const [selectedCreatorPublicIds, setSelectedCreatorPublicIds] = useState(
    () => initialSeries?.creatorPublicIds ?? []
  );
  const [selectedLabelPublicId, setSelectedLabelPublicId] = useState(
    initialSeries?.labelPublicId ?? ""
  );
  const [status, setStatus] = useState(
    () => initialSeries?.status ?? DEFAULT_SERIES_STATUS
  );
  const [scheduleWeekdays, setScheduleWeekdays] = useState<number[]>(
    () => initialSeries?.scheduleWeekdays ?? []
  );
  const [ageRating, setAgeRating] = useState(
    () => initialSeries?.ageRating ?? DEFAULT_SERIES_AGE_RATING
  );
  const [selectedGenrePublicIds, setSelectedGenrePublicIds] = useState(
    () => initialSeries?.genrePublicIds ?? []
  );
  const [tagNames, setTagNames] = useState(() => initialSeries?.tagNames ?? []);
  const [commentMode, setCommentMode] = useState<SeriesCommentMode>(
    () => initialCommentMode ?? ""
  );
  const [uploadedEyeCatchPreviewUrl, setUploadedEyeCatchPreviewUrl] =
    useState("");

  useEffect(
    () => () => {
      if (uploadedEyeCatchPreviewUrl) {
        URL.revokeObjectURL(uploadedEyeCatchPreviewUrl);
      }
    },
    [uploadedEyeCatchPreviewUrl]
  );

  const handleLabelFallbackInputChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >((event) => {
    setSelectedLabelPublicId(event.currentTarget.value);
  }, []);

  const handleEyeCatchImageFileChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >((event) => {
    const file = event.currentTarget.files?.[0];

    setUploadedEyeCatchPreviewUrl((currentValue) => {
      if (currentValue) {
        URL.revokeObjectURL(currentValue);
      }
      return file ? URL.createObjectURL(file) : "";
    });
  }, []);

  let eyeCatchPreviewUrl = "";
  if (uploadedEyeCatchPreviewUrl) {
    eyeCatchPreviewUrl = uploadedEyeCatchPreviewUrl;
  }

  return {
    ageRating,
    commentMode,
    eyeCatchPreviewUrl,
    handleEyeCatchImageFileChange,
    handleLabelFallbackInputChange,
    scheduleWeekdays,
    selectedCreatorPublicIds,
    selectedGenrePublicIds,
    selectedLabelPublicId,
    setAgeRating,
    setCommentMode,
    setScheduleWeekdays,
    setSelectedCreatorPublicIds,
    setSelectedGenrePublicIds,
    setSelectedLabelPublicId,
    setStatus,
    setTagNames,
    status,
    tagNames,
  };
};

export const SeriesForm = ({
  mode,
  action,
  defaultReadingPeriodHours,
  creators,
  labels,
  genres,
  tagSuggestions,
  creatorsErrorMessage,
  labelsErrorMessage,
  genresErrorMessage,
  tagSuggestionsErrorMessage,
  initialSeries,
  initialCommentMode,
  tenantCommentMode,
  timeZone,
}: SeriesFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useAdminMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const creatorItems = useMemo<MultiComboboxItem[]>(
    () =>
      creators
        .map((creator) => ({
          label: creator.name,
          value: creator.publicId,
        }))
        .toSorted((a, b) =>
          a.label.localeCompare(b.label, toIntlLocale(locale))
        ),
    [creators, locale]
  );
  const labelItems = useMemo<ComboboxItem[]>(
    () =>
      labels
        .map((label) => ({
          label: label.name,
          value: label.publicId,
        }))
        .toSorted((a, b) =>
          a.label.localeCompare(b.label, toIntlLocale(locale))
        ),
    [labels, locale]
  );
  const {
    ageRating,
    commentMode,
    eyeCatchPreviewUrl,
    handleEyeCatchImageFileChange,
    handleLabelFallbackInputChange,
    scheduleWeekdays,
    selectedCreatorPublicIds,
    selectedGenrePublicIds,
    selectedLabelPublicId,
    setAgeRating,
    setCommentMode,
    setScheduleWeekdays,
    setSelectedCreatorPublicIds,
    setSelectedGenrePublicIds,
    setSelectedLabelPublicId,
    setStatus,
    setTagNames,
    status,
    tagNames,
  } = useSeriesFormState({ initialCommentMode, initialSeries });

  const useLabelFallbackInput =
    Boolean(labelsErrorMessage) || labelItems.length === 0;

  const isUpdate = mode === "update";

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      fillInstantFromDateTimeLocal(event.currentTarget, {
        isoName: "published_at",
        localName: "published_at_local",
        timeZone,
      });
    },
    [timeZone]
  );

  return (
    <form action={formAction} className="grid gap-4" onSubmit={handleSubmit}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input
        name="public_id"
        type="hidden"
        value={initialSeries?.publicId ?? ""}
      />

      <div className="grid gap-4">
        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.series.form.title" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={initialSeries?.title ?? ""}
              name="title"
              placeholder={t("admin.series.form.title_placeholder")}
              required
              type="text"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.series.form.reading_period" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={
                initialSeries?.readingPeriodHours ?? defaultReadingPeriodHours
              }
              min={0}
              name="reading_period_hours"
              required
              type="number"
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.series.form.reading_period_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.series.form.synopsis" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Textarea
              defaultValue={initialSeries?.synopsis ?? ""}
              name="synopsis"
              placeholder={t("admin.series.form.synopsis_placeholder")}
              required
              rows={5}
            />
          </FieldContent>
        </Field>

        <CreatorField
          creatorItems={creatorItems}
          creatorsErrorMessage={creatorsErrorMessage}
          onChange={setSelectedCreatorPublicIds}
          selectedCreatorPublicIds={selectedCreatorPublicIds}
        />

        <LabelField
          labelItems={labelItems}
          labelsErrorMessage={labelsErrorMessage}
          onComboboxChange={setSelectedLabelPublicId}
          onFallbackChange={handleLabelFallbackInputChange}
          selectedLabelPublicId={selectedLabelPublicId}
          useLabelFallbackInput={useLabelFallbackInput}
        />

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.series.form.published_at" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <input defaultValue="" name="published_at" type="hidden" />
            <Input
              // Wall clock shown in the zone this form was rendered in.
              // Submit writes the matching instant into `published_at`.
              defaultValue={toDateTimeLocalValue(
                initialSeries?.publishedAt ?? "",
                timeZone
              )}
              name="published_at_local"
              type="datetime-local"
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage
                  message="admin.series.form.published_at_description"
                  values={{
                    time_zone: timeZone,
                  }}
                />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <SeriesStatusField onChange={setStatus} value={status} />

        <SeriesScheduleField
          onChange={setScheduleWeekdays}
          value={scheduleWeekdays}
        />

        <SeriesAgeRatingField onChange={setAgeRating} value={ageRating} />

        <SeriesGenreField
          genres={genres}
          genresErrorMessage={genresErrorMessage}
          onChange={setSelectedGenrePublicIds}
          value={selectedGenrePublicIds}
        />

        <SeriesTagField
          onChange={setTagNames}
          suggestions={tagSuggestions}
          suggestionsErrorMessage={tagSuggestionsErrorMessage}
          value={tagNames}
        />

        <SeriesCommentModeField
          onChange={setCommentMode}
          tenantCommentMode={tenantCommentMode}
          value={commentMode}
        />
      </div>

      {!isUpdate && (
        <EyeCatchImageField
          clearEyeCatchImage={false}
          onImageFileChange={handleEyeCatchImageFileChange}
          previewImageUrl={eyeCatchPreviewUrl}
        />
      )}

      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}

      <div className="flex justify-end">
        <Button disabled={isPending} type="submit">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <SeriesFormSubmitLabel isPending={isPending} isUpdate={isUpdate} />
          </Suspense>
        </Button>
      </div>
    </form>
  );
};
