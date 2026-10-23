import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { MAX_INT32 } from "#lib/int32";
import {
  maxPriceInputValue,
  priceInputStep,
  toPriceInputValue,
} from "#lib/price";

import { EpisodeRentalFields } from "../../_components/episode-rental-fields";

interface EpisodePricingFormProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  /** ISO 4217 code of the currency the price is entered in, the tenant's. */
  currency: string;
  episodeId: string;
  episodePublicId: string;
  /**
   * The price the episode is sold at. Seeded once per mount, like
   * `initialReadingPeriodHours`: the page keys this form by both, so a saved
   * change remounts it.
   */
  initialPrice: number;
  initialReadingPeriodHours: number;
  /** 0 on an episode that is not rented. */
  initialRentalPrice: number;
  /**
   * The episode's rental period, or the series' for an episode that is not
   * rented.
   */
  initialRentalPeriodHours: number;
  seriesPublicId: string;
  tenantId: string;
}

export const EpisodePricingForm = ({
  action,
  currency,
  episodeId,
  episodePublicId,
  initialPrice,
  initialReadingPeriodHours,
  initialRentalPeriodHours,
  initialRentalPrice,
  seriesPublicId,
  tenantId,
}: EpisodePricingFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.series.episodes.pricing.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message message="admin.series.episodes.pricing.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    <ActionForm.Root action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="episode_public_id" type="hidden" value={episodePublicId} />

      <ActionForm.Fieldset className="grid gap-4">
        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.series.episodes.form.price" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={toPriceInputValue(initialPrice, currency)}
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
              defaultValue={initialReadingPeriodHours}
              max={MAX_INT32}
              min={0}
              name="reading_period_hours"
              required
              type="number"
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.series.episodes.pricing.reading_period_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <EpisodeRentalFields
          currency={currency}
          initialRentalPeriodHours={initialRentalPeriodHours}
          initialRentalPrice={initialRentalPrice}
        />
      </ActionForm.Fieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.episodes.pricing.update" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.series.episodes.updating" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </AdminSection>
);
