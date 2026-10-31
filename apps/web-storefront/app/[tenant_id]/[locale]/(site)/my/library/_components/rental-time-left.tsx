"use client";

import { formatDuration } from "@publira/utils";
import { useSyncExternalStore } from "react";

import { ClientMessage } from "#components/client-message";
import { useLocale } from "#components/locale-context";
import { minutesUntil } from "#lib/minutes-until";

const MINUTES_PER_HOUR = 60;

/**
 * How often the clock is read. The count is in whole minutes, so a reading
 * every few seconds keeps it within a minute of the truth.
 */
const TICK_MS = 5000;

const subscribeToClock = (onTick: () => void) => {
  const timer = setInterval(onTick, TICK_MS);

  return () => clearInterval(timer);
};

/** The server has no clock worth reading: see {@link RentalTimeLeft}. */
const noMinutesOnServer = () => null;

/**
 * How long a rental the reader holds still opens its episode, counted down
 * against the reader's own clock.
 *
 * The library states when the rental expires beside it, and that instant is
 * what the server renders: a duration measured while rendering is wrong as
 * soon as it is read, for the reason `RelativeTime` gives. This adds the time
 * left once the browser has a clock, and says nothing once it has run out,
 * when the expiry beside it says the rest until the next load moves the
 * rental to the history.
 */
export const RentalTimeLeft = ({ expiresAt }: { expiresAt: string }) => {
  const locale = useLocale();

  const minutesLeft = useSyncExternalStore(
    subscribeToClock,
    () => minutesUntil(expiresAt, Temporal.Now.instant()),
    noMinutesOnServer
  );

  if (!minutesLeft) {
    return null;
  }

  return (
    <p className="mt-1 text-xs tabular-nums">
      <ClientMessage
        message="storefront.library.rental_time_left"
        values={{
          duration: formatDuration(
            {
              hours: Math.floor(minutesLeft / MINUTES_PER_HOUR),
              minutes: minutesLeft % MINUTES_PER_HOUR,
            },
            { locale, style: "short" }
          ),
        }}
      />
    </p>
  );
};
