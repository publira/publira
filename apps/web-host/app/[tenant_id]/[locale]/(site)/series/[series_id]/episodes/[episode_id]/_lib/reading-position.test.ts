import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createReadingPositionSaver,
  READING_POSITION_SAVE_DELAY_MS,
  readingPositionBeaconPath,
  resumePageIndex,
  sendReadingPositionBeacon,
} from "./reading-position";

describe("resumePageIndex", () => {
  it("opens a reader with no saved position at the first page", () => {
    expect(resumePageIndex(null, 8)).toBe(0);
  });

  it("opens at the page the reader stopped on", () => {
    expect(resumePageIndex(11, 20)).toBe(11);
  });

  it("opens at the last page of an episode that lost pages since", () => {
    expect(resumePageIndex(11, 5)).toBe(4);
  });

  it("opens at the first page of an episode with no pages at all", () => {
    expect(resumePageIndex(11, 0)).toBe(0);
  });
});

describe("readingPositionBeaconPath", () => {
  it("names the episode the way the reader's own URL does", () => {
    expect(readingPositionBeaconPath("SERIES_001", "EPISODE_001")).toBe(
      "/api/v1/series/SERIES_001/episodes/EPISODE_001/reading-position"
    );
  });

  it("escapes an identifier that would otherwise change the path", () => {
    expect(readingPositionBeaconPath("a/b", "c?d")).toBe(
      "/api/v1/series/a%2Fb/episodes/c%3Fd/reading-position"
    );
  });
});

describe("sendReadingPositionBeacon", () => {
  const sendBeacon = vi.fn<(url: string, body: Blob) => boolean>();

  beforeEach(() => {
    sendBeacon.mockReset();
    sendBeacon.mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries the page as JSON, which is what keeps it off the CORS safelist", async () => {
    expect(sendReadingPositionBeacon("/beacon", 11)).toBe(true);

    const [[url, body]] = sendBeacon.mock.calls;
    expect(url).toBe("/beacon");
    expect(body.type).toBe("application/json");
    await expect(body.text()).resolves.toBe('{"pageIndex":11}');
  });

  it("reports a beacon the browser refused to queue", () => {
    sendBeacon.mockReturnValue(false);

    expect(sendReadingPositionBeacon("/beacon", 3)).toBe(false);
  });
});

describe("createReadingPositionSaver", () => {
  const send = vi.fn<(pageIndex: number) => boolean>();

  const saver = () => createReadingPositionSaver({ send });

  beforeEach(() => {
    vi.useFakeTimers();
    send.mockReset();
    send.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends nothing while the reader is still turning pages", () => {
    const { save } = saver();

    save(1);
    vi.advanceTimersByTime(READING_POSITION_SAVE_DELAY_MS - 1);
    save(2);
    vi.advanceTimersByTime(READING_POSITION_SAVE_DELAY_MS - 1);

    expect(send).not.toHaveBeenCalled();
  });

  it("sends the page the reader settled on, once", () => {
    const { save } = saver();

    save(1);
    save(2);
    save(3);
    vi.advanceTimersByTime(READING_POSITION_SAVE_DELAY_MS);

    expect(send).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("sends the page the reader is on when they leave inside the delay", () => {
    const { flush, save } = saver();

    save(7);
    flush();

    expect(send).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("sends nothing on leaving with the current page already saved", () => {
    const { flush, save } = saver();

    save(7);
    vi.advanceTimersByTime(READING_POSITION_SAVE_DELAY_MS);
    flush();

    expect(send).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("drops a turn the reader took back before the delay ran out", () => {
    const { flush, save } = saver();

    save(7);
    vi.advanceTimersByTime(READING_POSITION_SAVE_DELAY_MS);
    save(8);
    save(7);
    flush();

    expect(send).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("sends the next page the reader rests on after one the browser refused", () => {
    send.mockReturnValueOnce(false);
    const { save } = saver();

    save(7);
    vi.advanceTimersByTime(READING_POSITION_SAVE_DELAY_MS);
    save(7);
    vi.advanceTimersByTime(READING_POSITION_SAVE_DELAY_MS);

    expect(send).toHaveBeenNthCalledWith(2, 7);
  });
});
