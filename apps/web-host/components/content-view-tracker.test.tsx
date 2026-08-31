// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContentViewTracker } from "./content-view-tracker";

const sendBeacon = vi.fn((_url: string, _body: Blob) => true);

beforeEach(() => {
  vi.stubGlobal("navigator", { ...navigator, sendBeacon });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sentBody = async (call: number): Promise<unknown> => {
  const [, blob] = sendBeacon.mock.calls[call];
  return JSON.parse(await blob.text());
};

describe("ContentViewTracker", () => {
  it("開かれたページの閲覧を 1 度だけ報告する", async () => {
    const { rerender } = render(
      <ContentViewTracker kind="episode" publicId="EP_001" />
    );
    rerender(<ContentViewTracker kind="episode" publicId="EP_001" />);

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    // テナントは proxy が書き換えたセグメントから決まるので、本文には載せない。
    expect(sendBeacon.mock.calls[0][0]).toBe("/api/v1/views");
    await expect(sentBody(0)).resolves.toEqual({
      kind: "episode",
      publicId: "EP_001",
    });
  });

  it("別のエピソードへ移ったら改めて報告する", async () => {
    const { rerender } = render(
      <ContentViewTracker kind="episode" publicId="EP_001" />
    );
    rerender(<ContentViewTracker kind="episode" publicId="EP_002" />);

    expect(sendBeacon).toHaveBeenCalledTimes(2);
    await expect(sentBody(1)).resolves.toEqual({
      kind: "episode",
      publicId: "EP_002",
    });
  });

  it("ブラウザがキューに載せられなくてもページを壊さない", () => {
    sendBeacon.mockReturnValueOnce(false);

    expect(() =>
      render(<ContentViewTracker kind="series" publicId="SR_001" />)
    ).not.toThrow();
  });
});
