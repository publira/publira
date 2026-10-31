"use client";

import { formatDuration } from "@publira/utils";
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { ClientMessage } from "#components/client-message";
import { useLocale } from "#components/locale-context";
import { minutesUntil } from "#lib/minutes-until";

const MINUTES_PER_HOUR = 60;

/** How often the clock is read: often enough that the last minute ends on time. */
const TICK_MS = 1000;

const subscribeToClock = (onTick: () => void) => {
  const timer = setInterval(onTick, TICK_MS);

  return () => clearInterval(timer);
};

/** The server has no clock worth reading: see {@link WaitFreeCountdown}. */
const noMinutesOnServer = () => null;

/**
 * How long until the reader's next wait-for-free ticket is ready, counted down
 * against the reader's own clock, and `children` — the way to use it — once it
 * is.
 *
 * The server states the instant instead (`absolute`, already written in the
 * tenant's time zone), for the reason `RelativeTime` gives: a duration measured
 * while rendering is wrong as soon as it is read. The browser then replaces it
 * with the remaining time and reads its clock every second, so the ticket's
 * control appears on the minute it is ready rather than on the next visit.
 */
export const WaitFreeCountdown = ({
  absolute,
  children,
  nextAvailableAt,
}: {
  /** The instant the ticket is ready, worded as a date in the tenant's zone. */
  absolute: string;
  /** Rendered once the ticket is ready. */
  children: ReactNode;
  /** RFC3339 instant the ticket is ready. */
  nextAvailableAt: string;
}) => {
  const locale = useLocale();

  const minutesLeft = useSyncExternalStore(
    subscribeToClock,
    () => minutesUntil(nextAvailableAt, Temporal.Now.instant()),
    noMinutesOnServer
  );

  if (minutesLeft === 0) {
    return children;
  }

  if (minutesLeft === null) {
    return (
      <p className="text-sm">
        <ClientMessage
          message="storefront.episode.gate.wait_free_recharging_at"
          values={{ date: absolute }}
        />
      </p>
    );
  }

  return (
    <p className="text-sm tabular-nums">
      <ClientMessage
        message="storefront.episode.gate.wait_free_recharging_in"
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
