/** The longest period one reconciliation covers, as the API bounds it. */
export const MAX_RECONCILIATION_DAYS = 366;

/** Inclusive calendar days (`YYYY-MM-DD`) of the tenant. */
export interface ReconciliationPeriod {
  endDate: string;
  startDate: string;
}

/**
 * The period the form starts at: the last whole calendar month before
 * `today`, which is the period a publisher closes its accounts over and the
 * one a provider's monthly report covers.
 */
export const previousMonth = (
  today: Temporal.PlainDate
): ReconciliationPeriod => {
  const firstOfMonth = today.with({ day: 1 });

  return {
    endDate: firstOfMonth.subtract({ days: 1 }).toString(),
    startDate: firstOfMonth.subtract({ months: 1 }).toString(),
  };
};

/**
 * What keeps a period from being reconciled before it is sent, or `null` for
 * one the API may still take. Whether it ends by today depends on the time
 * zone the API reads it in, so that is the API's to refuse.
 */
export const reconciliationPeriodProblem = ({
  endDate,
  startDate,
}: ReconciliationPeriod): "reversed" | "too_long" | null => {
  const start = Temporal.PlainDate.from(startDate);
  const end = Temporal.PlainDate.from(endDate);

  if (Temporal.PlainDate.compare(start, end) > 0) {
    return "reversed";
  }

  if (
    start.until(end, { largestUnit: "days" }).days + 1 >
    MAX_RECONCILIATION_DAYS
  ) {
    return "too_long";
  }

  return null;
};
