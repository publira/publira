"use client";

import { formatRelativeTime } from "@publira/utils";
import { useSyncExternalStore } from "react";

import { useLocale } from "./locale-provider";

/** Nothing pushes a new value; the phrase is read once, when the browser has one. */
const subscribeToNothing = () => () => {
  // No teardown: there is no subscription to end.
};

const isHydrated = () => true;
const isFalseOnServer = () => false;

export interface RelativeTimeProps {
  /**
   * The same instant worded as a date, which is what the server renders. It
   * stays on screen for a reader whose JavaScript never runs, and it is what
   * the element's `title` carries once the phrase has replaced it.
   */
  absolute: string;
  /** IANA zone the calendar days are counted in: the tenant's display zone. */
  timeZone: string;
  /** The absolute timestamp, as the RPC returned it. */
  value: string;
}

/**
 * When something was published, worded against the reader's own clock: "3 days
 * ago", "yesterday", "2 hours ago".
 *
 * The phrase cannot be rendered on the server. This app runs with Cache
 * Components, so a section that reads only cached data is prerendered into the
 * static shell — and a phrase measured from `Temporal.Now` at prerender time
 * would stay "2 hours ago" for as long as that shell is served. The server
 * therefore states the date, which is true whenever it is read, and the
 * browser replaces it with the phrase.
 *
 * `useSyncExternalStore` rather than an Effect: the value the server rendered
 * and the value the browser renders differ on purpose, and this is the API
 * that says so, without copying either one into state.
 */
export const RelativeTime = ({
  absolute,
  timeZone,
  value,
}: RelativeTimeProps) => {
  const locale = useLocale();
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    isHydrated,
    isFalseOnServer
  );

  if (!hydrated) {
    return <time dateTime={value}>{absolute}</time>;
  }

  return (
    <time dateTime={value} title={absolute}>
      {formatRelativeTime(value, { fallback: absolute, locale, timeZone })}
    </time>
  );
};
