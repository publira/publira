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

/**
 * The shape `catalogslug.FromName` produces: runs of letters, digits, and
 * combining marks joined by single hyphens, with no hyphen at either end.
 * Letters of every script survive there — a genre named "恋愛" keeps an
 * identity of its own — so this is not the ASCII path slug of a published
 * page, and a URL carrying one percent-encodes it like any other segment.
 */
const tagSlugSchema = z
  .string()
  .trim()
  .max(255)
  .regex(/^[\p{L}\p{N}\p{M}]+(?:-[\p{L}\p{N}\p{M}]+)*$/u);

const tagDetailParamsSchema = z.object({
  tag_slug: tagSlugSchema,
});

// The tag itself is the path rather than a field, so this screen carries the
// three filters that are still open to the reader.
const tagDetailSearchParamsSchema = z.object({
  free: seriesFreeFilterSchema,
  order: seriesOrderSchema,
  status: seriesStatusFilterSchema,
  token: cursorTokenSchema,
});

interface ParseTagDetailSearchParamsInput {
  free?: SearchParamValue;
  order?: SearchParamValue;
  status?: SearchParamValue;
  token?: SearchParamValue;
}

export type TagDetailSearchParams = SeriesListQuery;

export const parseTagDetailParams = (input: {
  tag_slug: string;
}): string | null => {
  const parsed = tagDetailParamsSchema.safeParse(input);
  return parsed.success ? parsed.data.tag_slug : null;
};

export const parseTagDetailSearchParams = (
  input: ParseTagDetailSearchParamsInput
): TagDetailSearchParams => tagDetailSearchParamsSchema.parse(input);

/** Whether the reader narrowed this tag, which is what the empty state says. */
export const isNarrowedTagSeries = ({
  free,
  status,
}: TagDetailSearchParams): boolean => free || status.length > 0;

/** A slug holds letters of every script, so the segment is encoded. */
export const tagDetailPath = (tagSlug: string): string =>
  `/tags/${encodeURIComponent(tagSlug)}`;

export const tagDetailHref = (
  tagSlug: string,
  query: TagDetailSearchParams
): string => seriesListQueryHref(tagDetailPath(tagSlug), query);
