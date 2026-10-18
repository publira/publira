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
import {
  maxPriceInputValue,
  priceInputStep,
  toPriceInputValue,
} from "#lib/price";

interface VolumeDetailsFieldsProps {
  /** ISO 4217 code of the currency the price is entered in, the tenant's. */
  currency: string;
  /** Left out on the form that creates a volume, which starts empty. */
  initialPrice?: number;
  initialTitle?: string;
}

/**
 * The title and the price, which `CreateVolume` and `UpdateVolume` both take
 * together.
 */
export const VolumeDetailsFields = ({
  currency,
  initialPrice,
  initialTitle,
}: VolumeDetailsFieldsProps) => (
  <>
    <Field>
      <FieldLabel required>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.series.volumes.form.title" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Input
          defaultValue={initialTitle}
          maxLength={255}
          name="title"
          required
        />
      </FieldContent>
    </Field>

    <Field>
      <FieldLabel required>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.series.volumes.form.price" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Input
          defaultValue={
            initialPrice === undefined
              ? undefined
              : toPriceInputValue(initialPrice, currency)
          }
          max={maxPriceInputValue(currency)}
          min={priceInputStep(currency)}
          name="price"
          required
          step={priceInputStep(currency)}
          type="number"
        />
        <input name="price_currency" type="hidden" value={currency} />
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message
              message="admin.series.volumes.form.price_description"
              values={{ currency }}
            />
          </Suspense>
        </FieldDescription>
      </FieldContent>
    </Field>
  </>
);
