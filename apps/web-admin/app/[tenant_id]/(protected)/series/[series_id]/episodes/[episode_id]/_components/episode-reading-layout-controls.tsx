"use client";

import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";
import type { SelectProps } from "@publira/ui-components/select";
import type { ReactNode } from "react";
import { useCallback, useId, useState } from "react";

import { useClientMessages } from "#components/client-message";
import { isReadingDirectionValue } from "#lib/reading-layout";
import type { ReadingDirectionValue } from "#lib/reading-layout";

/**
 * The first option names what the series is read in, and says only that it
 * follows the series when that read failed.
 */
const ReadingDirectionSelect = ({
  seriesDirection,
  ...props
}: Omit<SelectProps, "items"> & {
  seriesDirection?: ReadingDirectionValue;
}) => {
  const t = useClientMessages();

  let followSeries = t("admin.series.episodes.layout.follow_series");
  if (seriesDirection === "rtl") {
    followSeries = t("admin.series.episodes.layout.follow_series_direction", {
      direction: t("admin.series.form.reading_direction_options.rtl"),
    });
  } else if (seriesDirection === "ltr") {
    followSeries = t("admin.series.episodes.layout.follow_series_direction", {
      direction: t("admin.series.form.reading_direction_options.ltr"),
    });
  }

  return (
    <Select
      {...props}
      items={[
        { label: followSeries, value: "" },
        {
          label: t("admin.series.form.reading_direction_options.rtl"),
          value: "rtl",
        },
        {
          label: t("admin.series.form.reading_direction_options.ltr"),
          value: "ltr",
        },
      ]}
    />
  );
};

/** The empty value is the episode following its series. */
export const ReadingDirectionField = ({
  initialValue,
  label,
  seriesDirection,
}: {
  initialValue: "" | ReadingDirectionValue;
  label: ReactNode;
  seriesDirection?: ReadingDirectionValue;
}) => {
  const [value, setValue] = useState(() => initialValue);
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  const handleValueChange = useCallback((next: string) => {
    if (next === "" || isReadingDirectionValue(next)) {
      setValue(next);
    }
  }, []);

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
      <FieldContent>
        <ReadingDirectionSelect
          id={selectId}
          onValueChange={handleValueChange}
          seriesDirection={seriesDirection}
          value={value}
        />
        <input name="reading_direction" type="hidden" value={value} />
      </FieldContent>
    </Field>
  );
};

type SpreadStartSource = "episode" | "series";

const isSpreadStartSource = (value: string): value is SpreadStartSource =>
  value === "episode" || value === "series";

/**
 * An episode with no pages has none to name, so following is its only option.
 */
const SpreadStartSourceSelect = ({
  hasNoPages,
  seriesSpreadStartPage,
  ...props
}: Omit<SelectProps, "items"> & {
  hasNoPages: boolean;
  seriesSpreadStartPage?: number;
}) => {
  const t = useClientMessages();

  const followSeries =
    seriesSpreadStartPage === undefined
      ? t("admin.series.episodes.layout.follow_series")
      : t("admin.series.episodes.layout.follow_series_spread_start", {
          page: String(seriesSpreadStartPage),
        });
  const items = [{ label: followSeries, value: "series" }];
  if (!hasNoPages) {
    items.push({
      label: t("admin.series.episodes.layout.spread_start_override"),
      value: "episode",
    });
  }

  return <Select {...props} items={items} />;
};

/**
 * `pageField` is rendered after this field only while the episode sets its
 * own spread start.
 */
export const SpreadStartSourceField = ({
  description,
  hasNoPages,
  initialValue,
  label,
  pageField,
  seriesSpreadStartPage,
}: {
  description: ReactNode;
  hasNoPages: boolean;
  initialValue: SpreadStartSource;
  label: ReactNode;
  pageField: ReactNode;
  seriesSpreadStartPage?: number;
}) => {
  const [value, setValue] = useState(() => initialValue);
  const selectId = useId();

  const handleValueChange = useCallback((next: string) => {
    if (isSpreadStartSource(next)) {
      setValue(next);
    }
  }, []);

  return (
    <>
      <Field>
        <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
        <FieldContent>
          <SpreadStartSourceSelect
            hasNoPages={hasNoPages}
            id={selectId}
            onValueChange={handleValueChange}
            seriesSpreadStartPage={seriesSpreadStartPage}
            value={value}
          />
          <input name="spread_start_source" type="hidden" value={value} />
          {description}
        </FieldContent>
      </Field>
      {value === "episode" ? pageField : null}
    </>
  );
};
