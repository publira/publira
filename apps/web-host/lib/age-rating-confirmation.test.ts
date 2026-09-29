// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readConfirmedAgeRating,
  useConfirmedAgeRating,
  writeConfirmedAgeRating,
} from "./age-rating-confirmation";

const TENANT_ID = "tenant-1";
const OTHER_TENANT_ID = "tenant-2";
const storageKey = `publira.age-rating.confirmation.${TENANT_ID}`;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("readConfirmedAgeRating", () => {
  it("Returns nothing until this browser has confirmed on this tenant", () => {
    expect(readConfirmedAgeRating(TENANT_ID)).toBeUndefined();
  });

  it("Ignores a value this catalog does not name", () => {
    window.localStorage.setItem(storageKey, "all");
    expect(readConfirmedAgeRating(TENANT_ID)).toBeUndefined();
  });
});

describe("writeConfirmedAgeRating", () => {
  it("Stores the rating this browser just confirmed", () => {
    expect(writeConfirmedAgeRating(TENANT_ID, "r15")).toBe("r15");
    expect(window.localStorage.getItem(storageKey)).toBe("r15");
    expect(readConfirmedAgeRating(TENANT_ID)).toBe("r15");
  });

  it("Does not lower an r18 confirmation to r15", () => {
    writeConfirmedAgeRating(TENANT_ID, "r18");
    expect(writeConfirmedAgeRating(TENANT_ID, "r15")).toBe("r18");
    expect(readConfirmedAgeRating(TENANT_ID)).toBe("r18");
  });

  it("Keeps each tenant's confirmation on that tenant", () => {
    writeConfirmedAgeRating(TENANT_ID, "r18");
    expect(readConfirmedAgeRating(OTHER_TENANT_ID)).toBeUndefined();
  });

  it("Does not write when the tenant id is empty", () => {
    expect(writeConfirmedAgeRating("  ", "r15")).toBeUndefined();
    expect(window.localStorage.length).toBe(0);
  });
});

describe("useConfirmedAgeRating", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("Adopts what storage already holds after mount", async () => {
    window.localStorage.setItem(storageKey, "r15");
    const { result } = renderHook(() => useConfirmedAgeRating(TENANT_ID));

    await waitFor(() => {
      expect(result.current).toBe("r15");
    });
  });

  it("Picks up a confirmation written in this tab", async () => {
    const { result } = renderHook(() => useConfirmedAgeRating(TENANT_ID));

    await waitFor(() => {
      expect(result.current).toBeUndefined();
    });

    writeConfirmedAgeRating(TENANT_ID, "r18");

    await waitFor(() => {
      expect(result.current).toBe("r18");
    });
  });
});
