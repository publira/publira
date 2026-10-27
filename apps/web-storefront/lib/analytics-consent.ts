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

/** Same-tab signal. A cookie written by script fires no event of its own. */
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
 * Stores the reader's answer and tells Google what changed.
 *
 * A grant sends an `update` of `granted`. A refusal sends nothing unless it
 * withdraws a grant, which sends an `update` of `denied`: before a grant, the
 * defaults already say `denied`. Cookies the tag set before a withdrawal stay
 * until Google's own expiry, which the banner tells the reader.
 */
export const answerAnalyticsConsent = (
  cookieName: string,
  answer: AnalyticsConsentAnswer
): void => {
  const previous = readStoredAnswer(cookieName);

  // oxlint-disable-next-line unicorn/no-document-cookie -- the answer decides what this page loads now, before any request could carry it
  document.cookie = [
    `${cookieName}=${answer}`,
    `Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");

  if (answer === "granted" ? previous !== "granted" : previous === "granted") {
    gtag("consent", "update", consentSignals(answer));
  }

  window.dispatchEvent(new Event(CHANGE_EVENT));
};

const subscribe = (onChange: () => void): (() => void) => {
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
