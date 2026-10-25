import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

export type SortOrder = "asc" | "desc";

export interface SortState<C extends string> {
  column: C;
  order: SortOrder;
}

/**
 * The columns a table sorts by, each with the order a first click on it sorts
 * in: a figure highest first, since that is what a reader looks for in a
 * report, and a date, a page, or a title in its natural order. A table that
 * shows some of a screen's columns names those alone.
 */
export type SortColumns<C extends string> = Readonly<
  Partial<Record<C, SortOrder>>
>;

const firstOrder = <C extends string>(
  columns: SortColumns<C>,
  column: C
): SortOrder => columns[column] ?? "asc";

/**
 * `sort` and `order` from the URL. A column the table does not have falls back
 * to `fallback`, and a missing or unknown order to the column's first order, so
 * a hand-edited URL still renders the table.
 */
export const parseSortSearchParams = <C extends string>(
  input: { order?: SearchParamValue; sort?: SearchParamValue },
  columns: SortColumns<C>,
  fallback: C
): SortState<C> => {
  const parsed = z
    .object({
      order: searchParamEnum<SortOrder, "">(["asc", "desc"], { fallback: "" }),
      sort: searchParamEnum<C, C>(Object.keys(columns) as C[], { fallback }),
    })
    .parse(input);

  return {
    column: parsed.sort,
    order: parsed.order || firstOrder(columns, parsed.sort),
  };
};

/**
 * The sort a click on `column`'s heading leads to: the other order of the
 * column already sorted by, or the first order of another column.
 */
export const nextSort = <C extends string>(
  current: SortState<C>,
  column: C,
  columns: SortColumns<C>
): SortState<C> => {
  if (current.column !== column) {
    return { column, order: firstOrder(columns, column) };
  }
  return { column, order: current.order === "asc" ? "desc" : "asc" };
};

/** The query parameters that name `state`. */
export const sortSearchParams = <C extends string>(
  state: SortState<C>
): { order: SortOrder; sort: C } => ({
  order: state.order,
  sort: state.column,
});

/**
 * `rows` ordered by `state`. Titles are compared the way `locale` orders words
 * and figures as numbers. The sort is stable, so rows that tie keep the order
 * the API answered them in.
 */
export const sortRows = <T, C extends string>(
  rows: readonly T[],
  state: SortState<C>,
  value: (row: T, column: C) => number | string,
  locale: Locale
): T[] => {
  const collator = new Intl.Collator(toIntlLocale(locale), {
    numeric: true,
  });
  const direction = state.order === "asc" ? 1 : -1;

  return rows.toSorted((left, right) => {
    const a = value(left, state.column);
    const b = value(right, state.column);
    const compared =
      typeof a === "number" && typeof b === "number"
        ? a - b
        : collator.compare(String(a), String(b));
    return compared * direction;
  });
};
