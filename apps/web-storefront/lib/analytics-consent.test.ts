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
// on it are `arguments` objects, whose own values are the command's arguments.
const commands = (): unknown[][] =>
  (window.dataLayer ?? []).map((entry) => Object.values(entry));

const signals = (answer: "denied" | "granted") => ({
  ad_personalization: answer,
  ad_storage: answer,
  ad_user_data: answer,
  analytics_storage: answer,
});

/** A command the way `gtag()` pushes it: an `arguments` object. */
// oxlint-disable-next-line func-style -- an arrow function has no `arguments`
function asCommand(..._args: unknown[]): Iterable<unknown> {
  // oxlint-disable-next-line prefer-rest-params, sonarjs/arguments-usage -- see above
  return arguments;
}

/** What the defaults script leaves for a reader who has not agreed. */
const runDefaults = () => {
  window.dataLayer = [asCommand("consent", "default", signals("denied"))];
};

const clearCookie = () => {
  // oxlint-disable-next-line unicorn/no-document-cookie -- the test plays the browser the module writes to
  document.cookie = `${COOKIE}=; Max-Age=0; Path=/`;
};

beforeEach(() => {
  clearCookie();
  delete window.dataLayer;
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
    runDefaults();

    answerAnalyticsConsent(COOKIE, "denied");
    expect(commands()).toHaveLength(1);

    answerAnalyticsConsent(COOKIE, "granted");
    answerAnalyticsConsent(COOKIE, "granted");
    answerAnalyticsConsent(COOKIE, "denied");
    answerAnalyticsConsent(COOKIE, "denied");
    expect(commands().slice(1)).toEqual([
      ["consent", "update", signals("granted")],
      ["consent", "update", signals("denied")],
    ]);
  });

  it("withdraws what this tab sent, whatever another tab left in the cookie", () => {
    runDefaults();
    answerAnalyticsConsent(COOKIE, "granted");
    // Another tab declined: the cookie says so, this tab's tag does not know.
    // oxlint-disable-next-line unicorn/no-document-cookie -- the test plays the other tab
    document.cookie = `${COOKIE}=denied; Path=/`;

    answerAnalyticsConsent(COOKIE, "denied");

    expect(commands().at(-1)).toEqual(["consent", "update", signals("denied")]);
  });

  it("leaves a page whose defaults have not run to read the cookie itself", () => {
    answerAnalyticsConsent(COOKIE, "granted");

    expect(commands()).toEqual([]);
  });

  it("reaches the tag running in another tab", async () => {
    runDefaults();
    answerAnalyticsConsent(COOKIE, "granted");
    const otherTab = new BroadcastChannel("publira:analytics-consent");

    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel takes no origin
    otherTab.postMessage("denied");

    await vi.waitFor(() => {
      expect(commands().at(-1)).toEqual([
        "consent",
        "update",
        signals("denied"),
      ]);
    });
    otherTab.close();
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
