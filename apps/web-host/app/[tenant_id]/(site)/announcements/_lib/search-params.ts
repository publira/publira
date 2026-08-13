import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

const announcementsListSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

interface ParseAnnouncementsListSearchParamsInput {
  token?: string | string[] | undefined;
}

export interface AnnouncementsListSearchParams {
  /** Empty on the first page. */
  token: string;
}

export const parseAnnouncementsListSearchParams = (
  input: ParseAnnouncementsListSearchParamsInput
): AnnouncementsListSearchParams =>
  announcementsListSearchParamsSchema.parse(input);

export const announcementsListHref = (token: string): string =>
  cursorPageHref("/announcements", token);
