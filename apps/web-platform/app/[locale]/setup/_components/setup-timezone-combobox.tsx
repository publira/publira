"use client";

import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@publira/utils";
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { PlatformTimezoneCombobox } from "#components/platform-timezone-combobox";

/** Nothing pushes a new value: the browser's zone is read once, on hydration. */
const subscribeToNothing = () => () => {
  // No teardown: there is no subscription to end.
};

/**
 * The zone the browser runs in, the best guess at where the platform is
 * operated from. A browser that reports none, or one the API would refuse,
 * leaves the field on {@link DEFAULT_TIME_ZONE}.
 */
const readBrowserTimeZone = (): string => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return zone && isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
};

const readServerTimeZone = (): string => DEFAULT_TIME_ZONE;

/**
 * The setup form's default time zone, opening on the operator's own.
 *
 * The server has no way to know that zone, so it renders
 * {@link DEFAULT_TIME_ZONE}, which is also what a form submitted without
 * JavaScript saves. `useSyncExternalStore` rather than an Effect: the value the
 * server rendered and the one the browser renders differ on purpose, and this
 * is the API that says so. The combobox is remounted under the browser's zone
 * instead of being handed it as a new prop, since it keeps what the operator
 * picks in state of its own.
 */
export const SetupTimezoneCombobox = ({
  children,
}: {
  children: ReactNode;
}) => {
  const timezone = useSyncExternalStore(
    subscribeToNothing,
    readBrowserTimeZone,
    readServerTimeZone
  );

  return (
    <PlatformTimezoneCombobox initialTimezone={timezone} key={timezone}>
      {children}
    </PlatformTimezoneCombobox>
  );
};
