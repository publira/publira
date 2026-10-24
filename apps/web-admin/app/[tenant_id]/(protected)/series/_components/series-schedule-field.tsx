"use client";
import { Checkbox } from "@publira/ui-components/checkbox";
import { formatWeekdayName, WEEKDAY_NUMBERS } from "@publira/utils";
import {
  createContext,
  use,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { useAdminLocale } from "#components/admin-locale-context";

interface SeriesScheduleState {
  setValue: (update: (current: number[]) => number[]) => void;
  /** The checked weekdays, in ascending order. */
  value: number[];
}

const SeriesScheduleContext = createContext<SeriesScheduleState | null>(null);

const useSeriesSchedule = (): SeriesScheduleState => {
  const state = use(SeriesScheduleContext);
  if (!state) {
    throw new Error(
      "SeriesSchedule slots must be rendered inside a SeriesScheduleField."
    );
  }
  return state;
};

/**
 * The weekdays new episodes of the series come out on: a `fieldset` holding
 * `SeriesScheduleLegend`, `SeriesScheduleWeekdays`, the description, and
 * `SeriesScheduleEmpty`, which share the checked weekdays through it.
 */
const SeriesScheduleField = ({
  children,
  initialValue,
}: {
  children: ReactNode;
  initialValue: number[];
}) => {
  const [value, setValue] = useState(initialValue);
  const state = useMemo(() => ({ setValue, value }), [value]);

  return (
    <SeriesScheduleContext value={state}>
      <fieldset className="grid gap-2">{children}</fieldset>
    </SeriesScheduleContext>
  );
};

const SeriesScheduleLegend = ({ children }: { children: ReactNode }) => (
  <legend className="text-sm font-medium text-foreground">{children}</legend>
);

/** One checkbox per weekday, and the hidden fields that post the checked ones. */
const SeriesScheduleWeekdays = () => {
  const locale = useAdminLocale();
  const { setValue, value } = useSeriesSchedule();
  // One group of seven controls rather than seven fields, so the ids are
  // numbered off a single base and the legend names the whole set.
  const groupId = useId();
  const selected = new Set(value);

  const handleToggle = useCallback(
    (weekday: number, checked: boolean) => {
      setValue((current) => {
        const next = new Set(current);
        if (checked) {
          next.add(weekday);
        } else {
          next.delete(weekday);
        }
        return [...next].toSorted((a, b) => a - b);
      });
    },
    [setValue]
  );

  return (
    <>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {WEEKDAY_NUMBERS.map((weekday) => (
          <div className="flex items-center gap-2" key={weekday}>
            <Checkbox
              checked={selected.has(weekday)}
              id={`${groupId}-${weekday}`}
              onCheckedChange={(checked) => handleToggle(weekday, checked)}
            />
            <label
              className="text-sm text-foreground"
              htmlFor={`${groupId}-${weekday}`}
            >
              {/* A weekday is calendar data, so it comes from `Intl` in the
                  console's locale rather than from the catalog. */}
              {formatWeekdayName(weekday, { locale, style: "short" })}
            </label>
          </div>
        ))}
      </div>
      {value.map((weekday) => (
        <input
          key={weekday}
          name="schedule_weekdays"
          type="hidden"
          value={String(weekday)}
        />
      ))}
    </>
  );
};

/** Its children, shown only while no weekday is checked. */
const SeriesScheduleEmpty = ({ children }: { children: ReactNode }) => {
  const { value } = useSeriesSchedule();

  return value.length === 0 ? children : null;
};

export {
  SeriesScheduleField as Root,
  SeriesScheduleEmpty as Empty,
  SeriesScheduleLegend as Legend,
  SeriesScheduleWeekdays as Weekdays,
};
