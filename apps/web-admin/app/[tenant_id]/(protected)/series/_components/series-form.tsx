import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import Link from "next/link";
import { Suspense } from "react";

import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import { SubmitGate, SubmitGateSubmit } from "#components/submit-gate";
import type { PurchaseAvailabilityOverride } from "#lib/purchase-availability";
import {
  DEFAULT_READING_DIRECTION,
  DEFAULT_SPREAD_START_INDEX,
  spreadStartPageOf,
} from "#lib/reading-layout";
import type { ReadingLayout } from "#lib/reading-layout";
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
import { SeriesAvailabilityField } from "./series-availability-field";
import {
  SeriesAgeRatingField,
  SeriesGenreField,
  SeriesScheduleField,
  SeriesStatusField,
  SeriesTagField,
} from "./series-classification-fields";
import type { GenreOption } from "./series-classification-fields";
import { SeriesCommentModeField } from "./series-comment-mode-field";
import { SeriesCreatorCreditsField } from "./series-creator-credits-field";
import type {
  CreatorOption,
  CreatorRoleOption,
} from "./series-creator-credits-field";
import { SeriesEyeCatchUpload } from "./series-eye-catch-upload";
import { SeriesLabelField } from "./series-label-field";
import type { LabelOption } from "./series-label-field";
import { SeriesPurchaseAvailabilityField } from "./series-purchase-availability-field";
import { SeriesReadingDirectionField } from "./series-reading-layout-fields";

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
}

