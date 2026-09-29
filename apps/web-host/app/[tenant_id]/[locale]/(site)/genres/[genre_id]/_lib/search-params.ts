import type { SearchParamValue } from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-token";
import {
  seriesFreeFilterSchema,
  seriesListQueryHref,
  seriesOrderSchema,
  seriesStatusFilterSchema,
} from "#lib/series-filters";
import type { SeriesListQuery } from "#lib/series-filters";

// public_id is 12 standard Base58 characters (server/internal/publicid).
const genreIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{12}$/u);

const genreDetailParamsSchema = z.object({
  genre_id: genreIdSchema,
});

// The genre itself is the path rather than a field, so this screen carries the
// three filters that are still open to the reader.
const genreDetailSearchParamsSchema = z.object({
  free: seriesFreeFilterSchema,
  order: seriesOrderSchema,
  status: seriesStatusFilterSchema,
  token: cursorTokenSchema,
});

interface ParseGenreDetailSearchParamsInput {
  free?: SearchParamValue;
  order?: SearchParamValue;
  status?: SearchParamValue;
  token?: SearchParamValue;
}

export type GenreDetailSearchParams = SeriesListQuery;

export const parseGenreDetailParams = (input: {
  genre_id: string;
}): string | null => {
  const parsed = genreDetailParamsSchema.safeParse(input);
  return parsed.success ? parsed.data.genre_id : null;
};

export const parseGenreDetailSearchParams = (
  input: ParseGenreDetailSearchParamsInput
): GenreDetailSearchParams => genreDetailSearchParamsSchema.parse(input);

/** Whether the reader narrowed this genre, which is what the empty state says. */
export const isNarrowedGenreSeries = ({
  free,
  status,
}: GenreDetailSearchParams): boolean => free || status.length > 0;

export const genreDetailHref = (
  genreId: string,
  query: GenreDetailSearchParams
): string => seriesListQueryHref(`/genres/${genreId}`, query);
