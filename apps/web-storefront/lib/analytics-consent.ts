"use client";

import { useSyncExternalStore } from "react";

import { consentSignals } from "./google-tag-scripts";

/** What a reader answered on the banner, as the cookie holds it. */
export type AnalyticsConsentAnswer = "denied" | "granted";

/**
 * Where a reader stands. `global_privacy_control` is a browser that sends
 * Global Privacy Control, which is taken as a refusal without asking and
 * without storing anything.
 */
export type AnalyticsConsentState =
  | AnalyticsConsentAnswer
  | "global_privacy_control"
  | "unanswered";

/**
 * Six months, after which a reader who declined is asked again, and one who
 * agreed confirms it.
 */
const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 183 * 24 * 60 * 60;

/**
 * Signal to this tab's subscribers. A cookie written by script fires no event
 * of its own; another tab's answer arrives on the channel below and is
 * re-dispatched here.
 */
const CHANGE_EVENT = "publira:analytics-consent";

/** Sent by **Cookie settings** in the footer for the banner to come back. */
const REOPEN_EVENT = "publira:analytics-consent-reopen";

const sendsGlobalPrivacyControl = (): boolean =>
  (navigator as Navigator & { globalPrivacyControl?: boolean })
    .globalPrivacyControl === true;

const isAnswer = (value: string): value is AnalyticsConsentAnswer =>
  value === "granted" || value === "denied";

const readStoredAnswer = (
  cookieName: string
): AnalyticsConsentAnswer | undefined => {
  for (const pair of document.cookie.split("; ")) {
    const separator = pair.indexOf("=");
    if (pair.slice(0, separator) === cookieName) {
      const value = pair.slice(separator + 1);
      return isAnswer(value) ? value : undefined;
    }
  }
  return undefined;
};

export const readAnalyticsConsent = (
  cookieName: string
): AnalyticsConsentState => {
  if (sendsGlobalPrivacyControl()) {
    return "global_privacy_control";
  }
  return readStoredAnswer(cookieName) ?? "unanswered";
};

/**
 * Google's `gtag()`. The tag reads a command off the `dataLayer` only as an
 * `arguments` object, never as an array, so the rest parameter cannot stand
 * in for it.
 */
// oxlint-disable-next-line func-style -- an arrow function has no `arguments`
function gtag(..._command: unknown[]): void {
  const page = window as Window & { dataLayer?: unknown[] };
  page.dataLayer ??= [];
  // oxlint-disable-next-line prefer-rest-params, sonarjs/arguments-usage -- see above
  page.dataLayer.push(arguments);
}

/**
 * What this document last told Google, read off its own `dataLayer`, or
 * `undefined` before the defaults have run. The cookie cannot answer this:
 * another tab may have changed it since this one last sent anything.
 */
const signalledConsent = (): AnalyticsConsentAnswer | undefined => {
  const { dataLayer = [] } = window as unknown as {
    dataLayer?: Record<number, unknown>[];
  };
  const command = dataLayer.findLast((entry) => entry[0] === "consent");
  if (!command) {
    return undefined;
  }
  return (command[2] as { analytics_storage?: string } | undefined)
    ?.analytics_storage === "granted"
    ? "granted"
    : "denied";
};

/**
 * Sends Google an `update` when `answer` differs from what this document last
 * told it. A refusal before any grant therefore sends nothing, since the
 * defaults already say `denied`. A document whose defaults have not run yet
 * is left alone: they read the stored answer themselves when they do.
 */
const signalConsent = (answer: AnalyticsConsentAnswer): void => {
  const signalled = signalledConsent();
  if (signalled === undefined || signalled === answer) {
    return;
  }
  if (answer === "granted" && sendsGlobalPrivacyControl()) {
    return;
  }
  gtag("consent", "update", consentSignals(answer));
};

/**
 * Carries an answer to the site's other tabs, which share the cookie but not
 * the `dataLayer`: a withdrawal in one tab has to reach a tag already running
 * in another.
 */
const CHANNEL_NAME = "publira:analytics-consent";

let channel: BroadcastChannel | undefined;

const openChannel = (): BroadcastChannel | undefined => {
  if (channel || typeof BroadcastChannel === "undefined") {
    return channel;
  }
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (typeof event.data === "string" && isAnswer(event.data)) {
      signalConsent(event.data);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
  });
  return channel;
};

/**
 * Stores the reader's answer and tells Google what changed, in this tab and
 * in every other tab of the site. Cookies the tag set before a withdrawal
 * stay until Google's own expiry, which the banner tells the reader.
 */
export const answerAnalyticsConsent = (
  cookieName: string,
  answer: AnalyticsConsentAnswer
): void => {
  // oxlint-disable-next-line unicorn/no-document-cookie -- the answer decides what this page loads now, before any request could carry it
  document.cookie = [
    `${cookieName}=${answer}`,
    `Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");

  signalConsent(answer);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  openChannel()?.postMessage(answer);
};

const subscribe = (onChange: () => void): (() => void) => {
  openChannel();
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
};

/**
 * Where the reader stands, or `null` until the browser has been read: on
 * the server, and while the page hydrates. Nothing a page renders on the
 * server can depend on the answer, so the HTML is the same for every reader
 * and the route keeps its static shell.
 */
export const useAnalyticsConsent = (
  cookieName: string
): AnalyticsConsentState | null =>
  useSyncExternalStore(
    subscribe,
    () => readAnalyticsConsent(cookieName),
    () => null
  );

export const reopenAnalyticsConsentBanner = (): void => {
  window.dispatchEvent(new Event(REOPEN_EVENT));
};

/**
 * Calls `onReopen` whenever **Cookie settings** asks for the banner. Returns
 * the unsubscribe, for an Effect to hand back.
 */
export const onAnalyticsConsentBannerReopen = (
  onReopen: () => void
): (() => void) => {
  window.addEventListener(REOPEN_EVENT, onReopen);
  return () => {
    window.removeEventListener(REOPEN_EVENT, onReopen);
  };
};