/** The fields of a series this form opens on. */
type SeriesFormValues = Pick<
  SeriesListItem,
  | "ageRating"
  | "availability"
  | "creatorCredits"
  | "genreIds"
  | "labelId"
  | "publishedAt"
  | "readingPeriodHours"
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
  creatorCredits: [],
  genreIds: [],
  labelId: "",
  publishedAt: "",
  readingPeriodHours: 0,
  scheduleWeekdays: [],
  status: DEFAULT_SERIES_STATUS,
  synopsis: "",
  tagNames: [],
  title: "",
};

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
}: SeriesFormProps) => {
  const values: SeriesFormValues = initialSeries ?? NEW_SERIES_VALUES;

  return (
    <ActionForm action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      {initialSeries ? (
        <input name="series_id" type="hidden" value={initialSeries.id} />
      ) : null}

      {/* The stored shares already passed the server's cap, so the form opens
          submittable. */}
      <SubmitGate initialSubmittable>
        <ActionFormFieldset className="grid gap-4">
          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.series.form.title" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={values.title}
                name="title"
                placeholder={titlePlaceholder}
                required
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.form.reading_period" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={values.readingPeriodHours}
                min={0}
                name="reading_period_hours"
                required
                type="number"
              />
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.reading_period_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.series.form.synopsis" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Textarea
                defaultValue={values.synopsis}
                name="synopsis"
                placeholder={synopsisPlaceholder}
                required
                rows={5}
              />
            </FieldContent>
          </Field>

          <SeriesCreatorCreditsField
            creatorRoles={creatorRoles}
            creatorRolesErrorMessage={creatorRolesErrorMessage}
            creators={creators}
            creatorsErrorMessage={creatorsErrorMessage}
            description={
              <>
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
              </>
            }
            initialCredits={values.creatorCredits}
            legend={
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.form.creators" />
              </Suspense>
            }
          />

          <SeriesLabelField
            description={
              // An empty list that was read successfully is a tenant with no
              // labels yet, which has to make one before it can save a series.
              labels.length === 0 && !labelsErrorMessage ? (
                <FieldDescription>
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
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-24" />}
                        >
                          <Message message="admin.series.form.label_create" />
                        </Suspense>
                      </Link>
                    </>
                  ) : null}
                </FieldDescription>
              ) : (
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                    <Message message="admin.series.form.label_description" />
                  </Suspense>
                </FieldDescription>
              )
            }
            initialValue={values.labelId}
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.series.form.label" />
              </Suspense>
            }
            labels={labels}
            labelsErrorMessage={labelsErrorMessage}
          />

          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.form.published_at" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <InstantInput
                initialValue={values.publishedAt}
                name="published_at"
                timeZone={timeZone}
              />
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message
                    message="admin.series.form.published_at_description"
                    values={{ time_zone: timeZone }}
                  />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>

          <SeriesAvailabilityField
            description={
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.availability_description" />
                </Suspense>
              </FieldDescription>
            }
            initialValue={values.availability}
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.form.availability" />
              </Suspense>
            }
          />

          <SeriesPurchaseAvailabilityField
            description={
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.purchase_availability_description" />
                </Suspense>
              </FieldDescription>
            }
            initialValue={initialPurchaseAvailability ?? ""}
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.series.form.purchase_availability" />
              </Suspense>
            }
            tenantPurchaseAvailability={tenantPurchaseAvailability}
          />

          <SeriesStatusField
            description={
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.status_description" />
                </Suspense>
              </FieldDescription>
            }
            initialValue={values.status}
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
                <Message message="admin.series.form.status" />
              </Suspense>
            }
          />

          <SeriesScheduleField
            description={
              <p className="text-xs text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
                  <Message message="admin.series.form.schedule_description" />
                </Suspense>
              </p>
            }
            initialValue={values.scheduleWeekdays}
            irregular={
              <p className="text-xs text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
                  <Message message="admin.series.form.schedule_irregular" />
                </Suspense>
              </p>
            }
            legend={
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.form.schedule" />
              </Suspense>
            }
          />

          <SeriesAgeRatingField
            description={
              // What each rating means, so the choice is made from the form
              // rather than from the guide.
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
            }
            initialValue={values.ageRating}
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.form.age_rating" />
              </Suspense>
            }
          />

          <SeriesGenreField
            description={
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.genres_description" />
                </Suspense>
              </FieldDescription>
            }
            empty={
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.genres_empty" />
                </Suspense>
              </FieldDescription>
            }
            genres={genres}
            genresErrorMessage={genresErrorMessage}
            initialValue={values.genreIds}
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.series.form.genres" />
              </Suspense>
            }
          />

          <SeriesTagField
            description={
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message
                    message="admin.series.form.tags_description"
                    values={{ count: String(MAX_SERIES_TAGS) }}
                  />
                </Suspense>
              </FieldDescription>
            }
            initialValue={values.tagNames}
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.series.form.tags" />
              </Suspense>
            }
            suggestions={tagSuggestions}
            suggestionsErrorMessage={tagSuggestionsErrorMessage}
          />

          <SeriesCommentModeField
            description={
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.comment_mode_description" />
                </Suspense>
              </FieldDescription>
            }
            initialValue={initialCommentMode ?? ""}
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.form.comment_mode" />
              </Suspense>
            }
            tenantCommentMode={tenantCommentMode}
          />

          <SeriesReadingDirectionField
            description={
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.reading_direction_description" />
                </Suspense>
              </FieldDescription>
            }
            initialValue={
              initialReadingLayout?.readingDirection ??
              DEFAULT_READING_DIRECTION
            }
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.form.reading_direction" />
              </Suspense>
            }
          />

          {/* No upper bound: a series states it for episodes of every length,
            and one shorter than the page named here is shown without
            spreads. */}
          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.series.form.spread_start" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
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
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.form.spread_start_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>

          {mode === "create" ? (
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.series.form.eye_catch" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <SeriesEyeCatchUpload
                  empty={
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.series.form.eye_catch_preview_empty" />
                    </Suspense>
                  }
                  title={
                    <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                      <Message message="admin.series.form.eye_catch_preview" />
                    </Suspense>
                  }
                />
                <input name="clear_eye_catch_image" type="hidden" value="0" />
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                    <Message message="admin.series.form.eye_catch_description" />
                  </Suspense>
                </FieldDescription>
              </FieldContent>
            </Field>
          ) : null}
        </ActionFormFieldset>

        <div className="flex justify-end">
          <SubmitGateSubmit>
            <ActionFormIdle>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                {mode === "update" ? (
                  <Message message="admin.series.form.update" />
                ) : (
                  <Message message="admin.series.form.create" />
                )}
              </Suspense>
            </ActionFormIdle>
            <ActionFormPending>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.form.submitting" />
              </Suspense>
            </ActionFormPending>
          </SubmitGateSubmit>
        </div>
      </SubmitGate>
    </ActionForm>
  );
};
