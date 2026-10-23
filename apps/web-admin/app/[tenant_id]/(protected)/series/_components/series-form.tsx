import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import Link from "next/link";
import { Suspense } from "react";

import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import { SubmitGate, SubmitGateSubmit } from "#components/submit-gate";
import { MAX_INT32 } from "#lib/int32";
import type { PurchaseAvailabilityOverride } from "#lib/purchase-availability";
import {
  DEFAULT_READING_DIRECTION,
  DEFAULT_SPREAD_START_INDEX,
  spreadStartPageOf,
} from "#lib/reading-layout";
import type { ReadingLayout } from "#lib/reading-layout";
import { MAX_SERIES_BUNDLE_DISCOUNT_PERCENT } from "#lib/series-bundle-discount";
import {
  DEFAULT_SERIES_AGE_RATING,
  DEFAULT_SERIES_STATUS,
  MAX_SERIES_TAGS,
} from "#lib/series-classification";
import type { SeriesCommentMode } from "#lib/series-comment-mode";
import { DEFAULT_SURFACE_AVAILABILITY } from "#lib/surface-availability";
import type { SurfaceAvailabilityValue } from "#lib/surface-availability";
import type { TenantCommentMode } from "#lib/tenant-comment-settings-shared";

import type { SeriesActionState, SeriesListItem } from "../series-types";
import { SeriesAvailabilitySelect } from "./series-availability-field";
import {
  SeriesAgeRatingSelect,
  SeriesGenreCombobox,
  SeriesScheduleEmpty,
  SeriesScheduleField,
  SeriesScheduleLegend,
  SeriesScheduleWeekdays,
  SeriesStatusSelect,
  SeriesTagInput,
} from "./series-classification-fields";
import type { GenreOption } from "./series-classification-fields";
import { SeriesCommentModeSelect } from "./series-comment-mode-field";
import {
  SeriesCreatorCreditsEditor,
  SeriesCreatorCreditsField,
  SeriesCreatorCreditsLegend,
} from "./series-creator-credits-field";
import type {
  CreatorOption,
  CreatorRoleOption,
} from "./series-creator-credits-field";
import {
  SeriesEyeCatchPreview,
  SeriesEyeCatchPreviewEmpty,
  SeriesEyeCatchPreviewTitle,
  SeriesEyeCatchUpload,
} from "./series-eye-catch-upload";
import { SeriesLabelCombobox } from "./series-label-field";
import type { LabelOption } from "./series-label-field";
import { SeriesPurchaseAvailabilitySelect } from "./series-purchase-availability-field";
import { SeriesReadingDirectionSelect } from "./series-reading-layout-fields";

interface SeriesFormProps {
  mode: "create" | "update";
  /**
   * Whether the operator may create a label, which decides whether a tenant
   * with none is pointed at the screen that makes one. A tenant auditor reads
   * the form and may not; left out, the form is one an editor submits.
   */
  canCreateLabel?: boolean;
  action: (
    prevState: SeriesActionState,
    formData: FormData
  ) => Promise<SeriesActionState>;
  creators: CreatorOption[];
  /** The tenant's roles, in the priority order the credit list is shown in. */
  creatorRoles: CreatorRoleOption[];
  labels: LabelOption[];
  genres: GenreOption[];
  tagSuggestions: string[];
  creatorsErrorMessage?: string;
  creatorRolesErrorMessage?: string;
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
  /**
   * Where the series' episodes may be bought, empty while it follows its
   * tenant. It comes in beside the series for the reason the comment mode
   * does. Absent on create, which opens on following the tenant.
   */
  initialPurchaseAvailability?: PurchaseAvailabilityOverride;
  /** Where the tenant sells by default, for the option that follows it. */
  tenantPurchaseAvailability?: SurfaceAvailabilityValue;
  /**
   * The layout the series states, beside {@link SeriesFormProps.initialSeries}
   * for the reason the comment mode is. Absent on create, which opens on the
   * layout a series nobody has set is read in.
   */
  initialReadingLayout?: ReadingLayout;
  synopsisPlaceholder: string;
  tenantId: string;
  timeZone: string;
  titlePlaceholder: string;
  /**
   * The language the title and synopsis are written in, on the edit screen.
   * Every other field is the series' own, and is saved from whichever
   * language's form submits it. Absent on create, which writes the tenant's
   * default language.
   */
  translationLocale?: Locale;
  /**
   * Whether the series has a translation in {@link translationLocale} yet.
   * Without one, the form opens with an empty title and synopsis, and saving it
   * adds them.
   */
  translated?: boolean;
}

