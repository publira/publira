// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerAnalyticsConsent,
  onAnalyticsConsentBannerReopen,
  readAnalyticsConsent,
  reopenAnalyticsConsentBanner,
} from "./analytics-consent";

const COOKIE = "publira_web_storefront_analytics_consent";

// `@next/third-parties` declares the `dataLayer` as plain objects; the commands
// on it are `arguments` objects, which spread.
const page = window as unknown as { dataLayer?: Iterable<unknown>[] };

const commands = (): unknown[][] =>
  (page.dataLayer ?? []).map((entry) => [...entry]);

const signals = (answer: "denied" | "granted") => ({
  ad_personalization: answer,
  ad_storage: answer,
  ad_user_data: answer,
  analytics_storage: answer,
});

const clearCookie = () => {
  // oxlint-disable-next-line unicorn/no-document-cookie -- the test plays the browser the module writes to
  document.cookie = `${COOKIE}=; Max-Age=0; Path=/`;
};

beforeEach(() => {
  clearCookie();
  delete page.dataLayer;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readAnalyticsConsent", () => {
  it("answers unanswered before the reader has chosen", () => {
    expect(readAnalyticsConsent(COOKIE)).toBe("unanswered");
  });

  it("takes Global Privacy Control as a refusal, whatever is stored", () => {
    answerAnalyticsConsent(COOKIE, "granted");
    vi.stubGlobal("navigator", { ...navigator, globalPrivacyControl: true });

    expect(readAnalyticsConsent(COOKIE)).toBe("global_privacy_control");
  });

  it("reads only the cookie of its own name", () => {
    // oxlint-disable-next-line unicorn/no-document-cookie -- see above
    document.cookie = `x${COOKIE}=granted; Path=/`;

    expect(readAnalyticsConsent(COOKIE)).toBe("unanswered");
  });
});

describe("answerAnalyticsConsent", () => {
  it("stores the answer and nothing else", () => {
    answerAnalyticsConsent(COOKIE, "denied");

    expect(document.cookie).toContain(`${COOKIE}=denied`);
    expect(readAnalyticsConsent(COOKIE)).toBe("denied");
  });

  it("sends a grant to Google, and a refusal only when it withdraws one", () => {
    answerAnalyticsConsent(COOKIE, "denied");
    expect(commands()).toEqual([]);

    answerAnalyticsConsent(COOKIE, "granted");
    answerAnalyticsConsent(COOKIE, "granted");
    expect(commands()).toEqual([["consent", "update", signals("granted")]]);

    answerAnalyticsConsent(COOKIE, "denied");
    answerAnalyticsConsent(COOKIE, "denied");
    expect(commands()).toEqual([
      ["consent", "update", signals("granted")],
      ["consent", "update", signals("denied")],
    ]);
  });

  it("pushes onto the dataLayer the page already has", () => {
    const existing: Iterable<unknown>[] = [];
    page.dataLayer = existing;

    answerAnalyticsConsent(COOKIE, "granted");

    expect(page.dataLayer).toBe(existing);
    expect(existing).toHaveLength(1);
  });
});

describe("reopenAnalyticsConsentBanner", () => {
  it("reaches every listener until it unsubscribes", () => {
    const onReopen = vi.fn();
    const unsubscribe = onAnalyticsConsentBannerReopen(onReopen);

    reopenAnalyticsConsentBanner();
    unsubscribe();
    reopenAnalyticsConsentBanner();

    expect(onReopen).toHaveBeenCalledTimes(1);
  });
});
