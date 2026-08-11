import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

const notificationsListSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

interface ParseNotificationsListSearchParamsInput {
  token?: string | string[] | undefined;
}

export interface NotificationsListSearchParams {
  /** Empty on the first page. */
  token: string;
}

export const parseNotificationsListSearchParams = (
  input: ParseNotificationsListSearchParamsInput
): NotificationsListSearchParams =>
  notificationsListSearchParamsSchema.parse(input);

export const notificationsListHref = (token: string): string =>
  cursorPageHref("/notifications", token);
