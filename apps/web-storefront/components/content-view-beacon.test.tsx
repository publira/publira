// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { answerAnalyticsConsent } from "#lib/analytics-consent";

import { ContentViewBeacon } from "./content-view-beacon";

const COOKIE = "publira_web_storefront_analytics_consent";

const sendBeacon = vi.fn((_url: string, _body: Blob) => true);

beforeEach(() => {
  vi.stubGlobal("navigator", { ...navigator, sendBeacon });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sendBeacon.mockClear();
  // oxlint-disable-next-line unicorn/no-document-cookie -- the test plays the browser the banner writes to
  document.cookie = `${COOKIE}=; Max-Age=0; Path=/`;
});

const sentBody = async (call: number): Promise<unknown> => {
  const [, blob] = sendBeacon.mock.calls[call];

  return JSON.parse(await blob.text());
};

describe("ContentViewBeacon", () => {
  it("reports the open page once, however often it re-renders", async () => {
    const { rerender } = render(
      <ContentViewBeacon
        kind="episode"
        id="e0000000-0000-4000-8000-000000000001"
      />
    );

    rerender(
      <ContentViewBeacon
        kind="episode"
        id="e0000000-0000-4000-8000-000000000001"
      />
    );

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    // The tenant comes from the segment the proxy rewrote, never the body.
    expect(sendBeacon.mock.calls[0][0]).toBe("/api/v1/views");
    await expect(sentBody(0)).resolves.toEqual({
      id: "e0000000-0000-4000-8000-000000000001",
      kind: "episode",
    });
  });

  it("reports again once the reader moves to another episode", async () => {
    const { rerender } = render(
      <ContentViewBeacon
        kind="episode"
        id="e0000000-0000-4000-8000-000000000001"
      />
    );

    rerender(
      <ContentViewBeacon
        kind="episode"
        id="e0000000-0000-4000-8000-000000000002"
      />
    );

    expect(sendBeacon).toHaveBeenCalledTimes(2);
    await expect(sentBody(1)).resolves.toEqual({
      id: "e0000000-0000-4000-8000-000000000002",
      kind: "episode",
    });
  });

  it("leaves the page intact when the browser cannot queue it", () => {
    sendBeacon.mockReturnValueOnce(false);

    expect(() =>
      render(
        <ContentViewBeacon
          kind="series"
          id="5e000000-0000-4000-8000-000000000001"
        />
      )
    ).not.toThrow();
  });

  it("waits for the reader to agree where the site asks first, then reports once", () => {
    render(
      <ContentViewBeacon
        consentCookieName={COOKIE}
        id="5e000000-0000-4000-8000-000000000001"
        kind="series"
      />
    );
    expect(sendBeacon).not.toHaveBeenCalled();

    act(() => {
      answerAnalyticsConsent(COOKIE, "granted");
    });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("never reports for a reader who declined", () => {
    answerAnalyticsConsent(COOKIE, "denied");
    render(
      <ContentViewBeacon
        consentCookieName={COOKIE}
        id="5e000000-0000-4000-8000-000000000001"
        kind="series"
      />
    );

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("reports at once for a reader who agreed before", () => {
    answerAnalyticsConsent(COOKIE, "granted");
    render(
      <ContentViewBeacon
        consentCookieName={COOKIE}
        id="5e000000-0000-4000-8000-000000000001"
        kind="series"
      />
    );

    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });
});
