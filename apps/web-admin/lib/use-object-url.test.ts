// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useObjectUrl } from "./use-object-url";

const revokeObjectURL = vi.fn();

beforeEach(() => {
  let created = 0;

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => {
      created += 1;

      return `blob:file-${created}`;
    }),
    revokeObjectURL,
  });
});

afterEach(() => {
  cleanup();
  revokeObjectURL.mockClear();
  vi.unstubAllGlobals();
});

describe("useObjectUrl", () => {
  it("is empty until a file is shown", () => {
    const { result } = renderHook(() => useObjectUrl());

    expect(result.current.url).toBe("");
  });

  it("revokes the URL of the file a newer one replaces", () => {
    const { result } = renderHook(() => useObjectUrl());

    act(() => {
      result.current.show(new Blob(["first"]));
    });
    act(() => {
      result.current.show(new Blob(["second"]));
    });

    expect(result.current.url).toBe("blob:file-2");
    expect(revokeObjectURL.mock.calls).toStrictEqual([["blob:file-1"]]);
  });

  it("revokes the URL it is cleared of", () => {
    const { result } = renderHook(() => useObjectUrl());

    act(() => {
      result.current.show(new Blob(["picked"]));
    });
    act(() => {
      result.current.clear();
    });

    expect(result.current.url).toBe("");
    expect(revokeObjectURL.mock.calls).toStrictEqual([["blob:file-1"]]);
  });

  it("revokes the URL it still shows when it unmounts", () => {
    const { result, unmount } = renderHook(() => useObjectUrl());

    act(() => {
      result.current.show(new Blob(["picked"]));
    });
    unmount();

    expect(revokeObjectURL.mock.calls).toStrictEqual([["blob:file-1"]]);
  });
});
