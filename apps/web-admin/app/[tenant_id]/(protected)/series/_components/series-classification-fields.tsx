"use client";

import { toIntlLocale } from "@publira/i18n";
import { CloseIcon } from "@publira/icons";
import { Button } from "@publira/ui-components/button";
import { Checkbox } from "@publira/ui-components/checkbox";
import {
  ComboboxEmpty,
  ComboboxItems,
  ComboboxPopup,
  MultiCombobox,
  MultiComboboxChip,
  MultiComboboxChipRemove,
  MultiComboboxChips,
  MultiComboboxInput,
  MultiComboboxInputGroup,
} from "@publira/ui-components/combobox";
import type { MultiComboboxItem } from "@publira/ui-components/combobox";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { formatWeekdayName, WEEKDAY_NUMBERS } from "@publira/utils";
import {
  createContext,
  use,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";
import type {
  ChangeEventHandler,
  KeyboardEventHandler,
  ReactNode,
} from "react";

import { useAdminLocale } from "#components/admin-locale-context";
import { ClientMessage, useClientMessages } from "#components/client-message";
import { CATALOG_NAME_MAX_LENGTH } from "#lib/catalog-name";
import { MAX_SERIES_TAGS } from "#lib/series-classification";
import type {
  SeriesAgeRatingValue,
  SeriesStatusValue,
} from "#lib/series-classification";

export interface GenreOption {
  id: string;
  name: string;
}

const SERIES_STATUS_ITEMS = [
  {
    label: <ClientMessage message="admin.series.status.ongoing" />,
    value: "ongoing",
  },
  {
    label: <ClientMessage message="admin.series.status.completed" />,
    value: "completed",
  },
  {
    label: <ClientMessage message="admin.series.status.hiatus" />,
    value: "hiatus",
  },
];

const SERIES_AGE_RATING_ITEMS = [
  {
    label: <ClientMessage message="admin.series.age_rating.all" />,
    value: "all",
  },
  {
    label: <ClientMessage message="admin.series.age_rating.r15" />,
    value: "r15",
  },
  {
    label: <ClientMessage message="admin.series.age_rating.r18" />,
    value: "r18",
  },
];

/**
 * The series' publication status, and the hidden field that posts it. The
 * caller places it in a `Field` and writes the label and the description there.
 */
export const SeriesStatusSelect = ({
  initialValue,
}: {
  initialValue: SeriesStatusValue;
}) => {
  const [value, setValue] = useState(initialValue);

  const handleValueChange = useCallback((next: string) => {
    // The trigger only ever offers the three above; the guard is what keeps
    // the state's type honest without a cast.
    if (next === "ongoing" || next === "completed" || next === "hiatus") {
      setValue(next);
    }
  }, []);

  return (
    <>
      <Select
        items={SERIES_STATUS_ITEMS}
        onValueChange={handleValueChange}
        value={value}
      />
      <input name="status" type="hidden" value={value} />
    </>
  );
};

/**
 * The series' age rating, and the hidden field that posts it. The caller
 * places it in a `Field` and writes the label and the description there.
 */
export const SeriesAgeRatingSelect = ({
  initialValue,
}: {
  initialValue: SeriesAgeRatingValue;
}) => {
  const [value, setValue] = useState(initialValue);

  const handleValueChange = useCallback((next: string) => {
    if (next === "all" || next === "r15" || next === "r18") {
      setValue(next);
    }
  }, []);

  return (
    <>
      <Select
        items={SERIES_AGE_RATING_ITEMS}
        onValueChange={handleValueChange}
        value={value}
      />
      <input name="age_rating" type="hidden" value={value} />
    </>
  );
};

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
export const SeriesScheduleField = ({
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

export const SeriesScheduleLegend = ({ children }: { children: ReactNode }) => (
  <legend className="text-sm font-medium text-foreground">{children}</legend>
);

/** One checkbox per weekday, and the hidden fields that post the checked ones. */
export const SeriesScheduleWeekdays = () => {
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
export const SeriesScheduleEmpty = ({ children }: { children: ReactNode }) => {
  const { value } = useSeriesSchedule();

  return value.length === 0 ? children : null;
};

/**
 * The genres the series is filed under, and the hidden fields that post them.
 * The caller places it in a `Field` and writes the label, the description,
 * and the reason the list could not be read there.
 *
 * With no genre to offer it draws no picker, and the caller writes the note
 * that stands in for one. The hidden fields stay either way: a list that
 * failed to load arrives empty, and the series' genres must survive the save.
 */
export const SeriesGenreCombobox = ({
  genres,
  initialValue,
}: {
  genres: GenreOption[];
  initialValue: string[];
}) => {
  const t = useClientMessages();
  const [value, setValue] = useState(initialValue);
  // The tenant's own order, which is the order a series presents them in; only
  // the option list is built here.
  const items = useMemo<MultiComboboxItem[]>(
    () => genres.map((genre) => ({ label: genre.name, value: genre.id })),
    [genres]
  );

  return (
    <>
      {items.length === 0 ? null : (
        <MultiCombobox items={items} onValueChange={setValue} value={value}>
          <MultiComboboxInputGroup>
            <MultiComboboxChips>
              {(selected) => (
                <>
                  {selected.map((item) => (
                    <MultiComboboxChip item={item} key={item.value}>
                      {item.label}
                      <MultiComboboxChipRemove
                        aria-label={t("admin.series.form.genres_remove")}
                      />
                    </MultiComboboxChip>
                  ))}
                  <MultiComboboxInput
                    placeholder={
                      selected.length > 0
                        ? ""
                        : t("admin.series.form.genres_search")
                    }
                  />
                </>
              )}
            </MultiComboboxChips>
          </MultiComboboxInputGroup>
          <ComboboxPopup>
            <ComboboxEmpty>
              <ClientMessage message="admin.series.form.genres_no_match" />
            </ComboboxEmpty>
            <ComboboxItems />
          </ComboboxPopup>
        </MultiCombobox>
      )}

      {value.map((id) => (
        <input key={id} name="genre_ids" type="hidden" value={id} />
      ))}
    </>
  );
};

/**
 * Two names are the same tag when they differ only by case or by the spaces
 * around them — the API derives a tag's slug that way — so the field refuses
 * the second one instead of posting a pair the server would silently merge.
 */
const sameTagName = (left: string, right: string): boolean =>
  left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();

/**
 * The tags the series carries, the box that adds one, and the hidden fields
 * that post them. The caller places it in a `Field` and writes the label, the
 * description, and the reason the suggestions could not be read there.
 */
export const SeriesTagInput = ({
  initialValue,
  suggestions,
}: {
  initialValue: string[];
  suggestions: string[];
}) => {
  const locale = useAdminLocale();
  const [value, setValue] = useState(initialValue);
  const suggestionsId = useId();
  const [draft, setDraft] = useState("");
  const isFull = value.length >= MAX_SERIES_TAGS;

  // The tags this series already carries are not offered again.
  const offered = useMemo(
    () =>
      suggestions
        .filter(
          (suggestion) =>
            !value.some((tagName) => sameTagName(tagName, suggestion))
        )
        .toSorted((a, b) => a.localeCompare(b, toIntlLocale(locale))),
    [locale, suggestions, value]
  );

  const handleDraftChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      setDraft(event.currentTarget.value);
    },
    []
  );

  const addDraft = useCallback(() => {
    const name = draft.trim();
    if (name.length === 0 || isFull) {
      return;
    }
    if (!value.some((tagName) => sameTagName(tagName, name))) {
      setValue([...value, name]);
    }
    setDraft("");
  }, [draft, isFull, value]);

  const handleDraftKeyDown = useCallback<
    KeyboardEventHandler<HTMLInputElement>
  >(
    (event) => {
      if (event.key !== "Enter") {
        return;
      }
      // Enter in a text field submits the form it sits in; here it commits the
      // tag being typed instead.
      event.preventDefault();
      addDraft();
    },
    [addDraft]
  );

  const handleRemove = useCallback((tagName: string) => {
    setValue((current) => current.filter((other) => other !== tagName));
  }, []);

  return (
    <>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {value.map((tagName) => (
            <li
              className="inline-flex items-center gap-1 rounded-control bg-muted px-2 py-1 text-xs"
              key={tagName}
            >
              {tagName}
              <button
                className="rounded-control p-0.5 transition-colors duration-state ease-state hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => handleRemove(tagName)}
                type="button"
              >
                <CloseIcon aria-hidden className="h-3 w-3" />
                <span className="sr-only">
                  <ClientMessage
                    message="admin.series.form.tags_remove"
                    values={{ name: tagName }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex gap-2">
        <Input
          disabled={isFull}
          list={suggestionsId}
          maxLength={CATALOG_NAME_MAX_LENGTH}
          onChange={handleDraftChange}
          onKeyDown={handleDraftKeyDown}
          type="text"
          value={draft}
        />
        <Button
          disabled={isFull || draft.trim().length === 0}
          onClick={addDraft}
          type="button"
          variant="outline"
        >
          <ClientMessage message="admin.series.form.tags_add" />
        </Button>
      </div>

      <datalist id={suggestionsId}>
        {offered.map((suggestion) => (
          <option key={suggestion}>{suggestion}</option>
        ))}
      </datalist>

      {value.map((tagName) => (
        <input key={tagName} name="tag_names" type="hidden" value={tagName} />
      ))}
    </>
  );
};
