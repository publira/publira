"use client";

import { Select } from "@publira/ui-components/select";
import type { SelectProps } from "@publira/ui-components/select";
import { useCallback, useState } from "react";

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

/**
 * The direction the episode is read in, and the hidden field that posts it.
 * The empty value is the episode following its series. The caller places it in
 * a `Field` and writes the label there.
 */
export const EpisodeReadingDirectionSelect = ({
  initialValue,
  seriesDirection,
}: {
  initialValue: "" | ReadingDirectionValue;
  seriesDirection?: ReadingDirectionValue;
}) => {
  const [value, setValue] = useState(() => initialValue);

  const handleValueChange = useCallback((next: string) => {
    if (next === "" || isReadingDirectionValue(next)) {
      setValue(next);
    }
  }, []);

  return (
    <>
      <ReadingDirectionSelect
        onValueChange={handleValueChange}
        seriesDirection={seriesDirection}
        value={value}
      />
      <input name="reading_direction" type="hidden" value={value} />
    </>
  );
};
