import { describe, expect, it } from "vitest";

import {
  authTokenFormSchema,
  authTokenSearchParamSchema,
  emailFormSchema,
  emailSearchParamSchema,
  errorSearchParamSchema,
  nextPathFormSchema,
  nextPathSearchParamSchema,
  passwordFormSchema,
} from "./auth-input";

const VALID_TOKEN = "a".repeat(64);

describe("nextPathSearchParamSchema", () => {
  it("keeps a same-origin path", () => {
    expect(nextPathSearchParamSchema.parse("/operators")).toBe("/operators");
    expect(nextPathSearchParamSchema.parse("/tenants/t1?page=2")).toBe(
      "/tenants/t1?page=2"
    );
  });

  it("neutralizes open redirects and login loops", () => {
    expect(nextPathSearchParamSchema.parse("https://evil.example")).toBe("/");
    expect(nextPathSearchParamSchema.parse("//evil.example")).toBe("/");
    expect(nextPathSearchParamSchema.parse("/login?next=/operators")).toBe("/");
  });

  it("falls back when the query is missing, empty, or conflicting", () => {
    expect(nextPathSearchParamSchema.parse(null)).toBe("/");
    expect(nextPathSearchParamSchema.parse("   ")).toBe("/");
    expect(nextPathSearchParamSchema.parse(["/a", "/b"])).toBe("/");
  });
});

describe("nextPathFormSchema", () => {
  it("applies the same sanitization as the query schema", () => {
    expect(nextPathFormSchema.parse("/operators")).toBe("/operators");
    expect(nextPathFormSchema.parse("https://evil.example")).toBe("/");
    expect(nextPathFormSchema.parse(null)).toBe("/");
  });
});

describe("authTokenSearchParamSchema", () => {
  it("accepts the 64-char hex the server issues", () => {
    expect(authTokenSearchParamSchema.parse(VALID_TOKEN)).toBe(VALID_TOKEN);
    expect(authTokenSearchParamSchema.parse(` ${VALID_TOKEN} `)).toBe(
      VALID_TOKEN
    );
  });

  it("drops anything that is not a 64-char hex token", () => {
    expect(authTokenSearchParamSchema.parse(null)).toBe("");
    expect(authTokenSearchParamSchema.parse("not-a-token")).toBe("");
    expect(authTokenSearchParamSchema.parse("g".repeat(64))).toBe("");
    expect(authTokenSearchParamSchema.parse(VALID_TOKEN.slice(0, 63))).toBe("");
  });
});

describe("authTokenFormSchema", () => {
  it("rejects a missing or malformed token", () => {
    expect(authTokenFormSchema.safeParse(null).success).toBe(false);
    expect(authTokenFormSchema.safeParse("short").success).toBe(false);
    expect(authTokenFormSchema.parse(VALID_TOKEN)).toBe(VALID_TOKEN);
  });
});

describe("emailSearchParamSchema", () => {
  it("keeps a well-formed email and hides anything else", () => {
    expect(emailSearchParamSchema.parse("operator@example.com")).toBe(
      "operator@example.com"
    );
    expect(emailSearchParamSchema.parse("not-an-email")).toBe("");
    expect(emailSearchParamSchema.parse(null)).toBe("");
  });
});

describe("errorSearchParamSchema", () => {
  it("trims a message and falls back to empty", () => {
    expect(errorSearchParamSchema.parse("  失敗しました  ")).toBe(
      "失敗しました"
    );
    expect(errorSearchParamSchema.parse(null)).toBe("");
  });
});

describe("emailFormSchema", () => {
  it("trims and requires an email", () => {
    expect(emailFormSchema.parse("  operator@example.com  ")).toBe(
      "operator@example.com"
    );
    expect(emailFormSchema.safeParse("").success).toBe(false);
    expect(emailFormSchema.safeParse("not-an-email").success).toBe(false);
  });
});

describe("passwordFormSchema", () => {
  it("does not trim, and rejects an empty value", () => {
    expect(passwordFormSchema.parse(" secret ")).toBe(" secret ");
    expect(passwordFormSchema.safeParse("").success).toBe(false);
  });
});
