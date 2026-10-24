"use client";

import { Select } from "@publira/ui-components/select";
import type { ReactNode } from "react";
import { createContext, use, useCallback, useMemo, useState } from "react";

import { useClientMessages } from "#components/client-message";

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
const SpreadStartSourceField = ({
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
const SpreadStartSourceSelect = ({
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
const SpreadStartPageField = ({ children }: { children: ReactNode }) => {
  const { value } = useSpreadStartSource();

  return value === "episode" ? children : null;
};

export {
  SpreadStartSourceField as Root,
  SpreadStartPageField as PageField,
  SpreadStartSourceSelect as SourceSelect,
};
