import {
  searchParamBoolean,
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import type { z } from "zod";

import type { SeriesListOrder, SeriesSerializationStatus } from "./catalog";

/**
 * The sorts and filters three screens share — the series list, a genre page,
 * and a tag page — as they are written in a URL.
 *
 * They live here rather than in one of those screens' `_lib/search-params.ts`
 * because the wording of a query key is a contract between them: a reader who
 * changes the sort on `/series` and then follows a genre chip expects the sort
 * to mean the same thing on the other side of the link. Each screen still owns
 * its own schema and its own href builder, which is where its extra keys and
 * its own path go.
 */

/**
 * The vocabulary the schemas below accept. The filter form writes each option
 * out as its own `<option>` with its own catalog key, so these lists are the
 * boundary's own copy rather than something a control maps over.
 */
const SERIES_LIST_ORDERS = [
  "newest",
  "updated",
  "title",
] as const satisfies readonly SeriesListOrder[];

const SERIES_STATUS_FILTERS = [
  "ongoing",
  "completed",
  "hiatus",
] as const satisfies readonly SeriesSerializationStatus[];

/** Absent, unknown, or repeated means the default sort rather than a rejection. */
export const seriesOrderSchema = searchParamEnum(SERIES_LIST_ORDERS, {
  fallback: "newest" as const,
});

/**
 * The same three sorts on the search screen, where an absent `order` is not
 * the newest first but the search's own order: the server ranks the hits on a
 * backend that can, and sorts them by title on one that cannot. A sort a reader
 * chose is written out, `newest` included, so `order=newest` means the newest
 * first on every screen that carries it.
 */
export const seriesSearchOrderSchema = searchParamEnum(SERIES_LIST_ORDERS, {
  fallback: "" as const,
});

/** Empty is every state, which is what a list nobody narrowed holds. */
export const seriesStatusFilterSchema = searchParamEnum(SERIES_STATUS_FILTERS, {
  fallback: "" as const,
});

/** `free=1` is what the checkbox in the filter form submits. */
export const seriesFreeFilterSchema = searchParamBoolean({ fallback: false });

/** public_id is 12 standard Base58 characters (server/internal/publicid). */
const genrePublicIdPattern = /^[1-9A-HJ-NP-Za-km-z]{12}$/u;

/**
 * Only the shape is checked here, and anything else normalizes to "no genre
 * filter" the way a malformed cursor token normalizes to the first page.
 * Whether a well-formed id names a genre of this tenant is the server's
 * answer, and the genre page asks it by resolving the id against the genre
 * list before it reads a single series.
 */
export const genreFilterSchema: z.ZodType<string, unknown> = searchParamString({
  fallback: "",
  maxLength: 12,
}).transform((value) => (genrePublicIdPattern.test(value) ? value : ""));

/** The sort and filters a list screen carries in its query, already validated. */
export interface SeriesListQuery {
  /** Empty applies no genre filter. Only the series list carries one. */
  genre?: string;
  order: SeriesListOrder;
  /** Empty applies no status filter. */
  status: SeriesSerializationStatus | "";
  /** Keep only the series a reader can start without paying. */
  free: boolean;
  /** Empty on the first page. */
  token: string;
}

/**
 * The sort and filters a keyword search of the series carries, already
 * validated. The keys are the series list's own, so a reader who narrowed one
 * screen reads the same words in the other's URL.
 */
export interface SeriesSearchFilters {
  /** Empty applies no genre filter. */
  genre: string;
  /** Empty is the search's own order. */
  order: SeriesListOrder | "";
  /** Empty applies no status filter. */
  status: SeriesSerializationStatus | "";
  /** Keep only the series a reader can start without paying. */
  free: boolean;
}

/** The search nobody narrowed: every series, in the search's own order. */
export const UNNARROWED_SERIES_SEARCH: SeriesSearchFilters = {
  free: false,
  genre: "",
  order: "",
  status: "",
};

/**
 * Whether a search sorts or narrows the series. Only the series group has a
 * genre, a serialization status, or a price, so a search that names any of
 * them answers with that group alone.
 */
export const isNarrowedSeriesSearch = ({
  free,
  genre,
  order,
  status,
}: SeriesSearchFilters): boolean =>
  free || genre.length > 0 || order.length > 0 || status.length > 0;

/**
 * Write `filters` into `params` under the series list's keys, leaving out each
 * one that is not set so the unnarrowed search keeps a single address.
 */
export const appendSeriesSearchFilters = (
  params: URLSearchParams,
  { free, genre, order, status }: SeriesSearchFilters
): void => {
  if (genre) {
    params.set("genre", genre);
  }

  if (order) {
    params.set("order", order);
  }

  if (status) {
    params.set("status", status);
  }

  if (free) {
    params.set("free", "1");
  }
};

/**
 * The URL of one state of a list screen.
 *
 * A default is left out of the query rather than spelled into it, so the
 * unnarrowed list has one address, and `pathname` stays absolute for the
 * reason `cursorPageHref` states: a relative `.` resolves against `/series` as
 * a file and would land on the site root.
 */
export const seriesListQueryHref = (
  pathname: string,
  { free, genre = "", order, status, token }: SeriesListQuery
): string => {
  const params = new URLSearchParams();

  if (genre) {
    params.set("genre", genre);
  }

  if (order !== "newest") {
    params.set("order", order);
  }

  if (status) {
    params.set("status", status);
  }

  if (free) {
    params.set("free", "1");
  }

  if (token) {
    params.set("token", token);
  }

  const serialized = params.toString();

  return serialized.length > 0 ? `${pathname}?${serialized}` : pathname;
};
