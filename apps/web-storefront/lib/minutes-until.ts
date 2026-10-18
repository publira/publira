import { parseInstant } from "@publira/utils";

const MINUTE_MS = 60_000;

/**
 * Whole minutes left until `instant`, rounded up so a countdown never reads
 * zero while there is still time left; 0 once it has passed, and `null` for a
 * value that is not an instant.
 */
export const minutesUntil = (
  instant: string,
  now: Temporal.Instant
): number | null => {
  const until = parseInstant(instant);
  if (!until) {
    return null;
  }
  const left = now.until(until).total({ unit: "millisecond" });
  return left > 0 ? Math.ceil(left / MINUTE_MS) : 0;
};