/** The fields of a series this form opens on. */
type SeriesFormValues = Pick<
  SeriesListItem,
  | "ageRating"
  | "availability"
  | "bundleDiscountPercent"
  | "creatorCredits"
  | "genreIds"
  | "labelId"
  | "publishedAt"
  | "readingPeriodHours"
  | "rentalPeriodHours"
  | "scheduleWeekdays"
  | "status"
  | "synopsis"
  | "tagNames"
  | "title"
>;

/** What a new series opens on. */
const NEW_SERIES_VALUES: SeriesFormValues = {
  ageRating: DEFAULT_SERIES_AGE_RATING,
  availability: DEFAULT_SURFACE_AVAILABILITY,
  bundleDiscountPercent: 0,
  creatorCredits: [],
  genreIds: [],
  labelId: "",
  publishedAt: "",
  readingPeriodHours: 0,
  rentalPeriodHours: 0,
  scheduleWeekdays: [],
  status: DEFAULT_SERIES_STATUS,
  synopsis: "",
  tagNames: [],
  title: "",
};

/** The label the series is filed under, with a way to make one when none exists. */
const LabelField = ({
  canCreateLabel,
  initialValue,
  labels,
  labelsErrorMessage,
}: {
  canCreateLabel: boolean;
  initialValue: string;
  labels: LabelOption[];
  labelsErrorMessage?: string;
}) => (
  <Field.Root>
    <Field.Label required>
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="admin.series.form.label" />
      </Suspense>
    </Field.Label>
    <Field.Content>
      {labelsErrorMessage ? (
        <FormMessage variant="destructive">{labelsErrorMessage}</FormMessage>
      ) : null}

      <SeriesLabelCombobox initialValue={initialValue} labels={labels} />

      {/* An empty list that was read successfully is a tenant with no
          labels yet, which has to make one before it can save a series. */}
      {labels.length === 0 && !labelsErrorMessage ? (
        <Field.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.series.form.label_none" />
          </Suspense>
          {canCreateLabel ? (
            <>
              {" "}
              <Link
                className="text-primary underline underline-offset-4"
                href="/labels/new"
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.series.form.label_create" />
                </Suspense>
              </Link>
            </>
          ) : null}
        </Field.Description>
      ) : (
        <Field.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="admin.series.form.label_description" />
          </Suspense>
        </Field.Description>
      )}
    </Field.Content>
  </Field.Root>
);

/**
 * The language the form writes the title and synopsis in, and, until the
 * series has them in it, what saving the form does.
 */
const TranslationFields = ({
  translated,
  translationLocale,
}: {
  translated: boolean;
  translationLocale: Locale;
}) => (
  <>
    <input name="translation_locale" type="hidden" value={translationLocale} />
    {translated ? null : (
      <FormMessage>
        <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
          <Message
            message="admin.series.translations.not_added"
            values={{ language: getLocaleLabel(translationLocale) }}
          />
        </Suspense>
      </FormMessage>
    )}
  </>
);

/**
 * The form is composed on the server. Each control that holds what the editor
 * changes is a client component seeding its own state once per mount, which is
 * why the edit route keys this form by the series' public id.
 */
