import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  STATIC_PARAM_PLACEHOLDER,
  createPlaceholderStaticParams,
  guardPlaceholder,
  guardPlaceholders,
  isPlaceholderStaticParam,
} from "./next-static-params";

const { mockNotFound } = vi.hoisted(() => ({
  mockNotFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
}));

describe("next-static-params", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createPlaceholderStaticParams sets placeholder on the given keys", () => {
    expect(createPlaceholderStaticParams("tenant", "series")).toEqual([
      {
        series: STATIC_PARAM_PLACEHOLDER,
        tenant: STATIC_PARAM_PLACEHOLDER,
      },
    ]);
  });

  it("isPlaceholderStaticParam is true only for placeholder", () => {
    expect(isPlaceholderStaticParam(STATIC_PARAM_PLACEHOLDER)).toBe(true);
    expect(isPlaceholderStaticParam("TENANT001")).toBe(false);
    expect(isPlaceholderStaticParam(null)).toBe(false);
  });

  it("guardPlaceholder and guardPlaceholders call notFound for placeholder", () => {
    guardPlaceholder("TENANT001");
    expect(mockNotFound).not.toHaveBeenCalled();

    guardPlaceholder(STATIC_PARAM_PLACEHOLDER);
    expect(mockNotFound).toHaveBeenCalledTimes(1);

    guardPlaceholders({
      a: "A",
      b: STATIC_PARAM_PLACEHOLDER,
      c: "C",
    });
    expect(mockNotFound).toHaveBeenCalledTimes(2);
  });
});
