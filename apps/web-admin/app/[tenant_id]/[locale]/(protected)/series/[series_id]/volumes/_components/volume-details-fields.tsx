import * as Field from "@publira/ui-components/field";
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
    <Field.Root>
      <Field.Label required>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.series.volumes.form.title" />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Input
          defaultValue={initialTitle}
          maxLength={255}
          name="title"
          required
        />
      </Field.Content>
    </Field.Root>

    <Field.Root>
      <Field.Label required>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.series.volumes.form.price" />
        </Suspense>
      </Field.Label>
      <Field.Content>
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
        <Field.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message
              message="admin.series.volumes.form.price_description"
              values={{ currency }}
            />
          </Suspense>
        </Field.Description>
      </Field.Content>
    </Field.Root>
  </>
);