export const SeriesForm = ({
  mode,
  canCreateLabel = true,
  action,
  creators,
  creatorRoles,
  labels,
  genres,
  tagSuggestions,
  creatorsErrorMessage,
  creatorRolesErrorMessage,
  labelsErrorMessage,
  genresErrorMessage,
  tagSuggestionsErrorMessage,
  initialSeries,
  initialCommentMode,
  initialPurchaseAvailability,
  initialReadingLayout,
  synopsisPlaceholder,
  tenantCommentMode,
  tenantId,
  tenantPurchaseAvailability,
  timeZone,
  titlePlaceholder,
  translationLocale,
  translated = true,
}: SeriesFormProps) => {
  const values: SeriesFormValues = initialSeries ?? NEW_SERIES_VALUES;

  return (
    <ActionForm.Root action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      {initialSeries ? (
        <input name="series_id" type="hidden" value={initialSeries.id} />
      ) : null}
      {translationLocale ? (
        <TranslationFields
          translated={translated}
          translationLocale={translationLocale}
        />
      ) : null}

      {/* The stored shares already passed the server's cap, so the form opens
          submittable. */}
      <SubmitGate initialSubmittable>
        <ActionForm.Fieldset className="grid gap-4">
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.series.form.title" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                defaultValue={values.title}
                name="title"
                placeholder={titlePlaceholder}
                required
                type="text"
              />
              {translationLocale ? (
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                    <Message
                      message="admin.series.translations.title_language"
                      values={{ language: getLocaleLabel(translationLocale) }}
                    />
                  </Suspense>
                </Field.Description>
              ) : null}
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.form.reading_period" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                defaultValue={values.readingPeriodHours}
                max={MAX_INT32}
                min={0}
                name="reading_period_hours"
                required
                type="number"
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.reading_period_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.form.rental_period" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                defaultValue={values.rentalPeriodHours}
                max={MAX_INT32}
                min={0}
                name="rental_period_hours"
                required
                type="number"
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.rental_period_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.form.bundle_discount" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                defaultValue={values.bundleDiscountPercent}
                max={MAX_SERIES_BUNDLE_DISCOUNT_PERCENT}
                min={0}
                name="bundle_discount_percent"
                required
                type="number"
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.bundle_discount_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.series.form.synopsis" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Textarea
                defaultValue={values.synopsis}
                name="synopsis"
                placeholder={synopsisPlaceholder}
                required
                rows={5}
              />
            </Field.Content>
          </Field.Root>

          <SeriesCreatorCreditsField>
            <SeriesCreatorCreditsLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.form.creators" />
              </Suspense>
            </SeriesCreatorCreditsLegend>
            {creatorsErrorMessage ? (
              <FormMessage variant="destructive">
                {creatorsErrorMessage}
              </FormMessage>
            ) : null}
            {creatorRolesErrorMessage ? (
              <FormMessage variant="destructive">
                {creatorRolesErrorMessage}
              </FormMessage>
            ) : null}
            <SeriesCreatorCreditsEditor
              creatorRoles={creatorRoles}
              creators={creators}
              initialCredits={values.creatorCredits}
            />
            <p className="text-xs text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
                <Message message="admin.series.form.creators_description" />
              </Suspense>
            </p>
            <p className="text-xs text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
                <Message message="admin.series.form.creators_share_description" />
              </Suspense>
            </p>
            <p className="text-xs text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
                <Message message="admin.series.form.creators_template_note" />
              </Suspense>
            </p>
          </SeriesCreatorCreditsField>

          <LabelField
            canCreateLabel={canCreateLabel}
            initialValue={values.labelId}
            labels={labels}
            labelsErrorMessage={labelsErrorMessage}
          />

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.form.published_at" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <InstantInput
                initialValue={values.publishedAt}
                name="published_at"
                timeZone={timeZone}
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message
                    message="admin.series.form.published_at_description"
                    values={{ time_zone: timeZone }}
                  />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.form.availability" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <SeriesAvailabilitySelect initialValue={values.availability} />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.availability_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.series.form.purchase_availability" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <SeriesPurchaseAvailabilitySelect
                initialValue={initialPurchaseAvailability ?? ""}
                tenantPurchaseAvailability={tenantPurchaseAvailability}
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.purchase_availability_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
                <Message message="admin.series.form.status" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <SeriesStatusSelect initialValue={values.status} />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.status_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <SeriesScheduleField initialValue={values.scheduleWeekdays}>
            <SeriesScheduleLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.form.schedule" />
              </Suspense>
            </SeriesScheduleLegend>
            <SeriesScheduleWeekdays />
            <p className="text-xs text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
                <Message message="admin.series.form.schedule_description" />
              </Suspense>
            </p>
            <SeriesScheduleEmpty>
              <p className="text-xs text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
                  <Message message="admin.series.form.schedule_empty" />
                </Suspense>
              </p>
            </SeriesScheduleEmpty>
          </SeriesScheduleField>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.form.age_rating" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <SeriesAgeRatingSelect initialValue={values.ageRating} />
              {/* What each rating means, so the choice is made from the form
                  rather than from the guide. */}
              <ul className="grid gap-1 text-xs text-muted-foreground">
                <li>
                  <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
                    <Message message="admin.series.form.age_rating_all_hint" />
                  </Suspense>
                </li>
                <li>
                  <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
                    <Message message="admin.series.form.age_rating_r15_hint" />
                  </Suspense>
                </li>
                <li>
                  <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
                    <Message message="admin.series.form.age_rating_r18_hint" />
                  </Suspense>
                </li>
              </ul>
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.series.form.genres" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              {genresErrorMessage ? (
                <FormMessage variant="destructive">
                  {genresErrorMessage}
                </FormMessage>
              ) : null}

              {/* Stands in for the picker, which a tenant with no genre to
                  offer is not shown. */}
              {genres.length === 0 ? (
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                    <Message message="admin.series.form.genres_empty" />
                  </Suspense>
                </Field.Description>
              ) : null}
              <SeriesGenreCombobox
                genres={genres}
                initialValue={values.genreIds}
              />

              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.genres_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.series.form.tags" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              {tagSuggestionsErrorMessage ? (
                <FormMessage variant="destructive">
                  {tagSuggestionsErrorMessage}
                </FormMessage>
              ) : null}

              <SeriesTagInput
                initialValue={values.tagNames}
                suggestions={tagSuggestions}
              />

              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message
                    message="admin.series.form.tags_description"
                    values={{ count: String(MAX_SERIES_TAGS) }}
                  />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.form.comment_mode" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <SeriesCommentModeSelect
                initialValue={initialCommentMode ?? ""}
                tenantCommentMode={tenantCommentMode}
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.comment_mode_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.form.reading_direction" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <SeriesReadingDirectionSelect
                initialValue={
                  initialReadingLayout?.readingDirection ??
                  DEFAULT_READING_DIRECTION
                }
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.reading_direction_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          {/* No upper bound: a series states it for episodes of every length,
            and one shorter than the page named here is shown without
            spreads. */}
          <Field.Root>
            <Field.Label required>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.series.form.spread_start" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                defaultValue={spreadStartPageOf(
                  initialReadingLayout?.spreadStartIndex ??
                    DEFAULT_SPREAD_START_INDEX
                )}
                min={1}
                name="spread_start_page"
                required
                step={1}
                type="number"
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.spread_start_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          {mode === "create" ? (
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.series.form.eye_catch" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <SeriesEyeCatchUpload>
                  <SeriesEyeCatchPreviewTitle>
                    <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                      <Message message="admin.series.form.eye_catch_preview" />
                    </Suspense>
                  </SeriesEyeCatchPreviewTitle>
                  <SeriesEyeCatchPreview>
                    <SeriesEyeCatchPreviewEmpty>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="admin.series.form.eye_catch_preview_empty" />
                      </Suspense>
                    </SeriesEyeCatchPreviewEmpty>
                  </SeriesEyeCatchPreview>
                </SeriesEyeCatchUpload>
                <input name="clear_eye_catch_image" type="hidden" value="0" />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                    <Message message="admin.series.form.eye_catch_description" />
                  </Suspense>
                </Field.Description>
              </Field.Content>
            </Field.Root>
          ) : null}
        </ActionForm.Fieldset>

        <div className="flex justify-end">
          <SubmitGateSubmit>
            <ActionForm.Idle>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                {mode === "update" ? (
                  <Message message="admin.series.form.update" />
                ) : (
                  <Message message="admin.series.form.create" />
                )}
              </Suspense>
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.form.submitting" />
              </Suspense>
            </ActionForm.Pending>
          </SubmitGateSubmit>
        </div>
      </SubmitGate>
    </ActionForm.Root>
  );
};
