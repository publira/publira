import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

export const defaultNotificationsPageSize = 20;

type QueryParamValue = string | string[] | undefined;

interface ParseNotificationsSearchParamsInput {
  token?: QueryParamValue;
}

export interface NotificationsSearchParams {
  token: string;
}

const notificationsSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

export const parseNotificationsSearchParams = (
  input: ParseNotificationsSearchParamsInput
): NotificationsSearchParams => notificationsSearchParamsSchema.parse(input);

export const buildNotificationsPath = ({
  token,
}: NotificationsSearchParams): string =>
  cursorPageHref("/notifications", token);
