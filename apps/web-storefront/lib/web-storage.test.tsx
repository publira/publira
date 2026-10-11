// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readWebStorage,
  subscribeToWebStorage,
  useWebStorage,
  writeWebStorage,
} from "./web-storage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const Probe = ({ storageKey }: { storageKey: string }) => (
  <p>{useWebStorage("session", storageKey) ?? "nothing"}</p>
);

describe("web storage", () => {
  it("reads nothing for a key that holds nothing", () => {
    expect(readWebStorage("session", "publira.test")).toBeNull();
  });

  it("keeps the two storage areas apart", () => {
    writeWebStorage("session", "publira.test", "session value");

    expect(readWebStorage("session", "publira.test")).toBe("session value");
    expect(readWebStorage("local", "publira.test")).toBeNull();
  });

  it("tells the subscribers of that key alone, and stops telling one that left", () => {
    const listener = vi.fn();
    const other = vi.fn();
    const unsubscribe = subscribeToWebStorage("local", "publira.a", listener);
    subscribeToWebStorage("local", "publira.b", other);

    writeWebStorage("local", "publira.a", "1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();

    unsubscribe();
    writeWebStorage("local", "publira.a", "2");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("hears a write another tab made", () => {
    const listener = vi.fn();
    subscribeToWebStorage("local", "publira.a", listener);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "publira.a",
        storageArea: window.localStorage,
      })
    );

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps a value for the page when storage refuses it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    writeWebStorage("session", "publira.refused", "kept");

    expect(readWebStorage("session", "publira.refused")).toBe("kept");
  });

  it("re-renders a component when its key is written", () => {
    render(<Probe storageKey="publira.probe" />);
    expect(screen.getByText("nothing")).toBeDefined();

    act(() => {
      writeWebStorage("session", "publira.probe", "written");
    });

    expect(screen.getByText("written")).toBeDefined();
  });
});
