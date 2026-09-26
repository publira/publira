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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { formatWeekdayName, WEEKDAY_NUMBERS } from "@publira/utils";
import { useCallback, useId, useMemo, useState } from "react";
import type { ChangeEventHandler, KeyboardEventHandler } from "react";

import { useAdminLocale } from "#components/admin-locale-context";
import { ClientMessage, useClientMessages } from "#components/client-message";
import { CATALOG_NAME_MAX_LENGTH } from "#lib/catalog-name";
import { MAX_SERIES_TAGS } from "#lib/series-classification";
import type {
  SeriesAgeRatingValue,
  SeriesStatusValue,
} from "#lib/series-classification";

export interface GenreOption {
  publicId: string;
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

export const SeriesStatusField = ({
  onChange,
  value,
}: {
  onChange: (next: SeriesStatusValue) => void;
  value: SeriesStatusValue;
}) => {
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  const handleValueChange = useCallback(
    (next: string) => {
      // The trigger only ever offers the three above; the guard is what keeps
      // the state's type honest without a cast.
      if (next === "ongoing" || next === "completed" || next === "hiatus") {
        onChange(next);
      }
    },
    [onChange]
  );

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>
        <ClientMessage message="admin.series.form.status" />
      </FieldLabel>
      <FieldContent>
        <Select
          id={selectId}
          items={SERIES_STATUS_ITEMS}
          onValueChange={handleValueChange}
          value={value}
        />
        <input name="status" type="hidden" value={value} />
        <FieldDescription>
          <ClientMessage message="admin.series.form.status_description" />
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};

export const SeriesAgeRatingField = ({
  onChange,
  value,
}: {
  onChange: (next: SeriesAgeRatingValue) => void;
  value: SeriesAgeRatingValue;
}) => {
  const selectId = useId();

  const handleValueChange = useCallback(
    (next: string) => {
      if (next === "all" || next === "r15" || next === "r18") {
        onChange(next);
      }
    },
    [onChange]
  );

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>
        <ClientMessage message="admin.series.form.age_rating" />
      </FieldLabel>
      <FieldContent>
        <Select
          id={selectId}
          items={SERIES_AGE_RATING_ITEMS}
          onValueChange={handleValueChange}
          value={value}
        />
        <input name="age_rating" type="hidden" value={value} />
        {/* What each rating means, so the choice is made from the form rather
            than from the guide. */}
        <ul className="grid gap-1 text-xs text-muted-foreground">
          <li>
            <ClientMessage message="admin.series.form.age_rating_all_hint" />
          </li>
          <li>
            <ClientMessage message="admin.series.form.age_rating_r15_hint" />
          </li>
          <li>
            <ClientMessage message="admin.series.form.age_rating_r18_hint" />
          </li>
        </ul>
      </FieldContent>
    </Field>
  );
};

export const SeriesScheduleField = ({
  onChange,
  value,
}: {
  onChange: (next: number[]) => void;
  value: number[];
}) => {
  const locale = useAdminLocale();
  // One group of seven controls rather than seven fields, so the ids are
  // numbered off a single base and the legend names the whole set.
  const groupId = useId();
  const selected = new Set(value);

  const handleToggle = useCallback(
    (weekday: number, checked: boolean) => {
      const next = new Set(value);
      if (checked) {
        next.add(weekday);
      } else {
        next.delete(weekday);
      }
      onChange([...next].toSorted((a, b) => a - b));
    },
    [onChange, value]
  );

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-foreground">
        <ClientMessage message="admin.series.form.schedule" />
      </legend>
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
      <p className="text-xs text-muted-foreground">
        <ClientMessage message="admin.series.form.schedule_description" />
      </p>
      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <ClientMessage message="admin.series.form.schedule_irregular" />
        </p>
      ) : null}
    </fieldset>
  );
};

export const SeriesGenreField = ({
  genres,
  genresErrorMessage,
  onChange,
  value,
}: {
  genres: GenreOption[];
  genresErrorMessage?: string;
  onChange: (next: string[]) => void;
  value: string[];
}) => {
  // `MultiCombobox` renders its own input instead of a Field control, so the
  // label needs an id to point at.
  const t = useClientMessages();
  const comboboxId = useId();
  // The tenant's own order, which is the order a series presents them in; only
  // the option list is built here.
  const items = useMemo<MultiComboboxItem[]>(
    () => genres.map((genre) => ({ label: genre.name, value: genre.publicId })),
    [genres]
  );

  return (
    <Field>
      <FieldLabel htmlFor={comboboxId}>
        <ClientMessage message="admin.series.form.genres" />
      </FieldLabel>
      <FieldContent>
        {genresErrorMessage ? (
          <FormMessage variant="destructive">{genresErrorMessage}</FormMessage>
        ) : null}

        {items.length === 0 ? (
          <FieldDescription>
            <ClientMessage message="admin.series.form.genres_empty" />
          </FieldDescription>
        ) : (
          <MultiCombobox
            id={comboboxId}
            items={items}
            onValueChange={onChange}
            value={value}
          >
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

        {value.map((publicId) => (
          <input
            key={publicId}
            name="genre_public_ids"
            type="hidden"
            value={publicId}
          />
        ))}

        <FieldDescription>
          <ClientMessage message="admin.series.form.genres_description" />
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};

/**
 * Two names are the same tag when they differ only by case or by the spaces
 * around them — the API derives a tag's slug that way — so the field refuses
 * the second one instead of posting a pair the server would silently merge.
 */
const sameTagName = (left: string, right: string): boolean =>
  left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();

export const SeriesTagField = ({
  onChange,
  suggestions,
  suggestionsErrorMessage,
  value,
}: {
  onChange: (next: string[]) => void;
  suggestions: string[];
  suggestionsErrorMessage?: string;
  value: string[];
}) => {
  const locale = useAdminLocale();
  const inputId = useId();
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
      onChange([...value, name]);
    }
    setDraft("");
  }, [draft, isFull, onChange, value]);

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

  const handleRemove = useCallback(
    (tagName: string) => {
      onChange(value.filter((current) => current !== tagName));
    },
    [onChange, value]
  );

  return (
    <Field>
      <FieldLabel htmlFor={inputId}>
        <ClientMessage message="admin.series.form.tags" />
      </FieldLabel>
      <FieldContent>
        {suggestionsErrorMessage ? (
          <FormMessage variant="destructive">
            {suggestionsErrorMessage}
          </FormMessage>
        ) : null}

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
            id={inputId}
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

        <FieldDescription>
          <ClientMessage
            message="admin.series.form.tags_description"
            values={{ count: String(MAX_SERIES_TAGS) }}
          />
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};
