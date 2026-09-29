import { describe, expect, it } from "vitest";

import {
  labelDetailHref,
  parseLabelDetailParams,
  parseLabelDetailSearchParams,
} from "./search-params";

// Token normalization itself is covered in `lib/cursor-token.test.ts`; these
// only pin down that this detail route is wired to it and points at the
// label.
describe("parseLabelDetailParams", () => {
  it("Pass 12 character Base58 public_id", () => {
    expect(parseLabelDetailParams({ label_id: " SeedLABLAAA1 " })).toBe(
      "SeedLABLAAA1"
    );
  });

  it("Set label_id of different shape to null", () => {
    expect(parseLabelDetailParams({ label_id: "not-a-public-id" })).toBeNull();
    expect(parseLabelDetailParams({ label_id: "0OOOOOOOOOOO" })).toBeNull();
    expect(parseLabelDetailParams({ label_id: "" })).toBeNull();
  });
});

describe("parseLabelDetailSearchParams", () => {
  it("The base64url token is passed by removing only the leading and trailing spaces.", () => {
    expect(parseLabelDetailSearchParams({ token: " djF8Zg-_ " })).toEqual({
      token: "djF8Zg-_",
    });
  });

  it("If there is no token, treat it as the first page", () => {
    expect(parseLabelDetailSearchParams({})).toEqual({ token: "" });
  });

  it("Discard tokens other than base64url", () => {
    expect(parseLabelDetailSearchParams({ token: "djF8Zg==" })).toEqual({
      token: "",
    });
    expect(parseLabelDetailSearchParams({ token: ["a", "b"] })).toEqual({
      token: "",
    });
  });
});

describe("labelDetailHref", () => {
  it("Construct a query with token", () => {
    expect(labelDetailHref("LABEL_A", "djF8Zg")).toBe(
      "/labels/LABEL_A?token=djF8Zg"
    );
  });

  it("If token is empty, return to first page", () => {
    expect(labelDetailHref("LABEL_A", "")).toBe("/labels/LABEL_A");
  });
});
