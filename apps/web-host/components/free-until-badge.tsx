import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTimeWithWeekday } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";

/**
 * How long a priced episode stays free: "Free until Sun, Oct 11, 11:59 PM",
 * where the price would otherwise be quoted.
 *
 * The end is written in the tenant's time zone, the one its editors scheduled
 * the period in, so the weekday on the badge is the one the campaign was
 * announced with. It is an absolute date rather than a countdown: the page is
 * a shared cache entry, and "2 days left" would stay two days left for as
 * long as that entry lives. The entry is dropped when the period ends, which
 * is what takes the badge down.
 */
export const FreeUntilBadge = ({
  freeUntil,
  locale,
  timeZone,
}: {
  /** RFC3339 end of the open free reading period. */
  freeUntil: string;
  locale: Locale;
  timeZone: string;
}) => (
  <Badge tone="success">
    <time dateTime={freeUntil}>
      <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
        <Message
          message="host.common.free_until"
          values={{
            date: formatDateTimeWithWeekday(freeUntil, {
              fallback: "",
              locale,
              timeZone,
            }),
          }}
        />
      </Suspense>
    </time>
  </Badge>
);
