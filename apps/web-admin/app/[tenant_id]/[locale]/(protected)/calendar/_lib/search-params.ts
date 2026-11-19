import { searchParamString } from "@publira/utils/search-params";
import { z } from "zod";

import { calendarMonthSchema } from "./month";

const calendarSearchParamsSchema = z.object({
  month: searchParamString({ fallback: "" }).transform((value) =>
    calendarMonthSchema.safeParse(value).success ? value : ""
  ),
});

export type CalendarSearchParams = z.output<typeof calendarSearchParamsSchema>;

/**
 * The month the operator asked for, or `""` when none was. Anything that is not
 * a `YYYY-MM` month falls back to the current one rather than failing the page.
 */
export const parseCalendarSearchParams = (input: {
  month?: string | string[];
}): CalendarSearchParams => calendarSearchParamsSchema.parse(input);
