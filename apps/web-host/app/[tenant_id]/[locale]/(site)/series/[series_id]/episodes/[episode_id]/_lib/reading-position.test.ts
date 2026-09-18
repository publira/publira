import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createReadingPositionSaver,
  READING_POSITION_SAVE_DELAY_MS,
  readingPositionBeaconPath,
  resumePageIndex,
  sendReadingPosition,
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

describe("sendReadingPosition", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the page as JSON, kept alive past a navigation", async () => {
    await expect(sendReadingPosition("/position", 11)).resolves.toBe(true);

    const [[url, init]] = fetchMock.mock.calls;
    expect(url).toBe("/position");
    expect(init).toMatchObject({
      body: '{"pageIndex":11}',
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    });
  });

  it("reports a request the offline browser could not deliver", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(sendReadingPosition("/position", 3)).resolves.toBe(false);
  });

  it("reports a server that failed to write it", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));

    await expect(sendReadingPosition("/position", 3)).resolves.toBe(false);
  });

  it("settles a request the server refused, which a retry would not change", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));

    await expect(sendReadingPosition("/position", 3)).resolves.toBe(true);
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
});

/** The reader rests on the page for longer than the delay. */
const settle = () =>
  vi.advanceTimersByTimeAsync(READING_POSITION_SAVE_DELAY_MS);

describe("createReadingPositionSaver", () => {
  const send = vi.fn<(pageIndex: number) => Promise<boolean>>();
  const beacon = vi.fn<(pageIndex: number) => boolean>();
  let reconnect: (() => void) | null = null;
  const onReconnect = vi.fn((retry: () => void) => {
    reconnect = retry;
    return () => {
      reconnect = null;
    };
  });

  const saver = () => createReadingPositionSaver({ beacon, onReconnect, send });

  /** The browser reports the connection back. */
  const comeOnline = async () => {
    reconnect?.();
    await vi.advanceTimersByTimeAsync(0);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    send.mockReset();
    send.mockResolvedValue(true);
    beacon.mockReset();
    beacon.mockReturnValue(true);
    onReconnect.mockClear();
    reconnect = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends nothing while the reader is still turning pages", async () => {
    const { save } = saver();

    save(1);
    await vi.advanceTimersByTimeAsync(READING_POSITION_SAVE_DELAY_MS - 1);
    save(2);
    await vi.advanceTimersByTimeAsync(READING_POSITION_SAVE_DELAY_MS - 1);

    expect(send).not.toHaveBeenCalled();
  });

  it("sends the page the reader settled on, once", async () => {
    const { save } = saver();

    save(1);
    save(2);
    save(3);
    await settle();

    expect(send).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("sends the page the reader is on when they leave inside the delay", () => {
    const { flush, save } = saver();

    save(7);
    flush();

    expect(send).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("sends nothing on leaving with the current page already saved", async () => {
    const { flush, leave, save } = saver();

    save(7);
    await settle();
    flush();
    leave();

    expect(send).toHaveBeenCalledExactlyOnceWith(7);
    expect(beacon).not.toHaveBeenCalled();
  });

  it("drops a turn the reader took back before the delay ran out", async () => {
    const { flush, save } = saver();

    save(7);
    await settle();
    save(8);
    save(7);
    flush();

    expect(send).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("sends a spread once however often the reader turns over it", async () => {
    const { save } = saver();

    save(2);
    await settle();
    save(4);
    save(2);
    await settle();
    save(4);
    save(2);
    await settle();

    expect(send).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("does not send a page again while it is still in flight", async () => {
    send.mockReturnValue(Promise.withResolvers<boolean>().promise);
    const { save } = saver();

    save(7);
    await settle();
    save(8);
    save(7);
    await settle();

    expect(send).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("sends the page the reader moved to after the one in flight lands", async () => {
    const landing = Promise.withResolvers<boolean>();
    send.mockReturnValueOnce(landing.promise);
    const { save } = saver();

    save(7);
    await settle();
    save(9);
    await settle();

    expect(send).toHaveBeenCalledExactlyOnceWith(7);

    landing.resolve(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(send).toHaveBeenNthCalledWith(2, 9);
  });

  it("does not count a page as saved when the send was not delivered", async () => {
    send.mockResolvedValueOnce(false);
    const { save } = saver();

    save(7);
    await settle();
    save(7);
    await settle();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, 7);
  });

  it("sends the pages turned offline once the connection returns, with no reader action", async () => {
    send.mockResolvedValue(false);
    const { save } = saver();

    save(5);
    await settle();
    save(30);
    await settle();

    expect(send).toHaveBeenLastCalledWith(30);

    send.mockResolvedValue(true);
    await comeOnline();

    expect(send).toHaveBeenLastCalledWith(30);
    expect(send).toHaveBeenCalledTimes(3);

    await comeOnline();

    expect(send).toHaveBeenCalledTimes(3);
  });

  it("gives up an unsaved page the reader turned back from to the saved one", async () => {
    const { save } = saver();

    save(5);
    await settle();
    send.mockResolvedValueOnce(false);
    save(6);
    await settle();
    save(5);
    await comeOnline();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("hands the unsaved page to the browser when the page goes away", async () => {
    send.mockResolvedValue(false);
    const { leave, save } = saver();

    save(5);
    await settle();
    save(6);
    leave();

    expect(beacon).toHaveBeenCalledExactlyOnceWith(6);
  });

  it("keeps a page handed over on leaving unsaved, for a page the browser restores", () => {
    const { flush, leave, save } = saver();

    save(6);
    leave();
    flush();

    expect(beacon).toHaveBeenCalledExactlyOnceWith(6);
    expect(send).toHaveBeenCalledExactlyOnceWith(6);
  });
});
