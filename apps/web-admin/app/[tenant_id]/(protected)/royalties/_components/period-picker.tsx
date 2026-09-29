import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

interface PeriodPickerProps {
  /** The month on screen. */
  period: string;
  /** The latest month that can be previewed: the current one. */
  maxPeriod: string;
}

/**
 * Opens another month that is not closed yet, such as one left behind before
 * the months that came after it were closed.
 */
export const PeriodPicker = ({ maxPeriod, period }: PeriodPickerProps) => (
  <form className="flex flex-wrap items-end gap-2">
    <Field>
      <FieldLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.royalties.open.picker_label" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Input
          defaultValue={period}
          max={maxPeriod}
          name="period"
          required
          type="month"
        />
      </FieldContent>
    </Field>
    <Button type="submit" variant="outline">
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <Message message="admin.royalties.open.picker_submit" />
      </Suspense>
    </Button>
  </form>
);
