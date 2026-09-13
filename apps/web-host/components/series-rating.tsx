import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMySeriesRating } from "#lib/series-rating";

const formatAverage = (average: number, locale: Locale) =>
  average.toLocaleString(toIntlLocale(locale), {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });

export const MySeriesRating = async ({
  tenantId,
  seriesPublicId,
  locale,
}: {
  tenantId: string;
  seriesPublicId: string;
  locale: Locale;
}) => {
  const average = await getMySeriesRating(tenantId, seriesPublicId);
  return average === null ? null : (
    <span className="tabular-nums">
      <Message
        message="host.series.rating.own"
        values={{ average: formatAverage(average, locale) }}
      />
    </span>
  );
};

export const SeriesRating = ({
  average,
  count,
  locale,
  children,
}: {
  average: number;
  count: number;
  locale: Locale;
  children?: ReactNode;
}) => (
  <div className="grid gap-1 text-sm text-muted-foreground">
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {count > 0 && (
        <span className="tabular-nums">
          <Suspense fallback={null}>
            <Message
              message="host.series.rating.public"
              values={{
                average: formatAverage(average, locale),
                count: count.toLocaleString(toIntlLocale(locale)),
              }}
            />
          </Suspense>
        </span>
      )}
      {children}
    </div>
    <p>
      <Suspense fallback={null}>
        <Message message="host.series.rating.explanation" />
      </Suspense>
    </p>
  </div>
);
