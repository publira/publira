"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense, useCallback, useId } from "react";

import { ClientMessage } from "#components/client-message";
import { isReadingDirectionValue } from "#lib/reading-layout";
import type { ReadingDirectionValue } from "#lib/reading-layout";

/**
 * `SelectProps["items"]` takes a `ReactNode` label, so each option keeps a
 * boundary of its own rather than the trigger waiting on the whole catalog.
 */
const READING_DIRECTION_ITEMS = [
  {
    label: (
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <ClientMessage message="admin.series.form.reading_direction_options.rtl" />
      </Suspense>
    ),
    value: "rtl",
  },
  {
    label: (
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <ClientMessage message="admin.series.form.reading_direction_options.ltr" />
      </Suspense>
    ),
    value: "ltr",
  },
];

export const SeriesReadingDirectionField = ({
  onChange,
  value,
}: {
  onChange: (next: ReadingDirectionValue) => void;
  value: ReadingDirectionValue;
}) => {
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  const handleValueChange = useCallback(
    (next: string) => {
      if (isReadingDirectionValue(next)) {
        onChange(next);
      }
    },
    [onChange]
  );

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <ClientMessage message="admin.series.form.reading_direction" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Select
          id={selectId}
          items={READING_DIRECTION_ITEMS}
          onValueChange={handleValueChange}
          value={value}
        />
        <input name="reading_direction" type="hidden" value={value} />
        <FieldDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <ClientMessage message="admin.series.form.reading_direction_description" />
          </Suspense>
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};

/**
 * No upper bound: a series states it for episodes of every length, and one
 * shorter than the page named here is shown without spreads.
 */
export const SeriesSpreadStartField = ({
  defaultPage,
}: {
  defaultPage: number;
}) => (
  <Field>
    <FieldLabel required>
      <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
        <ClientMessage message="admin.series.form.spread_start" />
      </Suspense>
    </FieldLabel>
    <FieldContent>
      <Input
        defaultValue={defaultPage}
        min={1}
        name="spread_start_page"
        required
        step={1}
        type="number"
      />
      <FieldDescription>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <ClientMessage message="admin.series.form.spread_start_description" />
        </Suspense>
      </FieldDescription>
    </FieldContent>
  </Field>
);
