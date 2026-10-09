import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import type { SurfaceAvailabilityValue } from "#lib/surface-availability";

import type { EpisodeActionState } from "../episode-types";
import { EpisodeAvailabilityField } from "./episode-availability-field";
import { EpisodePurchaseAvailabilityField } from "./episode-purchase-availability-field";
import { PublishAtInput } from "./publish-at-input";

interface EpisodeFormProps {
  seriesId: string;
  seriesPublicId: string;
  action: (
    prevState: EpisodeActionState,
    formData: FormData
  ) => Promise<EpisodeActionState>;
  /**
   * What the series is shown on, for the option that follows it. Absent when
   * that read failed.
   */
  seriesAvailability?: SurfaceAvailabilityValue;
  /**
   * Where the series sells, resolved through the tenant's default, for the
   * option that follows it. Absent when that could not be read.
   */
  seriesPurchaseAvailability?: SurfaceAvailabilityValue;
  /**
   * The series' reading period, which the episode's field starts at. The
   * episode stores the value it is created with, so changing the series later
   * leaves it alone.
   */
  seriesReadingPeriodHours: number;
  tenantId: string;
  timeZone: string;
}

/** Awaits the catalog for the title's placeholder, which is an attribute rather than a node. */
export const EpisodeForm = async ({
  seriesId,
  seriesPublicId,
  action,
  seriesAvailability,
  seriesPurchaseAvailability,
  seriesReadingPeriodHours,
  tenantId,
  timeZone,
}: EpisodeFormProps) => {
  const t = await getMessages();

  return (
    <ActionForm action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_id" type="hidden" value={seriesId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />

      <ActionFormFieldset className="grid gap-4">
        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.series.episodes.form.title" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              name="title"
              placeholder={t("admin.series.episodes.form.title_placeholder")}
              required
              type="text"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.series.episodes.form.price" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={0}
              min={0}
              name="price"
              required
              type="number"
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.series.episodes.form.price_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.form.reading_period" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={seriesReadingPeriodHours}
              min={0}
              name="reading_period_hours"
              required
              type="number"
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.series.episodes.form.reading_period_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <PublishAtInput timeZone={timeZone}>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message
              message="admin.series.episodes.form.publish_at_description"
              values={{ time_zone: timeZone }}
            />
          </Suspense>
        </PublishAtInput>

        <EpisodeAvailabilityField
          initialValue=""
          seriesAvailability={seriesAvailability}
        />

        <EpisodePurchaseAvailabilityField
          initialValue=""
          seriesPurchaseAvailability={seriesPurchaseAvailability}
        />
      </ActionFormFieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionFormSubmit>
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.series.episodes.form.create" />
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.series.episodes.form.submitting" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  );
};
