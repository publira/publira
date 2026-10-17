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
import { MAX_INT32 } from "#lib/int32";
import {
  maxPriceInputValue,
  priceInputStep,
  toPriceInputValue,
} from "#lib/price";

interface EpisodeRentalFieldsProps {
  /** ISO 4217 code of the currency the price is entered in, the tenant's. */
  currency: string;
  /** What renting the episode costs; 0 leaves the field blank, not rented. */
  initialRentalPrice: number;
  /**
   * The rental period the field starts at: the episode's own, or the series'
   * for an episode that is not rented. 0 leaves the field blank.
   */
  initialRentalPeriodHours: number;
}

/**
 * The rental an episode is sold on beside its permanent copy. Neither field is
 * required: a blank rental price is an episode that is not rented, whatever the
 * period says, which is what lets the period start at the series' default.
 */
export const EpisodeRentalFields = ({
  currency,
  initialRentalPrice,
  initialRentalPeriodHours,
}: EpisodeRentalFieldsProps) => (
  <>
    <Field>
      <FieldLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="admin.series.episodes.form.rental_price" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Input
          defaultValue={
            initialRentalPrice > 0
              ? toPriceInputValue(initialRentalPrice, currency)
              : ""
          }
          max={maxPriceInputValue(currency)}
          min={0}
          name="rental_price"
          step={priceInputStep(currency)}
          type="number"
        />
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message
              message="admin.series.episodes.form.rental_price_description"
              values={{ currency }}
            />
          </Suspense>
        </FieldDescription>
      </FieldContent>
    </Field>

    <Field>
      <FieldLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="admin.series.episodes.form.rental_period" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Input
          defaultValue={
            initialRentalPeriodHours > 0 ? initialRentalPeriodHours : ""
          }
          max={MAX_INT32}
          min={1}
          name="rental_period_hours"
          type="number"
        />
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.series.episodes.form.rental_period_description" />
          </Suspense>
        </FieldDescription>
      </FieldContent>
    </Field>
  </>
);
