import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import { MAX_INT32 } from "#lib/int32";
import {
  maxPriceInputValue,
  priceInputStep,
  toPriceInputValue,
} from "#lib/price";
import type { SurfaceAvailabilityValue } from "#lib/surface-availability";

import type { EpisodeActionState } from "../episode-types";
import { EpisodeAvailabilityField } from "./episode-availability-field";
import { EpisodePurchaseAvailabilityField } from "./episode-purchase-availability-field";
import { EpisodeRentalFields } from "./episode-rental-fields";
import { PublishAtInput } from "./publish-at-input";

interface EpisodeFormProps {
  /** ISO 4217 code of the currency the price is entered in, the tenant's. */
  currency: string;
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
  /** The series' rental period, which the episode's field starts at. */
  seriesRentalPeriodHours: number;
  tenantId: string;
  timeZone: string;
}

/** Awaits the catalog for the title's placeholder, which is an attribute rather than a node. */
export const EpisodeForm = async ({
  currency,
  seriesId,
  seriesPublicId,
  action,
  seriesAvailability,
  seriesPurchaseAvailability,
  seriesReadingPeriodHours,
  seriesRentalPeriodHours,
  tenantId,
  timeZone,
}: EpisodeFormProps) => {
  const t = await getMessages();

  return (
    <ActionForm.Root action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_id" type="hidden" value={seriesId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />

      <ActionForm.Fieldset className="grid gap-4">
        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.series.episodes.form.title" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              name="title"
              placeholder={t("admin.series.episodes.form.title_placeholder")}
              required
              type="text"
            />
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.series.episodes.form.price" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={toPriceInputValue(0, currency)}
              max={maxPriceInputValue(currency)}
              min={0}
              name="price"
              required
              step={priceInputStep(currency)}
              type="number"
            />
            <input name="price_currency" type="hidden" value={currency} />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message
                  message="admin.series.episodes.form.price_description"
                  values={{ currency }}
                />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.form.reading_period" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={seriesReadingPeriodHours}
              max={MAX_INT32}
              min={0}
              name="reading_period_hours"
              required
              type="number"
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.series.episodes.form.reading_period_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <EpisodeRentalFields
          currency={currency}
          initialRentalPeriodHours={seriesRentalPeriodHours}
          initialRentalPrice={0}
        />

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
      </ActionForm.Fieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.series.episodes.form.create" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.series.episodes.form.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  );
};
