"use client";

import { Select } from "@publira/ui-components/select";
import type { SelectProps } from "@publira/ui-components/select";
import type { ReactNode } from "react";
import { createContext, use, useCallback, useMemo, useState } from "react";

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

type SpreadStartSource = "episode" | "series";

const isSpreadStartSource = (value: string): value is SpreadStartSource =>
  value === "episode" || value === "series";

interface SpreadStartSourceState {
  setValue: (next: SpreadStartSource) => void;
  value: SpreadStartSource;
}

const SpreadStartSourceContext = createContext<SpreadStartSourceState | null>(
  null
);

const useSpreadStartSource = (): SpreadStartSourceState => {
  const state = use(SpreadStartSourceContext);
  if (!state) {
    throw new Error(
      "SpreadStartSource slots must be rendered inside a SpreadStartSourceField."
    );
  }
  return state;
};

/**
 * Whether the episode follows its series' spread start or names its own.
 * Holds the choice for `SpreadStartSourceSelect`, which the caller places in a
 * `Field` with its label and description, and for `SpreadStartPageField`,
 * which shows the page the episode names while it names one.
 */
export const SpreadStartSourceField = ({
  children,
  initialValue,
}: {
  children: ReactNode;
  initialValue: SpreadStartSource;
}) => {
  const [value, setValue] = useState(() => initialValue);
  const state = useMemo(() => ({ setValue, value }), [value]);

  return (
    <SpreadStartSourceContext value={state}>
      {children}
    </SpreadStartSourceContext>
  );
};

/**
 * The choice, and the hidden field that posts it. An episode with no pages has
 * none to name, so following is its only option.
 */
export const SpreadStartSourceSelect = ({
  hasNoPages,
  seriesSpreadStartPage,
}: {
  hasNoPages: boolean;
  seriesSpreadStartPage?: number;
}) => {
  const t = useClientMessages();
  const { setValue, value } = useSpreadStartSource();

  const handleValueChange = useCallback(
    (next: string) => {
      if (isSpreadStartSource(next)) {
        setValue(next);
      }
    },
    [setValue]
  );

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

  return (
    <>
      <Select items={items} onValueChange={handleValueChange} value={value} />
      <input name="spread_start_source" type="hidden" value={value} />
    </>
  );
};

/** Its children, the page field, shown only while the episode names its own. */
export const SpreadStartPageField = ({ children }: { children: ReactNode }) => {
  const { value } = useSpreadStartSource();

  return value === "episode" ? children : null;
};
