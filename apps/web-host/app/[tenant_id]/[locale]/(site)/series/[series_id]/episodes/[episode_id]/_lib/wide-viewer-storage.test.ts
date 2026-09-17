// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readWideViewerChoice,
  storeWideViewerChoice,
  subscribeToWideViewerChoice,
} from "./wide-viewer-storage";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("wide viewer storage", () => {
  it("answers no choice for a tab that has made none", () => {
    expect(readWideViewerChoice()).toBeNull();
  });

  it("answers the choice this tab stored, in either direction", () => {
    storeWideViewerChoice(true);
    expect(readWideViewerChoice()).toBe(true);

    storeWideViewerChoice(false);
    expect(readWideViewerChoice()).toBe(false);
  });

  it("tells every subscriber at once, and stops telling one that left", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToWideViewerChoice(listener);

    storeWideViewerChoice(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    storeWideViewerChoice(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the choice for the page when storage refuses it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    storeWideViewerChoice(true);

    expect(readWideViewerChoice()).toBe(true);
  });
});
