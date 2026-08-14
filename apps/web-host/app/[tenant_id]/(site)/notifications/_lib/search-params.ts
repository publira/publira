import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

export const defaultNotificationsPageSize = 20;

interface ParseNotificationsSearchParamsInput {
  token?: string | string[] | undefined;
}

export interface NotificationsSearchParams {
  /** Empty on the first page. */
  token: string;
}

const notificationsSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

export const parseNotificationsSearchParams = (
  input: ParseNotificationsSearchParamsInput
): NotificationsSearchParams => notificationsSearchParamsSchema.parse(input);

export const notificationsListHref = (token: string): string =>
  cursorPageHref("/notifications", token);
